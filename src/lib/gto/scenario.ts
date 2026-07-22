// GTO 练习模式 —— 随机场景生成与评分
import type { Card, Suit } from "@contracts/game";
import { equityMonteCarlo } from "@contracts/equity";
import {
  POSITION_LABEL,
  RFI_RANGES,
  SHOVE_RANGES,
  handClass,
  rangeFilter,
  rangePct,
  vsRaiseChart,
  type Position,
} from "./ranges";

export type ScenarioKind = "rfi" | "vsRaise" | "postflop" | "cbet" | "vsAllIn";

export interface ScenarioOption {
  id: string;
  label: string;
}

export interface Scenario {
  kind: ScenarioKind;
  title: string; // 场景描述
  detail: string; // 补充信息（底池/下注等）
  heroPos: Position;
  villainPos?: Position; // 加注者 / 下注者位置
  opponents: number; // 局中对手总数
  playersBehind: number; // 身后尚未行动的玩家数
  stackBb: number; // 你的有效后手（bb）
  hole: Card[];
  board: Card[]; // 空数组 = 翻牌前
  options: ScenarioOption[];
  correctId: string;
  partialId?: string; // 边缘决策：部分得分
  explanation: string;
}

export const SCORE_FULL = 10;
export const SCORE_PARTIAL = 5;
export const STREAK_BONUS = 5; // 每 3 连击额外奖励
export const STREAK_BONUS_EVERY = 3;

/* ---------------- 随机工具 ---------------- */

const SUITS: Suit[] = ["s", "h", "d", "c"];

function randInt(n: number) {
  return Math.floor(Math.random() * n);
}

function pick<T>(arr: readonly T[]): T {
  return arr[randInt(arr.length)];
}

/** 抽 n 张互不相同的牌 */
function drawCards(n: number): Card[] {
  const all: Card[] = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) all.push({ r, s });
  for (let i = 0; i < n; i++) {
    const j = i + randInt(all.length - i);
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, n);
}

/* ---------------- 场景生成 ---------------- */

const RFI_POSITIONS: Position[] = ["UTG", "MP", "CO", "BTN", "SB"];
const ORDER: Position[] = ["UTG", "MP", "CO", "BTN", "SB", "BB"];

/** 位置之后的未行动玩家数（6-max） */
function behindCount(pos: Position): number {
  return ORDER.length - 1 - ORDER.indexOf(pos);
}

function genRfi(hole: Card[]): Scenario {
  const pos = pick(RFI_POSITIONS);
  const behind = behindCount(pos);
  const cls = handClass(hole[0], hole[1]);
  const range = RFI_RANGES[pos];
  const inRange = range.has(cls);
  return {
    kind: "rfi",
    heroPos: pos,
    opponents: behind,
    playersBehind: behind,
    hole,
    board: [],
    title: `你在${POSITION_LABEL[pos]}，前面玩家全部弃牌`,
    detail: `6 人桌 · 有效后手 100bb · 身后还有 ${behind} 名玩家未行动`,
    stackBb: 100,
    options: [
      { id: "raise", label: "加注 2.5bb" },
      { id: "fold", label: "弃牌" },
    ],
    correctId: inRange ? "raise" : "fold",
    explanation: inRange
      ? `${cls} 在${pos}的率先开局范围内（约 ${rangePct(range)}% 的牌）。${pos}身后有 ${behind} 名玩家，位置越靠前范围越紧；这手牌强度足够，GTO 打法是加注约 2.5bb 夺取底池。`
      : `${cls} 不在${pos}的率先开局范围内。${pos}身后还有 ${behind} 名玩家未行动，只能开约 ${rangePct(range)}% 的牌；用太弱的牌开局会长期亏损，标准打法是弃牌。`,
  };
}

function genVsRaise(hole: Card[]): Scenario {
  const heroPos = pick(["CO", "BTN", "SB", "BB"] as Position[]);
  const heroIdx = ORDER.indexOf(heroPos);
  const before = ORDER.slice(0, heroIdx);
  const villainPos = pick(before);
  const behind = behindCount(heroPos);
  const opponents = behind + 1; // 加注者 + 身后未行动者
  const cls = handClass(hole[0], hole[1]);
  const chart = vsRaiseChart(villainPos, heroPos);
  let correctId: string;
  let why: string;
  if (chart.threeBet.has(cls)) {
    correctId = "3bet";
    why = `${cls} 属于 3bet 价值范围，面对${villainPos}的加注应 3bet 扩大底池并夺取主动权。`;
  } else if (chart.call.has(cls)) {
    correctId = "call";
    why = `${cls} 强度适合继续但不足以 3bet，面对${villainPos}的加注标准打法是跟注。`;
  } else {
    correctId = "fold";
    why = `${cls} 不足以对抗${villainPos}的开局范围（${villainPos === "UTG" || villainPos === "MP" ? "前位加注范围很强，需要更紧地继续" : "虽然后位加注范围较宽，但这手牌仍然太弱"}），应弃牌。`;
  }
  if (behind > 0 && correctId !== "3bet") {
    why += `注意你身后还有 ${behind} 名玩家未行动，有被挤压（squeeze）的风险。`;
  }
  return {
    kind: "vsRaise",
    heroPos,
    villainPos,
    opponents,
    playersBehind: behind,
    hole,
    board: [],
    title: `${POSITION_LABEL[villainPos]}玩家加注到 2.5bb，你在${POSITION_LABEL[heroPos]}`,
    detail: `6 人桌 · 有效后手 100bb · 身后还有 ${behind} 名玩家未行动`,
    stackBb: 100,
    options: [
      { id: "3bet", label: "3bet 到 9bb" },
      { id: "call", label: "跟注 2.5bb" },
      { id: "fold", label: "弃牌" },
    ],
    correctId,
    explanation: why,
  };
}

const POSTFLOP_POTS = [12, 18, 25, 30, 40] as const;
const BET_FRACTIONS = [1 / 3, 2 / 3, 1, 3 / 2] as const;
/** 对手数量：单挑为主，兼顾多人底池 */
const OPP_COUNTS = [1, 1, 1, 2, 2, 3] as const;
const BETTOR_POSITIONS: Position[] = ["UTG", "MP", "CO", "BTN"];

function genPostflop(cards: Card[]): Scenario {
  const hole = cards.slice(0, 2);
  const board = cards.slice(2, pick([5, 6])); // 翻牌 3 张或转牌 4 张
  const street = board.length === 3 ? "翻牌圈" : "转牌圈";
  const pot = pick(POSTFLOP_POTS);
  const bet = Math.max(1, Math.round(pot * pick(BET_FRACTIONS)));
  const opponents = pick(OPP_COUNTS);
  const heroPos = pick(["CO", "BTN", "SB", "BB"] as Position[]);
  const bettorPos = pick(BETTOR_POSITIONS);
  // 后手：必须大于跟注额
  const stack = bet + pick([25, 40, 60, 90]);

  // 单挑时对手为翻牌前加注者，胜率按其实际开局范围模拟；多人底池按随机范围
  const singleOpp = opponents === 1;
  const oppRange = RFI_RANGES[bettorPos];
  const eq =
    equityMonteCarlo(
      hole,
      board,
      opponents,
      800,
      singleOpp ? rangeFilter(oppRange) : undefined,
    ) / 100;
  const req = bet / (pot + 2 * bet); // 跟注所需胜率
  const eqPct = (eq * 100).toFixed(0);
  const reqPct = (req * 100).toFixed(0);
  const vsText = singleOpp
    ? `对抗${bettorPos}的开局范围（约 ${rangePct(oppRange)}% 的牌）`
    : `对抗 ${opponents} 名对手（多人底池按随机范围估算）`;

  let correctId: string;
  let partialId: string | undefined;
  let why: string;
  if (eq >= 0.68) {
    correctId = "raise";
    why = `${vsText}，你的胜率约 ${eqPct}%，远超对手范围，应加注打价值，让更弱的牌付费。`;
  } else if (eq >= req + 0.04) {
    correctId = "call";
    why = `${vsText}，你的胜率约 ${eqPct}%，高于跟注所需胜率 ${reqPct}%（底池赔率），跟注是正 EV 的；但牌力不足以加注。`;
  } else if (eq <= req - 0.04) {
    correctId = "fold";
    why = `${vsText}，你的胜率约 ${eqPct}%，低于跟注所需胜率 ${reqPct}%（底池赔率），长期跟注会亏损，应弃牌。`;
  } else {
    // 边缘区域
    correctId = eq >= req ? "call" : "fold";
    partialId = eq >= req ? "fold" : "call";
    why = `边缘决策：${vsText}，你的胜率约 ${eqPct}%，所需胜率 ${reqPct}%，差距在误差范围内，跟注/弃牌都接近零 EV。`;
  }
  if (opponents >= 2 && correctId !== "fold") {
    why += "多人底池中胜率会被摊薄，继续时需要比单挑更强的牌。";
  }

  return {
    kind: "postflop",
    heroPos,
    villainPos: bettorPos,
    opponents,
    playersBehind: opponents - 1, // 下注者之外的其他对手视为未行动
    hole,
    board,
    title:
      opponents === 1
        ? `${street}（单挑底池），底池 ${pot}bb，${POSITION_LABEL[bettorPos]}对手下注 ${bet}bb`
        : `${street}（${opponents + 1} 人底池），底池 ${pot}bb，${POSITION_LABEL[bettorPos]}玩家下注 ${bet}bb`,
    detail: `你在${POSITION_LABEL[heroPos]} · 有效后手 ${stack}bb`,
    stackBb: stack,
    options: [
      { id: "fold", label: "弃牌" },
      { id: "call", label: `跟注 ${bet}bb` },
      { id: "raise", label: "加注" },
    ],
    correctId,
    partialId,
    explanation: why,
  };
}

/** 持续下注：你是翻牌前加注者，翻牌后对手过牌给你 */
function genCbet(cards: Card[]): Scenario {
  const hole = cards.slice(0, 2);
  const board = cards.slice(2, 5);
  const heroPos = pick(["CO", "BTN"] as Position[]);
  const villainPos = pick(["SB", "BB"] as Position[]);
  const pot = pick(POSTFLOP_POTS);
  const bet = Math.max(1, Math.round(pot * (2 / 3)));
  const stack = pot + pick([40, 60, 80]);

  // 对手是盲注位跟注者：按盲注防守范围模拟胜率
  const callRange = vsRaiseChart("BTN", "BB").call;
  const eq =
    equityMonteCarlo(hole, board, 1, 800, rangeFilter(callRange)) / 100;
  const eqPct = (eq * 100).toFixed(0);

  let correctId: string;
  let partialId: string | undefined;
  let why: string;
  if (eq >= 0.5) {
    correctId = "bet";
    why = `你的胜率约 ${eqPct}%，且作为翻牌前加注者拥有范围优势，持续下注可以打价值并夺取底池。`;
  } else if (eq >= 0.4) {
    correctId = "bet";
    partialId = "check";
    why = `你的胜率约 ${eqPct}%，牌力一般，但凭借范围优势持续下注仍有弃牌收益；过牌保留底池也是可接受的低频选择。`;
  } else {
    correctId = "check";
    why = `你的胜率约 ${eqPct}%，牌力太弱，持续下注多半是在烧钱，过牌控制底池、免费看下一张。`;
  }

  return {
    kind: "cbet",
    heroPos,
    villainPos,
    opponents: 1,
    playersBehind: 0,
    hole,
    board,
    title: `你翻牌前加注，${POSITION_LABEL[villainPos]}对手跟注。翻牌圈对手过牌`,
    detail: `单挑底池 ${pot}bb · 有效后手 ${stack}bb · 轮到你行动`,
    stackBb: stack,
    options: [
      { id: "bet", label: `持续下注 ${bet}bb` },
      { id: "check", label: "过牌" },
    ],
    correctId,
    partialId,
    explanation: why,
  };
}

/** 面对全下：盲注位迎战对手的全下 */
const SHOVE_SIZES = [12, 15, 20] as const;

function genVsAllIn(hole: Card[]): Scenario {
  const heroPos = pick(["SB", "BB"] as Position[]);
  const villainPos = pick(["MP", "CO", "BTN"] as Position[]);
  const shove = pick(SHOVE_SIZES);
  const posted = heroPos === "BB" ? 1 : 0.5;
  const pot = shove + 1.5; // 全下额 + 双盲
  const toCall = shove - posted;

  // 按该位置的全下范围模拟胜率（而非随机牌）
  const shoveRange = SHOVE_RANGES[villainPos];
  const eq =
    equityMonteCarlo(hole, [], 1, 800, rangeFilter(shoveRange)) / 100;
  const req = toCall / (pot + toCall);
  const eqPct = (eq * 100).toFixed(0);
  const reqPct = (req * 100).toFixed(0);
  const rangeText = `${villainPos}的全下范围（约 ${rangePct(shoveRange)}% 的牌）`;

  let correctId: string;
  let partialId: string | undefined;
  let why: string;
  if (eq >= req + 0.03) {
    correctId = "call";
    why = `对抗${rangeText}，你的胜率约 ${eqPct}%，高于所需胜率 ${reqPct}%（跟注 ${toCall}bb 争夺 ${(pot + toCall).toFixed(1)}bb），跟注是正 EV。`;
  } else if (eq <= req - 0.03) {
    correctId = "fold";
    why = `对抗${rangeText}，你的胜率约 ${eqPct}%，低于所需胜率 ${reqPct}%（跟注 ${toCall}bb 争夺 ${(pot + toCall).toFixed(1)}bb），应弃牌。`;
  } else {
    correctId = eq >= req ? "call" : "fold";
    partialId = eq >= req ? "fold" : "call";
    why = `边缘决策：胜率约 ${eqPct}%，所需胜率 ${reqPct}%，差距在误差范围内，跟注/弃牌 EV 接近。`;
  }

  return {
    kind: "vsAllIn",
    heroPos,
    villainPos,
    opponents: 1,
    playersBehind: 0,
    hole,
    board: [],
    title: `${POSITION_LABEL[villainPos]}玩家直接全下 ${shove}bb，你在${POSITION_LABEL[heroPos]}`,
    detail: `后手即全下额 ${shove}bb · 已投入盲注 ${posted}bb · 跟注需要 ${toCall}bb`,
    stackBb: shove,
    options: [
      { id: "call", label: `跟注 ${toCall}bb` },
      { id: "fold", label: "弃牌" },
    ],
    correctId,
    partialId,
    explanation: why,
  };
}

function rollScenario(): Scenario {
  const roll = Math.random();
  if (roll < 0.25) return genRfi(drawCards(2));
  if (roll < 0.5) return genVsRaise(drawCards(2));
  if (roll < 0.72) return genPostflop(drawCards(6));
  if (roll < 0.87) return genCbet(drawCards(5));
  return genVsAllIn(drawCards(2));
}

/**
 * 生成随机场景（题量无限，无题库）。
 * 传入 prev 可避免与上一题类型+位置完全相同的重复体验。
 */
export function genScenario(prev?: {
  kind: ScenarioKind;
  heroPos: Position;
}): Scenario {
  for (let i = 0; i < 4; i++) {
    const s = rollScenario();
    if (!prev || s.kind !== prev.kind || s.heroPos !== prev.heroPos) return s;
  }
  return rollScenario();
}

/* ---------------- 评分 ---------------- */

export interface GradeResult {
  score: number;
  isCorrect: boolean;
  isPartial: boolean;
}

export function grade(s: Scenario, choiceId: string): GradeResult {
  if (choiceId === s.correctId)
    return { score: SCORE_FULL, isCorrect: true, isPartial: false };
  if (s.partialId && choiceId === s.partialId)
    return { score: SCORE_PARTIAL, isCorrect: false, isPartial: true };
  return { score: 0, isCorrect: false, isPartial: false };
}

/* ---------------- 积分持久化 ---------------- */

export interface PracticeStats {
  score: number;
  answered: number;
  correct: number;
  streak: number;
  bestStreak: number;
}

const KEY = "poker:gto:stats";

export function loadStats(): PracticeStats {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { score: 0, answered: 0, correct: 0, streak: 0, bestStreak: 0, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { score: 0, answered: 0, correct: 0, streak: 0, bestStreak: 0 };
}

export function saveStats(s: PracticeStats) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** 作答后更新统计（连击奖励：每 3 连击 +5） */
export function applyResult(stats: PracticeStats, g: GradeResult): PracticeStats {
  const streak = g.isCorrect ? stats.streak + 1 : 0;
  const bonus = g.isCorrect && streak % STREAK_BONUS_EVERY === 0 ? STREAK_BONUS : 0;
  return {
    score: stats.score + g.score + bonus,
    answered: stats.answered + 1,
    correct: stats.correct + (g.isCorrect ? 1 : 0),
    streak,
    bestStreak: Math.max(stats.bestStreak, streak),
  };
}
