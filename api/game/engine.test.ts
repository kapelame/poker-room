import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { evaluate7, handName } from "../../contracts/evaluate";
import { equityMonteCarlo } from "../../contracts/equity";
import { PokerRoom } from "./room";
import type { Card } from "../../contracts/game";

const C = (r: number, s: Card["s"]): Card => ({ r, s });

describe("胜率估算（蒙特卡洛）", () => {
  it("翻牌前 AA 显著强于 72o（单挑）", () => {
    const aa = equityMonteCarlo([C(14, "s"), C(14, "h")], [], 1, 800);
    const bad = equityMonteCarlo([C(7, "c"), C(2, "d")], [], 1, 800);
    // AA 单挑约 85%，72o 约 35%（蒙特卡洛留足误差空间）
    expect(aa).toBeGreaterThan(75);
    expect(bad).toBeLessThan(45);
    expect(aa).toBeGreaterThan(bad);
  });

  it("已成牌胜率远高于听牌", () => {
    // 公共牌 K♠ Q♠ 2♦：手中 K♥K♦（顶三条） vs J♠T♠（同花顺听）
    const board = [C(13, "s"), C(12, "s"), C(2, "d")];
    const trips = equityMonteCarlo([C(13, "h"), C(13, "d")], board, 1, 800);
    const draw = equityMonteCarlo([C(11, "s"), C(10, "s")], board, 1, 800);
    expect(trips).toBeGreaterThan(draw);
    expect(trips).toBeGreaterThan(55);
  });
});

describe("牌型评估器", () => {
  it("皇家同花顺 > 四条", () => {
    const royal = evaluate7([
      C(14, "s"),
      C(13, "s"),
      C(12, "s"),
      C(11, "s"),
      C(10, "s"),
      C(2, "d"),
      C(3, "c"),
    ]);
    const quads = evaluate7([
      C(9, "s"),
      C(9, "h"),
      C(9, "d"),
      C(9, "c"),
      C(14, "d"),
      C(2, "c"),
      C(5, "h"),
    ]);
    expect(royal.cat).toBe(8);
    expect(handName(royal.score, royal.cat)).toBe("皇家同花顺");
    expect(quads.cat).toBe(7);
    expect(royal.score).toBeGreaterThan(quads.score);
  });

  it("轮子顺子 A2345", () => {
    const wheel = evaluate7([
      C(14, "s"),
      C(2, "h"),
      C(3, "d"),
      C(4, "c"),
      C(5, "s"),
      C(9, "d"),
      C(11, "c"),
    ]);
    expect(wheel.cat).toBe(4);
    const sixHigh = evaluate7([
      C(2, "s"),
      C(3, "h"),
      C(4, "d"),
      C(5, "c"),
      C(6, "s"),
      C(9, "d"),
      C(11, "c"),
    ]);
    expect(sixHigh.score).toBeGreaterThan(wheel.score);
  });

  it("葫芦 > 同花 > 顺子 > 三条 > 两对 > 一对 > 高牌", () => {
    const mk = (cards: Card[]) => evaluate7(cards).score;
    const fh = mk([
      C(10, "s"),
      C(10, "h"),
      C(10, "d"),
      C(4, "c"),
      C(4, "s"),
      C(2, "d"),
      C(7, "c"),
    ]);
    const fl = mk([
      C(2, "s"),
      C(6, "s"),
      C(8, "s"),
      C(11, "s"),
      C(13, "s"),
      C(3, "d"),
      C(9, "c"),
    ]);
    const st = mk([
      C(5, "s"),
      C(6, "h"),
      C(7, "d"),
      C(8, "c"),
      C(9, "s"),
      C(2, "d"),
      C(13, "c"),
    ]);
    const tk = mk([
      C(7, "s"),
      C(7, "h"),
      C(7, "d"),
      C(2, "c"),
      C(11, "s"),
      C(3, "d"),
      C(9, "c"),
    ]);
    const tp = mk([
      C(8, "s"),
      C(8, "h"),
      C(4, "d"),
      C(4, "c"),
      C(13, "s"),
      C(2, "d"),
      C(7, "c"),
    ]);
    const op = mk([
      C(12, "s"),
      C(12, "h"),
      C(5, "d"),
      C(6, "c"),
      C(9, "s"),
      C(2, "d"),
      C(3, "c"),
    ]);
    const hc = mk([
      C(14, "s"),
      C(10, "h"),
      C(8, "d"),
      C(6, "c"),
      C(4, "s"),
      C(3, "d"),
      C(2, "c"),
    ]);
    expect(fh).toBeGreaterThan(fl);
    expect(fl).toBeGreaterThan(st);
    expect(st).toBeGreaterThan(tk);
    expect(tk).toBeGreaterThan(tp);
    expect(tp).toBeGreaterThan(op);
    expect(op).toBeGreaterThan(hc);
  });

  it("踢脚比较", () => {
    const a = evaluate7([
      C(14, "s"),
      C(14, "h"),
      C(13, "d"),
      C(9, "c"),
      C(5, "s"),
      C(3, "d"),
      C(2, "c"),
    ]);
    const b = evaluate7([
      C(14, "d"),
      C(14, "c"),
      C(12, "d"),
      C(9, "h"),
      C(5, "h"),
      C(3, "h"),
      C(2, "h"),
    ]);
    expect(a.score).toBeGreaterThan(b.score);
  });
});

describe("德州扑克引擎", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeRoom(n: number, chips = 1000) {
    const room = new PokerRoom("TEST01", "p0", {
      startingChips: chips,
      sb: 5,
      bb: 10,
    });
    for (let i = 0; i < n; i++) room.addPlayer(`p${i}`, `玩家${i}`);
    room.startHand();
    return room;
  }

  it("三人局：盲注、发牌、跟注到底摊牌，筹码守恒", async () => {
    const room = makeRoom(3);
    let s = room.toJSON("p0");
    expect(s.phase).toBe("preflop");
    expect(s.handNumber).toBe(1);
    // 座位: 0=庄家 1=小盲 2=大盲；翻牌前 0 先行动
    const sbP = s.players.find((p) => p.seat === 1)!;
    const bbP = s.players.find((p) => p.seat === 2)!;
    expect(sbP.bet).toBe(5);
    expect(bbP.bet).toBe(10);
    expect(s.turnSeat).toBe(0);
    expect(s.players.find((p) => p.seat === 0)!.hole).toHaveLength(2);
    // 其他玩家的手牌不可见
    expect(s.players.find((p) => p.seat === 1)!.hole).toBeUndefined();

    // 庄家跟注 10，小盲跟注（补5），大盲看牌
    expect(room.applyAction("p0", "call")).toBeNull();
    expect(room.applyAction("p1", "call")).toBeNull();
    expect(room.applyAction("p2", "check")).toBeNull();
    s = room.toJSON("p0");
    expect(s.phase).toBe("flop");
    expect(s.community).toHaveLength(3);
    expect(s.pot).toBe(30);

    // 翻牌/转牌/河牌全部看牌
    for (let i = 0; i < 3; i++) {
      const first = s.turnSeat;
      room.applyAction(`p${first}`, "check");
      s = room.toJSON("p0");
      room.applyAction(`p${s.turnSeat}`, "check");
      s = room.toJSON("p0");
      room.applyAction(`p${s.turnSeat}`, "check");
      s = room.toJSON("p0");
    }
    expect(s.phase).toBe("showdown");
    expect(s.community).toHaveLength(5);
    expect(s.players.reduce((a, p) => a + p.chips, 0)).toBe(3000);
    const winners = s.players.filter((p) => p.isWinner);
    expect(winners.length).toBeGreaterThanOrEqual(1);
    expect(winners.reduce((a, p) => a + (p.winAmount ?? 0), 0)).toBe(30);
    // 摊牌后：所有未弃牌玩家自动亮出两张手牌。
    const me = s.players.find((p) => p.id === "p0")!;
    expect(me.hole).toHaveLength(2);
    expect(me.handName).toBeTruthy();
    for (const p of s.players.filter(
      (x) => x.id !== "p0" && x.inHand && !x.folded,
    )) {
      expect(p.hole?.every((card) => card !== null)).toBe(true);
      expect(p.shown).toEqual([true, true]);
      expect(p.handName).toBeTruthy();
    }
    room.dispose();
  });

  it("亮牌机制：摊牌阶段强制亮出全部手牌", async () => {
    const room = makeRoom(3);
    // 快速打完：全部跟注/看牌到摊牌
    room.applyAction("p0", "call");
    room.applyAction("p1", "call");
    room.applyAction("p2", "check");
    for (let i = 0; i < 3; i++) {
      let s = room.toJSON("p0");
      for (let j = 0; j < 3; j++) {
        room.applyAction(`p${s.turnSeat}`, "check");
        s = room.toJSON("p0");
      }
    }
    const s = room.toJSON("p0");
    expect(s.phase).toBe("showdown");

    // 未到摊牌不能亮（用另一间房验证）
    const room2 = makeRoom(2);
    expect(room2.showCards("p0", [0])).toContain("结束后");
    room2.dispose();

    // 进入摊牌时已自动亮牌，重复亮牌请求保持幂等。
    expect(room.showCards("p1", [0])).toBeNull();
    let view = room.toJSON("p0");
    const p1 = view.players.find((p) => p.id === "p1")!;
    expect(p1.hole![0]).not.toBeNull();
    expect(p1.hole![1]).not.toBeNull();
    expect(p1.shown).toEqual([true, true]);
    expect(p1.handName).toBeTruthy();

    // 重复亮牌不改变状态。
    expect(room.showCards("p1", [1])).toBeNull();
    view = room.toJSON("p0");
    const p1b = view.players.find((p) => p.id === "p1")!;
    expect(p1b.hole![1]).not.toBeNull();
    expect(p1b.handName).toBeTruthy();

    // 已亮的牌重复亮 -> 静默成功
    expect(room.showCards("p1", [0, 1])).toBeNull();
    room.dispose();
  });

  it("弃牌获胜：大盲直接收池", () => {
    const room = makeRoom(3);
    room.applyAction("p0", "fold");
    room.applyAction("p1", "fold");
    const s = room.toJSON("p2");
    expect(s.phase).toBe("showdown");
    const bb = s.players.find((p) => p.seat === 2)!;
    expect(bb.isWinner).toBe(true);
    expect(bb.chips).toBe(1000 - 10 + 15);
    room.dispose();
  });

  it("单挑局：庄家即小盲且翻牌前先行动", () => {
    const room = makeRoom(2);
    const s = room.toJSON("p0");
    const dealer = s.players.find((p) => p.isDealer)!;
    expect(dealer.bet).toBe(5); // 庄家=小盲
    expect(s.turnSeat).toBe(dealer.seat);
    room.dispose();
  });

  it("胜率只在 all-in 后显示", async () => {
    const room = makeRoom(3);
    // 常规行动阶段无胜率
    let s = room.toJSON("p0");
    expect(s.phase).toBe("preflop");
    expect(s.equity).toBeUndefined();

    // p0 全下 -> 所有局中玩家看到胜率
    room.applyAction("p0", "allin");
    s = room.toJSON("p0");
    expect(typeof s.equity).toBe("number");
    expect(s.equity!).toBeGreaterThan(0);
    expect(s.equity!).toBeLessThanOrEqual(100);
    const s1 = room.toJSON("p1");
    expect(typeof s1.equity).toBe("number");

    // 等待阶段（waiting）无胜率
    const lobby = new PokerRoom("TEST04", "h", {
      startingChips: 1000,
      sb: 5,
      bb: 10,
    });
    lobby.addPlayer("h", "房主");
    expect(lobby.toJSON("h").equity).toBeUndefined();
    lobby.dispose();
    room.dispose();
  });

  it("全下边池：短码只赢自己那份", async () => {
    const room = new PokerRoom("TEST02", "p0", {
      startingChips: 1000,
      sb: 5,
      bb: 10,
    });
    room.addPlayer("p0", "A");
    room.addPlayer("p1", "B");
    room.addPlayer("p2", "C");
    // 自定义筹码：A=1000 B=400 C=100
    room.byId("p1")!.chips = 400;
    room.byId("p2")!.chips = 100;
    room.startHand();
    // p0 庄家(座0) 先行动，三家全下
    room.applyAction("p0", "allin");
    room.applyAction("p1", "allin");
    room.applyAction("p2", "allin");
    // 触发自动跑牌（翻/转/河 + 摊牌）
    await vi.advanceTimersByTimeAsync(1400 * 6);
    const s = room.toJSON("p0");
    expect(s.phase).toBe("showdown");
    expect(s.community).toHaveLength(5);
    // 总筹码守恒
    expect(s.players.reduce((a, p) => a + p.chips, 0)).toBe(1500);
    // 边池结构: 主池 300 (三家各100), 边池1 600 (A/B各300), 边池2 600 (A 超出部分退回)
    expect(s.pots.map((p) => p.amount)).toEqual([300, 600, 600]);
    expect(s.pots[0].eligible).toHaveLength(3);
    expect(s.pots[1].eligible).toHaveLength(2);
    expect(s.pots[2].eligible).toEqual(["p0"]);
    room.dispose();
  });

  it("断线玩家轮到行动时自动弃牌", async () => {
    const room = makeRoom(3);
    room.setConnected("p0", false); // 轮到 p0（庄家 UTG）
    await vi.advanceTimersByTimeAsync(700);
    const s = room.toJSON("p1");
    const p0 = s.players.find((p) => p.id === "p0")!;
    expect(p0.folded).toBe(true);
    expect(s.turnSeat).toBe(1);
    room.dispose();
  });

  it("重新买入与下一手自动开始", async () => {
    const room = makeRoom(2);
    room.byId("p1")!.chips = 10; // p1 只剩 10
    // p0(庄/小盲) 全下，p1 跟注全下
    room.applyAction("p0", "allin");
    room.applyAction("p1", "call");
    await vi.advanceTimersByTimeAsync(1400 * 6);
    let s = room.toJSON("p0");
    expect(s.phase).toBe("showdown");
    const loser = s.players.find((p) => p.chips === 0);
    if (loser) {
      if (loser.id === "p1") {
        // 非房主：申请 -> 房主批准
        expect(room.requestRebuy("p1")).toBeNull();
        expect(room.toJSON("p0").rebuyRequests).toHaveLength(1);
        expect(room.approveRebuy("p0", "p1")).toBeNull();
      } else {
        // 房主：自助登记，也在下一手生效
        expect(room.requestRebuy("p0")).toBeNull();
        expect(room.toJSON("p0").pendingBuyIns).toHaveLength(1);
        expect(loser.chips).toBe(0);
      }
      s = room.toJSON("p0");
      expect(s.players.find((p) => p.id === loser.id)!.chips).toBe(0);
      expect(s.pendingBuyIns).toHaveLength(1);
    }
    // 7 秒后自动开始下一手
    await vi.advanceTimersByTimeAsync(7000);
    s = room.toJSON("p0");
    expect(s.handNumber).toBe(2);
    expect(["preflop", "flop", "turn", "river", "showdown"]).toContain(s.phase);
    room.dispose();
  });

  it("买入审批流：申请 -> 拒绝 -> 再申请 -> 批准", () => {
    const room = new PokerRoom("TEST03", "p0", {
      startingChips: 1000,
      sb: 5,
      bb: 10,
    });
    room.addPlayer("p0", "房主");
    room.addPlayer("p1", "玩家1");
    room.startHand();
    room.byId("p1")!.chips = 0; // 模拟破产

    // 玩家1申请
    expect(room.requestRebuy("p1")).toBeNull();
    let s = room.toJSON("p0");
    expect(s.rebuyRequests).toHaveLength(1);
    expect(s.rebuyRequests[0].name).toBe("玩家1");
    expect(room.byId("p1")!.chips).toBe(0); // 未批准前筹码不变

    // 重复申请报错
    expect(room.requestRebuy("p1")).toContain("申请已提交");

    // 非房主不能审批
    expect(room.approveRebuy("p1", "p1")).toContain("只有房主");
    expect(room.rejectRebuy("p1", "p1")).toBeNull();

    // 房主拒绝
    expect(room.rejectRebuy("p0", "p1")).toBe("玩家1");
    expect(room.toJSON("p0").rebuyRequests).toHaveLength(0);
    expect(room.byId("p1")!.chips).toBe(0);

    // 再申请 -> 取消 -> 再申请 -> 批准
    expect(room.requestRebuy("p1")).toBeNull();
    room.cancelRebuy("p1");
    expect(room.toJSON("p0").rebuyRequests).toHaveLength(0);
    expect(room.requestRebuy("p1")).toBeNull();
    expect(room.approveRebuy("p0", "p1")).toBeNull();
    expect(room.byId("p1")!.chips).toBe(0);
    expect(room.toJSON("p0").pendingBuyIns).toHaveLength(1);

    // 当前手结束后，下一手开始时才到账。
    room.applyAction("p0", "fold");
    room.startHand();
    expect(room.byId("p1")!.chips).toBeGreaterThan(0);

    // 买入可以随时再次申请，审批后仍然排到下一手生效。
    expect(room.requestRebuy("p1")).toBeNull();

    // 记分板记账：玩家1 买入 2 次共 2000
    s = room.toJSON("p0");
    const entry = s.scoreboard.find((e) => e.playerId === "p1")!;
    expect(entry.buyIns).toBe(2);
    expect(entry.totalBuyIn).toBe(2000);
    expect(entry.profit).toBeGreaterThan(-1000);
    room.dispose();
  });

  it("记分板：手数 / 胜场 / 盈亏累计", async () => {
    const room = makeRoom(3);
    let s = room.toJSON("p0");
    // 第一手全员参与
    for (const e of s.scoreboard) expect(e.hands).toBe(1);

    // p0 弃牌，p1 弃牌，p2 收池
    room.applyAction("p0", "fold");
    room.applyAction("p1", "fold");
    s = room.toJSON("p2");
    expect(s.phase).toBe("showdown");
    const p2 = s.scoreboard.find((e) => e.playerId === "p2")!;
    expect(p2.wins).toBe(1);
    expect(p2.profit).toBe(5); // 筹码 1005 - 买入 1000
    const p0 = s.scoreboard.find((e) => e.playerId === "p0")!;
    expect(p0.wins).toBe(0);
    expect(p0.profit).toBe(0); // 未下注
    // 记分板按盈亏降序
    expect(s.scoreboard[0].playerId).toBe("p2");

    // 第二手后所有在场者手数+1
    await vi.advanceTimersByTimeAsync(7000);
    s = room.toJSON("p0");
    expect(s.handNumber).toBe(2);
    for (const e of s.scoreboard) expect(e.hands).toBe(2);
    room.dispose();
  });

  it("中途加入只作为旁观者，下一手才拿牌", () => {
    const room = makeRoom(2);
    const before = room.toJSON("p0");
    const newcomer = room.addPlayer("p2", "中途玩家");
    const during = room.toJSON("p2");
    expect(during.handNumber).toBe(before.handNumber);
    expect(during.players.find((p) => p.id === newcomer.id)?.inHand).toBe(
      false,
    );
    expect(during.players.find((p) => p.id === newcomer.id)?.chips).toBe(0);
    expect(during.players.find((p) => p.id === newcomer.id)?.hole).toEqual([]);
    expect(during.rebuyRequests).toHaveLength(1);
    expect(during.rebuyRequests[0].playerId).toBe(newcomer.id);
    expect(during.rebuyRequests[0].mode).toBe("oneHand");
    room.dispose();
  });

  it("决策超时会自动看牌或弃牌", async () => {
    const room = makeRoom(2);
    expect(room.setDecisionTime("p0", 5)).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    const state = room.toJSON("p1");
    expect(state.phase).toBe("showdown");
    expect(state.log.some((line) => line.includes("超时自动"))).toBe(true);
    room.dispose();
  });

  it("踢出当前手玩家不会吞掉其已下注筹码", () => {
    const room = makeRoom(3);
    room.applyAction("p0", "call");
    const before = room.byId("p0")!.handBet;
    room.removePlayer("p0");
    expect(room.byId("p0")).toBeTruthy();
    expect(room.byId("p0")!.folded).toBe(true);
    expect(room.byId("p0")!.handBet).toBe(before);
    room.applyAction("p1", "fold");
    const state = room.toJSON("p2");
    expect(state.phase).toBe("showdown");
    expect(state.players.some((p) => p.id === "p0")).toBe(false);
    room.dispose();
  });

  it("有筹码时也可以申请买入，批准后下一手生效", () => {
    const room = new PokerRoom("TEST05", "p0", {
      startingChips: 1000,
      sb: 5,
      bb: 10,
    });
    room.addPlayer("p0", "房主");
    room.addPlayer("p1", "玩家1");
    room.startHand();
    const before = room.byId("p1")!.chips;
    expect(room.requestRebuy("p1")).toBeNull();
    expect(room.approveRebuy("p0", "p1", 1200)).toBeNull();
    expect(room.byId("p1")!.chips).toBe(before);
    room.applyAction("p0", "fold");
    room.startHand();
    expect(room.byId("p1")!.chips).toBeGreaterThan(before);
    expect(room.toJSON("p0").pendingBuyIns).toHaveLength(0);
    room.dispose();
  });

  it("大厅阶段不能申请买入，游戏中支持四种金额模式", () => {
    const room = new PokerRoom("TEST06", "p0", {
      startingChips: 1000,
      buyInAmount: 800,
      sb: 5,
      bb: 10,
    });
    room.addPlayer("p0", "房主");
    room.addPlayer("p1", "玩家1");
    expect(room.requestRebuy("p1")).toContain("游戏开始后");

    room.startHand();
    room.byId("p1")!.chips = 0;
    expect(room.requestRebuy("p1", "oneHand")).toBeNull();
    expect(room.toJSON("p0").rebuyRequests[0].amount).toBe(800);
    room.cancelRebuy("p1");

    room.byId("p0")!.chips = 1500;
    room.byId("p1")!.chips = 500;
    expect(room.requestRebuy("p1", "average")).toBeNull();
    expect(room.toJSON("p0").rebuyRequests[0].amount).toBe(500);
    room.cancelRebuy("p1");

    expect(room.requestRebuy("p1", "leader")).toBeNull();
    expect(room.toJSON("p0").rebuyRequests[0].amount).toBe(1000);
    room.cancelRebuy("p1");

    expect(room.requestRebuy("p1", "custom", 1234)).toBeNull();
    expect(room.approveRebuy("p0", "p1", 1500)).toBeNull();
    expect(room.toJSON("p0").pendingBuyIns[0].amount).toBe(1500);
    room.dispose();
  });
});
