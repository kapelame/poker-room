import { describe, it, expect } from "vitest";
import { genScenario, grade, applyResult, SCORE_FULL, SCORE_PARTIAL } from "./scenario";
import { handClass, RFI_RANGES, vsRaiseChart, rangeCombos } from "./ranges";
import type { Card } from "@contracts/game";

const C = (r: number, s: Card["s"]): Card => ({ r, s });

describe("GTO 范围表", () => {
  it("handClass 正确归类", () => {
    expect(handClass(C(14, "s"), C(14, "h"))).toBe("AA");
    expect(handClass(C(14, "s"), C(13, "s"))).toBe("AKs");
    expect(handClass(C(13, "h"), C(14, "d"))).toBe("AKo"); // 自动高点在前
    expect(handClass(C(7, "c"), C(2, "c"))).toBe("72s");
  });

  it("BTN 范围宽于 UTG，且强牌在所有范围内", () => {
    for (const pos of ["UTG", "MP", "CO", "BTN", "SB"]) {
      expect(RFI_RANGES[pos].has("AA")).toBe(true);
      expect(RFI_RANGES[pos].has("AKs")).toBe(true);
    }
    expect(rangeCombos(RFI_RANGES.BTN)).toBeGreaterThan(rangeCombos(RFI_RANGES.UTG));
    // 垃圾牌不在任何范围
    expect(RFI_RANGES.UTG.has("72o")).toBe(false);
    expect(RFI_RANGES.BTN.has("72o")).toBe(false);
  });

  it("vs 前位 chart 比 vs 后位更紧，BB 防守宽于有位置", () => {
    const early = vsRaiseChart("UTG", "BTN");
    const late = vsRaiseChart("CO", "BTN");
    expect(early.threeBet.has("QQ")).toBe(true);
    expect(rangeCombos(late.call)).toBeGreaterThan(rangeCombos(early.call));
    const bbLate = vsRaiseChart("CO", "BB");
    expect(rangeCombos(bbLate.call)).toBeGreaterThan(rangeCombos(late.call));
  });
});

describe("GTO 场景生成与评分", () => {
  it("生成的场景结构完整且答案合法", () => {
    for (let i = 0; i < 50; i++) {
      const s = genScenario();
      expect(s.hole).toHaveLength(2);
      expect(s.options.length).toBeGreaterThanOrEqual(2);
      expect(s.options.some((o) => o.id === s.correctId)).toBe(true);
      expect(s.explanation.length).toBeGreaterThan(0);
      expect(s.opponents).toBeGreaterThanOrEqual(1);
      expect(s.playersBehind).toBeGreaterThanOrEqual(0);
      expect(s.stackBb).toBeGreaterThan(0); // 后手信息完整
      if (s.kind === "postflop") {
        expect([3, 4]).toContain(s.board.length);
        expect([1, 2, 3]).toContain(s.opponents);
        expect(s.villainPos).toBeTruthy(); // 下注者位置
      }
      if (s.kind === "cbet") {
        expect(s.board).toHaveLength(3); // 翻牌圈
        expect(s.villainPos).toBeTruthy();
        expect(s.options.map((o) => o.id)).toContain("bet");
      }
      if (s.kind === "vsAllIn") {
        expect(s.board).toHaveLength(0);
        expect(s.villainPos).toBeTruthy(); // 全下者位置
        expect(s.options.map((o) => o.id)).toContain("call");
      }
      if (s.kind === "rfi" || s.kind === "vsRaise" || s.kind === "vsAllIn") {
        expect(s.board).toHaveLength(0);
      }
      if (s.kind === "vsRaise") {
        expect(s.villainPos).toBeTruthy(); // 加注者位置
      }
      if (s.kind === "rfi") {
        // 位置越靠前，身后未行动玩家越多
        const behindMap: Record<string, number> = {
          UTG: 5, MP: 4, CO: 3, BTN: 2, SB: 1,
        };
        expect(s.playersBehind).toBe(behindMap[s.heroPos]);
        expect(s.opponents).toBe(s.playersBehind);
      }
      // 手牌与公共牌无重复
      const keys = new Set([...s.hole, ...s.board].map((c) => `${c.r}${c.s}`));
      expect(keys.size).toBe(s.hole.length + s.board.length);
    }
  });

  it("防重复：不会连续生成同类型同位置的题", () => {
    const prev = { kind: "rfi" as const, heroPos: "BTN" as const };
    for (let i = 0; i < 30; i++) {
      const s = genScenario(prev);
      expect(!(s.kind === prev.kind && s.heroPos === prev.heroPos)).toBe(true);
    }
  });

  it("评分：正确满分 / 边缘半分 / 错误零分", () => {
    const fake = {
      kind: "rfi" as const,
      title: "",
      detail: "",
      heroPos: "BTN" as const,
      opponents: 2,
      playersBehind: 2,
      stackBb: 100,
      hole: [C(14, "s"), C(14, "h")],
      board: [],
      options: [
        { id: "raise", label: "加注" },
        { id: "fold", label: "弃牌" },
      ],
      correctId: "raise",
      partialId: "fold",
      explanation: "",
    };
    expect(grade(fake, "raise")).toEqual({
      score: SCORE_FULL,
      isCorrect: true,
      isPartial: false,
    });
    expect(grade(fake, "fold")).toEqual({
      score: SCORE_PARTIAL,
      isCorrect: false,
      isPartial: true,
    });
    expect(grade(fake, "nope").score).toBe(0);
  });

  it("积分累计与连击奖励", () => {
    let stats = { score: 0, answered: 0, correct: 0, streak: 0, bestStreak: 0 };
    const right = { score: 10, isCorrect: true, isPartial: false };
    const wrong = { score: 0, isCorrect: false, isPartial: false };
    stats = applyResult(stats, right); // streak 1
    stats = applyResult(stats, right); // streak 2
    expect(stats.score).toBe(20);
    stats = applyResult(stats, right); // streak 3 -> +5 奖励
    expect(stats.score).toBe(35);
    expect(stats.streak).toBe(3);
    expect(stats.bestStreak).toBe(3);
    stats = applyResult(stats, wrong); // 断连击
    expect(stats.streak).toBe(0);
    expect(stats.correct).toBe(3);
    expect(stats.answered).toBe(4);
  });
});
