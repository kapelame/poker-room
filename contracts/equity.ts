import type { Card, Suit } from "./game";
import { evaluate7 } from "./evaluate";

const keyOf = (c: Card) => c.r * 4 + "shdc".indexOf(c.s);

/** 构建排除已知牌后的剩余牌堆 */
function remainingDeck(exclude: Card[]): Card[] {
  const used = new Set(exclude.map(keyOf));
  const deck: Card[] = [];
  for (const s of ["s", "h", "d", "c"] as Suit[]) {
    for (let r = 2; r <= 14; r++) {
      const c = { r, s };
      if (!used.has(keyOf(c))) deck.push(c);
    }
  }
  return deck;
}

/**
 * 蒙特卡洛估算胜率（含平分底池折算），返回 0-100。
 * hole: 自己的两张手牌；community: 已发出的公共牌（0/3/4/5 张）；
 * numOpponents: 仍在局中的对手数；
 * acceptOpp: 可选，对手手牌的过滤函数（如限定在某个范围内），
 *            仅在单挑（numOpponents === 1）时生效，采用拒绝采样。
 */
export function equityMonteCarlo(
  hole: Card[],
  community: Card[],
  numOpponents: number,
  iterations = 600,
  acceptOpp?: (oppHole: Card[]) => boolean,
): number {
  if (hole.length !== 2 || numOpponents < 1) return 0;
  if (community.length > 5) return 0;
  const deck = remainingDeck([...hole, ...community]);
  const needBoard = 5 - community.length;
  const picks = needBoard + 2 * numOpponents;
  if (deck.length < picks) return 0;
  const useFilter = acceptOpp != null && numOpponents === 1;

  let equity = 0;
  let counted = 0;
  for (let it = 0; it < iterations; it++) {
    // 部分 Fisher-Yates：抽出前 picks 张（有范围过滤时拒绝采样，最多 40 次）
    let pool: Card[] = [];
    let accepted = false;
    for (let attempt = 0; attempt < (useFilter ? 40 : 1); attempt++) {
      pool = deck.slice();
      for (let i = 0; i < picks; i++) {
        const j = i + Math.floor(Math.random() * (pool.length - i));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      if (
        !useFilter ||
        acceptOpp([pool[needBoard], pool[needBoard + 1]])
      ) {
        accepted = true;
        break;
      }
    }
    if (!accepted) continue; // 极窄范围采样失败则跳过本次
    counted++;

    const board = [...community, ...pool.slice(0, needBoard)];
    const myScore = evaluate7([...hole, ...board]).score;

    let best = -1;
    let bestCount = 0;
    for (let o = 0; o < numOpponents; o++) {
      const oppHole = [pool[needBoard + 2 * o], pool[needBoard + 2 * o + 1]];
      const s = evaluate7([...oppHole, ...board]).score;
      if (s > best) {
        best = s;
        bestCount = 1;
      } else if (s === best) {
        bestCount++;
      }
    }
    if (myScore > best) equity += 1;
    else if (myScore === best) equity += 1 / (bestCount + 1); // 平分折算
  }
  if (counted === 0) return 0;
  return (equity / counted) * 100;
}
