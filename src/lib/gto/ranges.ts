// GTO 练习模式 —— 翻牌前范围表
// 数据来源：公开求解器（solver）输出整理（6-max 现金局 100bb 有效筹码）
// - RFI：pokercoaching.com "implementable GTO" 6-max 范围表（LJ 17.6% / HJ 21.4% / CO 27.8% / BTN 43.5%）
// - 面对加注：公开求解器共识三值化（3bet/跟注/弃牌）范围整理
// 说明：真实 GTO 为混合频率策略，本表取主频率动作作为唯一答案，混合手归入边缘处理
import type { Card } from "@contracts/game";
import { handClass } from "@contracts/evaluate";

export { handClass };
export { rankChar } from "@contracts/evaluate";

export const RANKS = "23456789TJQKA"; // 下标 0..12 对应 rank 2..14

export type Position = "UTG" | "MP" | "CO" | "BTN" | "SB" | "BB";

export const POSITION_LABEL: Record<string, string> = {
  UTG: "枪口位（UTG）",
  MP: "中位（MP）",
  CO: "关煞位（CO）",
  BTN: "按钮位（BTN）",
  SB: "小盲（SB）",
  BB: "大盲（BB）",
};

export const POS_SHORT: Record<string, string> = {
  UTG: "UTG",
  MP: "MP",
  CO: "CO",
  BTN: "BTN",
  SB: "小盲",
  BB: "大盲",
};

const rIdx = (ch: string) => RANKS.indexOf(ch);

/** 展开单条范围描述为类别数组 */
function expand(spec: string): string[] {
  const plus = spec.endsWith("+");
  const body = plus ? spec.slice(0, -1) : spec;
  const out: string[] = [];
  if (body.length === 2) {
    // 对子："TT" 或 "TT+"
    const r = rIdx(body[0]);
    const from = r;
    const to = plus ? 12 : r;
    for (let i = from; i <= to; i++) out.push(RANKS[i] + RANKS[i]);
    return out;
  }
  // 非对子："AKs" / "A2s+" / "KQo"
  const hi = rIdx(body[0]);
  const lo = rIdx(body[1]);
  const suffix = body[2]; // 's' | 'o'
  const to = plus ? hi - 1 : lo;
  for (let i = lo; i <= to; i++) out.push(RANKS[hi] + RANKS[i] + suffix);
  return out;
}

function makeRange(specs: string[]): Set<string> {
  const set = new Set<string>();
  for (const s of specs) for (const c of expand(s)) set.add(c);
  return set;
}

/** 率先开局（RFI）范围 —— 求解器公开范围表（100bb，加注 2.5bb） */
export const RFI_RANGES: Record<string, Set<string>> = {
  // LJ 17.6%
  UTG: makeRange(["66+", "A3s+", "K8s+", "Q9s+", "J9s+", "T9s", "ATo+", "KJo+", "QJo"]),
  // HJ 21.4%
  MP: makeRange(["55+", "A2s+", "K6s+", "Q9s+", "J9s+", "T9s", "98s", "87s", "76s", "ATo+", "KTo+", "QTo+"]),
  // CO 27.8%
  CO: makeRange(["33+", "A2s+", "K3s+", "Q6s+", "J8s+", "T7s+", "97s+", "87s", "76s", "A8o+", "KTo+", "QTo+", "JTo"]),
  // BTN 43.5%
  BTN: makeRange(["33+", "A2s+", "K2s+", "Q3s+", "J4s+", "T6s+", "96s+", "85s+", "75s+", "64s+", "53s+", "A4o+", "K8o+", "Q9o+", "J9o+", "T8o+", "98o"]),
  // SB（raise-only 口径，约 40%）
  SB: makeRange(["22+", "A2s+", "K2s+", "Q7s+", "J8s+", "T8s+", "98s", "87s", "76s", "65s", "54s", "A2o+", "KTo+", "QTo+", "JTo"]),
};

/** 面对加注时的策略表：threeBet=3bet 范围，call=跟注范围，其余弃牌 */
export interface VsRaiseChart {
  threeBet: Set<string>;
  call: Set<string>;
}

/** 有位置（CO/BTN）vs 前位开局 —— 公开求解器共识（3bet 2.6% / 跟注 6.5%） */
const VS_EARLY_IP: VsRaiseChart = {
  threeBet: makeRange(["QQ+", "AKs", "AKo"]),
  call: makeRange(["55", "66", "77", "88", "99", "TT", "JJ", "ATs+", "KQs", "QJs", "JTs", "T9s", "98s", "AQo"]),
};

/** 有位置 vs 后位开局 */
const VS_LATE_IP: VsRaiseChart = {
  threeBet: makeRange(["JJ+", "AQs+", "AKo"]),
  call: makeRange([
    "22+", "A2s+", "KTs+", "QTs+", "J9s+", "T9s", "98s", "87s", "AJo+", "KQo",
  ]),
};

/** 大盲 vs 前位开局（宽防守） */
const BB_VS_EARLY: VsRaiseChart = {
  threeBet: makeRange(["QQ+", "AKs", "AKo"]),
  call: makeRange([
    "22+", "A2s+", "KTs+", "QTs+", "J9s+", "T9s", "98s", "87s", "76s", "AJo+", "KQo",
  ]),
};

/** 大盲 vs 后位开局（最宽防守） */
const BB_VS_LATE: VsRaiseChart = {
  threeBet: makeRange(["JJ+", "AQs+", "AKo"]),
  call: makeRange([
    "22+", "A2s+", "K4s+", "Q6s+", "J7s+", "T7s+", "97s+", "86s+", "76s", "65s",
    "54s", "A2o+", "K8o+", "Q9o+", "J9o+", "T9o", "98o",
  ]),
};

export function vsRaiseChart(openerPos: Position, heroPos: Position): VsRaiseChart {
  const early = openerPos === "UTG" || openerPos === "MP";
  if (heroPos === "BB") return early ? BB_VS_EARLY : BB_VS_LATE;
  return early ? VS_EARLY_IP : VS_LATE_IP;
}

/** 全下范围（约 15bb 推 all-in） */
export const SHOVE_RANGES: Record<string, Set<string>> = {
  MP: makeRange(["22+", "A2s+", "KTs+", "QTs+", "JTs", "AJo+"]),
  CO: makeRange(["22+", "A2s+", "K9s+", "QTs+", "J9s+", "T9s", "ATo+", "KQo"]),
  BTN: makeRange(["22+", "A2s+", "K7s+", "Q9s+", "J9s+", "T9s", "98s", "87s", "A8o+", "KJo+", "QJo"]),
};

/** 各类别组合数（对子 6，同花 4，非同花 12），全库 1326 */
export const TOTAL_COMBOS = 1326;

export function rangeCombos(set: Set<string>): number {
  let n = 0;
  for (const c of set) n += c.length === 2 ? 6 : c.endsWith("s") ? 4 : 12;
  return n;
}

export function rangePct(set: Set<string>): string {
  return ((rangeCombos(set) / TOTAL_COMBOS) * 100).toFixed(0);
}

/** 生成"手牌在指定范围内"的过滤函数（供胜率蒙特卡洛拒绝采样） */
export function rangeFilter(range: Set<string>) {
  return (hole2: Card[]) => range.has(handClass(hole2[0], hole2[1]));
}
