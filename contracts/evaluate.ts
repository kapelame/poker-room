import type { Card } from "./game";
import { HAND_NAMES } from "./game";

/**
 * 5 张牌评分：score = category * 15^5 + 逐位平局比较（base-15 编码）
 * category: 0 高牌 1 一对 2 两对 3 三条 4 顺子 5 同花 6 葫芦 7 四条 8 同花顺
 */
function evaluate5(cards: Card[]): { score: number; cat: number } {
  const ranks = cards.map((c) => c.r).sort((a, b) => b - a);
  const flush = cards.every((c) => c.s === cards[0].s);

  // 统计每个点数出现次数
  const count = new Map<number, number>();
  for (const r of ranks) count.set(r, (count.get(r) ?? 0) + 1);
  // groups: [点数, 个数] 按个数降序、点数降序
  const groups = [...count.entries()]
    .map(([r, n]) => ({ r, n }))
    .sort((a, b) => b.n - a.n || b.r - a.r);

  // 顺子判定（含 A2345 轮子）
  let straightHigh = 0;
  const uniq = [...new Set(ranks)];
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5) straightHigh = 5; // wheel
  }

  const enc = (rs: number[]) =>
    rs.reduce((acc, r) => acc * 15 + r, 0);

  const n1 = groups[0].n;
  let cat: number;
  let tieRanks: number[];

  if (flush && straightHigh) {
    cat = 8;
    tieRanks = [straightHigh];
  } else if (n1 === 4) {
    cat = 7;
    tieRanks = [groups[0].r, groups[1].r];
  } else if (n1 === 3 && groups[1].n === 2) {
    cat = 6;
    tieRanks = [groups[0].r, groups[1].r];
  } else if (flush) {
    cat = 5;
    tieRanks = ranks;
  } else if (straightHigh) {
    cat = 4;
    tieRanks = [straightHigh];
  } else if (n1 === 3) {
    cat = 3;
    tieRanks = [groups[0].r, groups[1].r, groups[2].r];
  } else if (n1 === 2 && groups[1].n === 2) {
    cat = 2;
    tieRanks = [groups[0].r, groups[1].r, groups[2].r];
  } else if (n1 === 2) {
    cat = 1;
    tieRanks = [
      groups[0].r,
      ...groups
        .slice(1)
        .map((g) => g.r)
        .sort((a, b) => b - a),
    ];
  } else {
    cat = 0;
    tieRanks = ranks;
  }

  while (tieRanks.length < 5) tieRanks.push(0);
  return { score: cat * 15 ** 5 + enc(tieRanks.slice(0, 5)), cat };
}

/** 7 选 5 枚举，返回最佳牌型 */
export function evaluate7(cards: Card[]): { score: number; cat: number } {
  let best = { score: -1, cat: 0 };
  const n = cards.length;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const v = evaluate5([
              cards[a],
              cards[b],
              cards[c],
              cards[d],
              cards[e],
            ]);
            if (v.score > best.score) best = v;
          }
  return best;
}

/** 牌型中文名（同花顺 A 高 => 皇家同花顺） */
export function handName(score: number, cat: number): string {
  if (cat === 8) {
    const high = Math.floor((score % 15 ** 5) / 15 ** 4);
    if (high === 14) return HAND_NAMES[9];
  }
  return HAND_NAMES[cat];
}

export const RANK_CHARS = "23456789TJQKA"; // 下标 0..12 对应 rank 2..14

export function rankChar(r: number): string {
  return RANK_CHARS[r - 2];
}

/** 两张牌 -> 类别字符串："AA" / "AKs" / "AKo"（高点在前） */
export function handClass(c1: Card, c2: Card): string {
  const hi = Math.max(c1.r, c2.r);
  const lo = Math.min(c1.r, c2.r);
  if (hi === lo) return rankChar(hi) + rankChar(lo);
  return rankChar(hi) + rankChar(lo) + (c1.s === c2.s ? "s" : "o");
}
