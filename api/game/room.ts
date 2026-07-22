import type {
  ActionType,
  Card,
  Phase,
  PotInfo,
  PublicPlayer,
  RebuyRequest,
  RoomState,
  ScoreEntry,
  Suit,
} from "../../contracts/game";
import { cardToString } from "../../contracts/game";
import { evaluate7, handName } from "../../contracts/evaluate";
import { equityMonteCarlo } from "../../contracts/equity";
import { randomInt } from "node:crypto";

export interface Player {
  id: string;
  name: string;
  seat: number;
  chips: number;
  bet: number; // 本轮下注
  handBet: number; // 本手累计下注
  folded: boolean;
  allIn: boolean;
  connected: boolean;
  hole: Card[];
  shown: boolean[]; // 摊牌阶段各张手牌是否已亮出
  lastAction?: string;
  inHand: boolean;
  hasActed: boolean;
  handName?: string;
  winAmount?: number;
  isWinner?: boolean;
  score?: number;
}

/** 记分板统计（跨手累计，玩家离房后清除） */
interface PlayerStats {
  hands: number; // 参与手数
  wins: number; // 赢下手数
  buyIns: number; // 买入次数（含初始）
  totalBuyIn: number; // 累计买入筹码
}

const NEXT_HAND_DELAY = 7000;
const RUNOUT_DELAY = 1400;
const AUTO_ACTION_DELAY = 600;

function createDeck(): Card[] {
  const suits: Suit[] = ["s", "h", "d", "c"];
  const deck: Card[] = [];
  for (const s of suits) for (let r = 2; r <= 14; r++) deck.push({ r, s });
  // Fisher-Yates with crypto randomness
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export class PokerRoom {
  code: string;
  players: Player[] = [];
  hostId: string;
  phase: Phase = "waiting";
  sb: number;
  bb: number;
  startingChips: number;

  private deck: Card[] = [];
  community: Card[] = [];
  private pots: PotInfo[] = [];
  currentBet = 0;
  minRaise = 0;
  dealerSeat = -1;
  turnSeat = -1;
  handNumber = 0;
  private logLines: string[] = [];
  private nextHandAt?: number;
  private timers: ReturnType<typeof setTimeout>[] = [];

  /** 记分板统计 */
  private stats = new Map<string, PlayerStats>();
  /** 待房主审批的买入请求 */
  private pendingRebuy = new Map<string, RebuyRequest>();
  /** 胜率缓存：playerId -> { key, value }，手牌/公共牌/存活对手变化时失效 */
  private equityCache = new Map<string, { key: string; value: number }>();

  /** 状态变化回调（由 manager 注入用于广播） */
  onChange: () => void = () => {};

  /** 房间销毁：清理所有定时器 */
  dispose() {
    this.clearTimers();
  }

  constructor(
    code: string,
    hostId: string,
    opts: { startingChips: number; sb: number; bb: number },
  ) {
    this.code = code;
    this.hostId = hostId;
    this.startingChips = opts.startingChips;
    this.sb = opts.sb;
    this.bb = opts.bb;
  }

  /* ---------------- 工具 ---------------- */

  private log(msg: string) {
    this.logLines.push(msg);
    if (this.logLines.length > 120) this.logLines.shift();
  }

  private later(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      this.timers = this.timers.filter((x) => x !== t);
      fn();
    }, ms);
    this.timers.push(t);
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  bySeat(seat: number): Player | undefined {
    return this.players.find((p) => p.seat === seat);
  }

  byId(id: string): Player | undefined {
    return this.players.find((p) => p.id === id);
  }

  private inHandPlayers(): Player[] {
    return this.players.filter((p) => p.inHand);
  }

  /** 从 seat 之后（不含）按座位号环形找下一个满足条件的玩家 */
  private nextSeatAfter(
    seat: number,
    pred: (p: Player) => boolean,
  ): Player | undefined {
    const sorted = [...this.players].sort((a, b) => a.seat - b.seat);
    if (!sorted.length) return undefined;
    for (let i = 1; i <= sorted.length; i++) {
      const idx =
        (sorted.findIndex((p) => p.seat === seat) + i) % sorted.length;
      const p = sorted[(idx + sorted.length) % sorted.length];
      if (pred(p)) return p;
    }
    return undefined;
  }

  /* ---------------- 房间管理 ---------------- */

  addPlayer(id: string, name: string): Player {
    const used = new Set(this.players.map((p) => p.seat));
    let seat = 0;
    while (used.has(seat)) seat++;
    const p: Player = {
      id,
      name,
      seat,
      chips: this.startingChips,
      bet: 0,
      handBet: 0,
      folded: false,
      allIn: false,
      connected: true,
      hole: [],
      shown: [],
      inHand: false,
      hasActed: false,
    };
    this.players.push(p);
    this.stats.set(id, {
      hands: 0,
      wins: 0,
      buyIns: 1,
      totalBuyIn: this.startingChips,
    });
    this.log(`${name} 加入了牌桌`);
    return p;
  }

  removePlayer(id: string) {
    const p = this.byId(id);
    if (!p) return;
    this.log(`${p.name} 离开了牌桌`);
    // 手牌进行中先按弃牌处理
    if (
      p.inHand &&
      !p.folded &&
      this.phase !== "waiting" &&
      this.phase !== "showdown"
    ) {
      p.folded = true;
      const wasTurn = this.turnSeat === p.seat;
      if (wasTurn) {
        this.players = this.players.filter((x) => x.id !== id);
        this.afterTurnLeft();
      } else {
        this.players = this.players.filter((x) => x.id !== id);
        // 可能只剩一人
        this.checkEarlyEnd();
      }
    } else {
      this.players = this.players.filter((x) => x.id !== id);
    }
    if (this.hostId === id && this.players.length) {
      this.hostId = this.players[0].id;
      this.log(`${this.players[0].name} 成为房主`);
    }
    this.stats.delete(id);
    this.pendingRebuy.delete(id);
    this.equityCache.delete(id);
    this.onChange();
  }

  setConnected(id: string, connected: boolean) {
    const p = this.byId(id);
    if (!p) return;
    p.connected = connected;
    if (!connected) {
      this.log(`${p.name} 断线了`);
      // 轮到断线者行动 => 自动过牌/弃牌
      if (
        this.turnSeat === p.seat &&
        ["preflop", "flop", "turn", "river"].includes(this.phase)
      ) {
        this.scheduleAutoAction(p);
      }
    } else {
      this.log(`${p.name} 重新连接`);
    }
    this.onChange();
  }

  /* ---------------- 游戏流程 ---------------- */

  startHand() {
    this.clearTimers();
    this.nextHandAt = undefined;
    const eligible = this.players.filter((p) => p.chips > 0 && p.connected);
    if (eligible.length < 2) {
      this.phase = "waiting";
      this.onChange();
      return;
    }
    if (this.phase !== "waiting" && this.phase !== "showdown") return;

    this.handNumber++;
    this.phase = "preflop";
    this.deck = createDeck();
    this.community = [];
    this.pots = [];
    this.currentBet = 0;
    this.minRaise = this.bb;

    for (const p of this.players) {
      p.bet = 0;
      p.handBet = 0;
      p.folded = false;
      p.allIn = false;
      p.hole = [];
      p.shown = [];
      p.lastAction = undefined;
      p.inHand = false;
      p.hasActed = false;
      p.handName = undefined;
      p.winAmount = undefined;
      p.isWinner = undefined;
      p.score = undefined;
    }
    for (const p of eligible) {
      p.inHand = true;
      const st = this.stats.get(p.id);
      if (st) st.hands++;
    }
    this.equityCache.clear();

    // 庄家轮转
    const nextDealer = this.nextSeatAfter(
      this.dealerSeat,
      (p) => p.inHand,
    );
    this.dealerSeat = nextDealer ? nextDealer.seat : eligible[0].seat;

    const headsUp = eligible.length === 2;
    const sbP = headsUp
      ? this.bySeat(this.dealerSeat)!
      : this.nextSeatAfter(this.dealerSeat, (p) => p.inHand)!;
    const bbP = this.nextSeatAfter(sbP.seat, (p) => p.inHand)!;

    this.postBlind(sbP, this.sb, "小盲");
    this.postBlind(bbP, this.bb, "大盲");
    this.currentBet = Math.max(sbP.bet, bbP.bet);

    // 发牌
    for (let i = 0; i < 2; i++) {
      let cur: Player | undefined = sbP;
      do {
        cur.hole.push(this.deck.pop()!);
        cur = this.nextSeatAfter(cur.seat, (p) => p.inHand);
      } while (cur && cur.seat !== sbP.seat);
    }

    this.log(`—— 第 ${this.handNumber} 手牌开始 ——`);

    const first = headsUp
      ? this.bySeat(this.dealerSeat)!
      : this.nextSeatAfter(bbP.seat, (p) => p.inHand)!;
    this.turnSeat = first.seat;
    // 盲注已让所有人全下的极端情况：直接跑牌
    if (this.roundComplete()) {
      this.nextStreet();
      return;
    }
    if (!first.connected) this.scheduleAutoAction(first);
    this.onChange();
  }

  private postBlind(p: Player, amount: number, label: string) {
    const pay = Math.min(amount, p.chips);
    p.chips -= pay;
    p.bet = pay;
    p.handBet = pay;
    if (p.chips === 0) p.allIn = true;
    this.log(`${p.name} 下${label} ${pay}`);
  }

  /** 当前玩家动作 */
  applyAction(id: string, action: ActionType, amount?: number): string | null {
    const p = this.byId(id);
    if (!p) return "玩家不存在";
    if (p.seat !== this.turnSeat) return "还没轮到你";
    if (!["preflop", "flop", "turn", "river"].includes(this.phase))
      return "当前不能行动";

    const toCall = this.currentBet - p.bet;

    switch (action) {
      case "fold": {
        p.folded = true;
        p.lastAction = "弃牌";
        this.log(`${p.name} 弃牌`);
        break;
      }
      case "check": {
        if (toCall > 0) return "无法看牌，需要跟注";
        p.lastAction = "看牌";
        this.log(`${p.name} 看牌`);
        break;
      }
      case "call": {
        if (toCall <= 0) return "无需跟注";
        const pay = Math.min(toCall, p.chips);
        p.chips -= pay;
        p.bet += pay;
        p.handBet += pay;
        if (p.chips === 0) {
          p.allIn = true;
          p.lastAction = `全下 ${p.bet}`;
          this.log(`${p.name} 全下 ${p.bet}`);
        } else {
          p.lastAction = `跟注 ${pay}`;
          this.log(`${p.name} 跟注 ${pay}`);
        }
        break;
      }
      case "raise":
      case "allin": {
        const maxBet = p.bet + p.chips;
        let target = action === "allin" ? maxBet : Math.floor(amount ?? 0);
        if (target > maxBet) target = maxBet;
        // 全下金额不足当前最高注 => 视为全下跟注
        if (target <= this.currentBet) {
          if (action === "raise" && target < maxBet)
            return "加注必须超过当前最高注";
          const pay = p.chips;
          p.chips = 0;
          p.bet += pay;
          p.handBet += pay;
          p.allIn = true;
          p.lastAction = `全下 ${p.bet}`;
          this.log(`${p.name} 全下 ${p.bet}`);
          break;
        }
        const minTarget = this.currentBet + this.minRaise;
        if (target < minTarget && target < maxBet)
          return `最小加注到 ${minTarget}`;
        const pay = target - p.bet;
        p.chips -= pay;
        p.bet = target;
        p.handBet += pay;
        const increment = target - this.currentBet;
        if (increment >= this.minRaise) {
          this.minRaise = increment;
          // 完整加注，重新打开行动
          for (const o of this.players) if (o.id !== p.id) o.hasActed = false;
        }
        this.currentBet = Math.max(this.currentBet, target);
        if (p.chips === 0) {
          p.allIn = true;
          p.lastAction = `全下 ${p.bet}`;
          this.log(`${p.name} 全下 ${p.bet}`);
        } else {
          p.lastAction = toCall === 0 ? `下注 ${pay}` : `加注到 ${p.bet}`;
          this.log(
            toCall === 0
              ? `${p.name} 下注 ${pay}`
              : `${p.name} 加注到 ${p.bet}`,
          );
        }
        break;
      }
    }
    p.hasActed = true;
    this.advance();
    return null;
  }

  /** 行动后推进：结束手牌 / 进入下一条街 / 轮到下一位 */
  private advance() {
    const alive = this.inHandPlayers().filter((p) => !p.folded);
    if (alive.length === 1) {
      this.endHandFold(alive[0]);
      return;
    }
    if (this.roundComplete()) {
      this.nextStreet();
      return;
    }
    const next = this.nextSeatAfter(
      this.turnSeat,
      (p) => p.inHand && !p.folded && !p.allIn,
    );
    if (!next) {
      this.nextStreet();
      return;
    }
    this.turnSeat = next.seat;
    if (!next.connected) this.scheduleAutoAction(next);
    this.onChange();
  }

  /** 有玩家离开时（已弃牌）检查是否提前结束 */
  private checkEarlyEnd() {
    if (!["preflop", "flop", "turn", "river"].includes(this.phase)) return;
    const alive = this.inHandPlayers().filter((p) => !p.folded);
    if (alive.length === 1) {
      this.endHandFold(alive[0]);
    }
  }

  private afterTurnLeft() {
    if (!["preflop", "flop", "turn", "river"].includes(this.phase)) return;
    const alive = this.inHandPlayers().filter((p) => !p.folded);
    if (alive.length === 1) {
      this.endHandFold(alive[0]);
      return;
    }
    if (this.roundComplete()) {
      this.nextStreet();
      return;
    }
    const next = this.nextSeatAfter(
      this.turnSeat,
      (p) => p.inHand && !p.folded && !p.allIn,
    );
    if (next) {
      this.turnSeat = next.seat;
      if (!next.connected) this.scheduleAutoAction(next);
    } else {
      this.nextStreet();
    }
  }

  private roundComplete(): boolean {
    const alive = this.inHandPlayers().filter((p) => !p.folded);
    if (alive.length <= 1) return true;
    const canAct = alive.filter((p) => !p.allIn);
    if (canAct.length === 0) return true;
    return canAct.every((p) => p.hasActed && p.bet === this.currentBet);
  }

  private resetStreet() {
    for (const p of this.players) {
      p.bet = 0;
      p.hasActed = false;
    }
    this.currentBet = 0;
    this.minRaise = this.bb;
  }

  private dealStreet() {
    this.deck.pop(); // 烧牌
    if (this.phase === "preflop") {
      this.phase = "flop";
      this.community.push(this.deck.pop()!, this.deck.pop()!, this.deck.pop()!);
      this.log(`翻牌: ${this.community.map(cardToString).join(" ")}`);
    } else if (this.phase === "flop") {
      this.phase = "turn";
      const c = this.deck.pop()!;
      this.community.push(c);
      this.log(`转牌: ${cardToString(c)}`);
    } else if (this.phase === "turn") {
      this.phase = "river";
      const c = this.deck.pop()!;
      this.community.push(c);
      this.log(`河牌: ${cardToString(c)}`);
    }
  }

  private nextStreet() {
    this.resetStreet();
    if (this.phase === "river") {
      this.showdown();
      return;
    }
    const alive = this.inHandPlayers().filter((p) => !p.folded);
    const canAct = alive.filter((p) => !p.allIn);
    if (canAct.length <= 1) {
      // 所有人全下，自动发完剩余公共牌
      this.later(() => this.runoutStep(), RUNOUT_DELAY);
      this.onChange();
      return;
    }
    this.dealStreet();
    const first = this.nextSeatAfter(
      this.dealerSeat,
      (p) => p.inHand && !p.folded && !p.allIn,
    );
    if (!first) {
      this.later(() => this.runoutStep(), RUNOUT_DELAY);
      this.onChange();
      return;
    }
    this.turnSeat = first.seat;
    if (!first.connected) this.scheduleAutoAction(first);
    this.onChange();
  }

  /** 全下后的自动发牌流程 */
  private runoutStep() {
    if (this.phase === "river") {
      this.showdown();
      return;
    }
    this.dealStreet();
    this.onChange();
    this.later(() => this.runoutStep(), RUNOUT_DELAY);
  }

  private scheduleAutoAction(p: Player) {
    this.later(() => {
      if (this.turnSeat !== p.seat) return;
      if (!["preflop", "flop", "turn", "river"].includes(this.phase)) return;
      const toCall = this.currentBet - p.bet;
      if (toCall <= 0) {
        p.lastAction = "看牌";
        p.hasActed = true;
        this.log(`${p.name} 看牌（自动）`);
      } else {
        p.folded = true;
        p.lastAction = "弃牌";
        p.hasActed = true;
        this.log(`${p.name} 弃牌（断线自动）`);
      }
      this.advance();
    }, AUTO_ACTION_DELAY);
  }

  /* ---------------- 结算 ---------------- */

  /** 其他人都弃牌，直接获胜 */
  private endHandFold(winner: Player) {
    const total = this.players.reduce((s, p) => s + p.handBet, 0);
    winner.chips += total;
    winner.winAmount = total;
    winner.isWinner = true;
    const st = this.stats.get(winner.id);
    if (st) st.wins++;
    this.pots = [{ amount: total, eligible: [winner.id] }];
    this.log(`${winner.name} 赢得底池 ${total}`);
    this.finishHand();
  }

  /** 按手牌贡献构造主池/边池 */
  private buildPots(): PotInfo[] {
    const pots: PotInfo[] = [];
    let contribs = this.players
      .filter((p) => p.handBet > 0)
      .map((p) => ({ p, amt: p.handBet }))
      .sort((a, b) => a.amt - b.amt);
    let prev = 0;
    while (contribs.length) {
      const level = contribs[0].amt;
      const amount = (level - prev) * contribs.length;
      const eligible = contribs
        .filter((c) => !c.p.folded)
        .map((c) => c.p.id);
      if (amount > 0) {
        if (eligible.length === 0 && pots.length) {
          pots[pots.length - 1].amount += amount; // 理论上不会发生
        } else {
          pots.push({ amount, eligible });
        }
      }
      prev = level;
      contribs = contribs.filter((c) => c.amt > level);
    }
    return pots;
  }

  private showdown() {
    this.phase = "showdown";
    this.turnSeat = -1;
    const alive = this.inHandPlayers().filter((p) => !p.folded);
    for (const p of alive) {
      const { score, cat } = evaluate7([...p.hole, ...this.community]);
      p.score = score;
      p.handName = handName(score, cat);
    }
    this.pots = this.buildPots();
    const winCounted = new Set<string>();
    for (const pot of this.pots) {
      const candidates = pot.eligible
        .map((id) => this.byId(id))
        .filter((p): p is Player => !!p && !p.folded && p.inHand);
      if (!candidates.length) continue;
      const best = Math.max(...candidates.map((p) => p.score ?? 0));
      let winners = candidates.filter((p) => (p.score ?? 0) === best);
      // 按距庄家位置排序分配零头
      const seatDist = (p: Player) =>
        (p.seat - this.dealerSeat + MAX_SEATS) % MAX_SEATS;
      winners = winners.sort((a, b) => seatDist(a) - seatDist(b));
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      for (const w of winners) {
        let gain = share;
        if (remainder > 0) {
          gain += 1;
          remainder -= 1;
        }
        w.chips += gain;
        w.winAmount = (w.winAmount ?? 0) + gain;
        w.isWinner = true;
        if (!winCounted.has(w.id)) {
          winCounted.add(w.id);
          const st = this.stats.get(w.id);
          if (st) st.wins++;
        }
      }
      const names = winners
        .map((w) => `${w.name}（${w.handName}）`)
        .join("、");
      this.log(`${names} 赢得底池 ${pot.amount}`);
    }
    this.finishHand();
  }

  private finishHand() {
    this.phase = "showdown";
    this.turnSeat = -1;
    // 自动开始下一手
    const canContinue = this.players.filter(
      (p) => p.chips > 0 && p.connected,
    ).length;
    if (canContinue >= 2) {
      this.nextHandAt = Date.now() + NEXT_HAND_DELAY;
      this.later(() => {
        this.nextHandAt = undefined;
        this.startHand();
      }, NEXT_HAND_DELAY);
    } else {
      this.nextHandAt = undefined;
    }
    this.onChange();
  }

  /* ---------------- 重新买入（需房主审批） ---------------- */

  /** 校验玩家当前是否具备买入条件 */
  private rebuyEligible(p: Player): string | null {
    if (p.chips > 0) return "只有筹码为 0 时才能重新买入";
    const inActiveHand =
      p.inHand && ["preflop", "flop", "turn", "river"].includes(this.phase);
    if (inActiveHand) return "本手结束后才能重新买入";
    return null;
  }

  /**
   * 申请重新买入：房主直接生效；其他玩家进入待审批队列。
   * 返回 null 表示成功（已买入或已提交申请）。
   */
  requestRebuy(id: string): string | null {
    const p = this.byId(id);
    if (!p) return "玩家不存在";
    const err = this.rebuyEligible(p);
    if (err) return err;
    if (id === this.hostId) {
      return this.doRebuy(p); // 房主无需审批
    }
    if (this.pendingRebuy.has(id)) return "买入申请已提交，等待房主审批";
    this.pendingRebuy.set(id, { playerId: id, name: p.name, at: Date.now() });
    this.log(`${p.name} 申请重新买入，等待房主审批`);
    this.onChange();
    return null;
  }

  /** 房主批准买入。返回 null 或错误信息。 */
  approveRebuy(hostId: string, playerId: string): string | null {
    if (hostId !== this.hostId) return "只有房主可以审批买入";
    const req = this.pendingRebuy.get(playerId);
    if (!req) return "该买入申请不存在";
    const p = this.byId(playerId);
    this.pendingRebuy.delete(playerId);
    if (!p) return "玩家已离开";
    const err = this.rebuyEligible(p);
    if (err) return err;
    return this.doRebuy(p);
  }

  /** 房主拒绝买入。返回被拒玩家名（用于通知），或 null 表示请求不存在。 */
  rejectRebuy(hostId: string, playerId: string): string | null {
    if (hostId !== this.hostId) return null;
    const req = this.pendingRebuy.get(playerId);
    if (!req) return null;
    this.pendingRebuy.delete(playerId);
    this.log(`房主拒绝了 ${req.name} 的买入申请`);
    this.onChange();
    return req.name;
  }

  /** 玩家取消自己的买入申请 */
  cancelRebuy(id: string) {
    if (this.pendingRebuy.delete(id)) {
      const p = this.byId(id);
      if (p) this.log(`${p.name} 取消了买入申请`);
      this.onChange();
    }
  }

  /** 实际执行买入：补足筹码、记账、按需排程下一手 */
  private doRebuy(p: Player): string | null {
    p.chips = this.startingChips;
    const st = this.stats.get(p.id);
    if (st) {
      st.buyIns++;
      st.totalBuyIn += this.startingChips;
    }
    this.log(`${p.name} 重新买入 ${this.startingChips} 筹码`);
    // 若足够人数且处于等待/结算，且没有自动下一手，则排程
    const canContinue = this.players.filter(
      (x) => x.chips > 0 && x.connected,
    ).length;
    if (canContinue >= 2 && this.phase === "showdown" && !this.nextHandAt) {
      this.nextHandAt = Date.now() + NEXT_HAND_DELAY;
      this.later(() => {
        this.nextHandAt = undefined;
        this.startHand();
      }, NEXT_HAND_DELAY);
    }
    this.onChange();
    return null;
  }

  /* ---------------- 亮牌 ---------------- */

  /**
   * 摊牌阶段亮牌：indices 为要亮出的手牌下标（0/1），可逐张亮。
   * 只有本手未弃牌的玩家可以亮牌；已亮的牌不可收回。
   */
  showCards(id: string, indices: number[]): string | null {
    const p = this.byId(id);
    if (!p) return "玩家不存在";
    if (this.phase !== "showdown") return "手牌结束后才能亮牌";
    if (!p.inHand || p.folded || p.hole.length === 0)
      return "本手未参与或已弃牌，无法亮牌";
    const newly = [...new Set(indices)].filter(
      (i) => (i === 0 || i === 1) && p.hole[i] && !p.shown[i],
    );
    if (!newly.length) return null; // 没有新亮的牌，静默忽略
    const wasFull = !!(p.shown[0] && p.shown[1]);
    for (const i of newly) p.shown[i] = true;
    if (!wasFull && p.shown[0] && p.shown[1]) {
      this.log(
        `${p.name} 亮出手牌 ${p.hole.map(cardToString).join(" ")}` +
          (p.handName ? `（${p.handName}）` : ""),
      );
    } else {
      for (const i of newly) this.log(`${p.name} 亮出了 ${cardToString(p.hole[i])}`);
    }
    this.onChange();
    return null;
  }

  /* ---------------- 状态序列化 ---------------- */

  toJSON(viewerId: string): RoomState {
    const pot = this.players.reduce((s, p) => s + p.handBet, 0);
    const players: PublicPlayer[] = [...this.players]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => {
        const isViewer = p.id === viewerId;
        const atShowdown =
          this.phase === "showdown" &&
          p.inHand &&
          !p.folded &&
          p.hole.length > 0;
        // 自己始终可见；对手在摊牌阶段仅可见其主动亮出的牌
        const hole: (Card | null)[] | undefined = isViewer
          ? p.hole
          : atShowdown
            ? p.hole.map((c, i) => (p.shown[i] ? c : null))
            : undefined;
        const bothShown =
          atShowdown && p.hole.length > 0 && p.hole.every((_, i) => p.shown[i]);
        return {
          id: p.id,
          name: p.name,
          seat: p.seat,
          chips: p.chips,
          bet: p.bet,
          handBet: p.handBet,
          folded: p.folded,
          allIn: p.allIn,
          connected: p.connected,
          isHost: p.id === this.hostId,
          isDealer: p.seat === this.dealerSeat && p.inHand,
          hole,
          shown: p.hole.length ? p.hole.map((_, i) => !!p.shown[i]) : undefined,
          lastAction: p.lastAction,
          inHand: p.inHand,
          handName: atShowdown && (isViewer || bothShown) ? p.handName : undefined,
          winAmount: p.winAmount,
          isWinner: p.isWinner,
        };
      });
    return {
      code: this.code,
      phase: this.phase,
      players,
      community: this.community,
      pot,
      pots: this.pots,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      turnSeat: this.turnSeat,
      dealerSeat: this.dealerSeat,
      sb: this.sb,
      bb: this.bb,
      startingChips: this.startingChips,
      handNumber: this.handNumber,
      log: this.logLines.slice(-40),
      nextHandIn: this.nextHandAt
        ? Math.max(0, Math.ceil((this.nextHandAt - Date.now()) / 1000))
        : undefined,
      scoreboard: this.buildScoreboard(),
      rebuyRequests: [...this.pendingRebuy.values()],
      equity: this.viewerEquity(viewerId),
    };
  }

  /* ---------------- 记分板与胜率 ---------------- */

  private buildScoreboard(): ScoreEntry[] {
    return [...this.players]
      .map((p) => {
        const st = this.stats.get(p.id);
        const totalBuyIn = st?.totalBuyIn ?? this.startingChips;
        return {
          playerId: p.id,
          name: p.name,
          isHost: p.id === this.hostId,
          connected: p.connected,
          chips: p.chips,
          profit: p.chips - totalBuyIn,
          hands: st?.hands ?? 0,
          wins: st?.wins ?? 0,
          buyIns: st?.buyIns ?? 1,
          totalBuyIn,
        };
      })
      .sort((a, b) => b.profit - a.profit);
  }

  /** 观看者的实时胜率（蒙特卡洛，带缓存）；不在局中时返回 undefined */
  private viewerEquity(viewerId: string): number | undefined {
    if (!["preflop", "flop", "turn", "river"].includes(this.phase))
      return undefined;
    const me = this.byId(viewerId);
    if (!me || !me.inHand || me.folded || me.hole.length !== 2)
      return undefined;
    // 只有在出现 all-in 之后才显示胜率
    const anyAllIn = this.inHandPlayers().some((p) => !p.folded && p.allIn);
    if (!anyAllIn) return undefined;
    const opponents = this.inHandPlayers().filter(
      (p) => !p.folded && p.id !== viewerId,
    ).length;
    if (opponents < 1) return undefined;

    const key = `${this.handNumber}:${this.community.length}:${opponents}`;
    const hit = this.equityCache.get(viewerId);
    if (hit && hit.key === key) return hit.value;

    const iterations = this.phase === "preflop" ? 400 : 800;
    const value =
      Math.round(
        equityMonteCarlo(me.hole, this.community, opponents, iterations) * 10,
      ) / 10;
    this.equityCache.set(viewerId, { key, value });
    return value;
  }
}

const MAX_SEATS = 9;
