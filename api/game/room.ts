import type {
  ActionType,
  BuyInTargets,
  BuyInMode,
  Card,
  Phase,
  PotInfo,
  PublicPlayer,
  RebuyRequest,
  RoomSettings,
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
  timeBankRemaining: number;
}

/** 记分板统计（跨手累计，玩家离房后仍保留到本房间结束） */
interface PlayerStats {
  hands: number; // 参与手数
  wins: number; // 赢下手数
  buyIns: number; // 买入次数（含初始）
  totalBuyIn: number; // 累计买入筹码
}

interface DepartedPlayer {
  name: string;
  chips: number;
}

export interface PokerRoomSnapshot {
  version: 1;
  code: string;
  players: Player[];
  hostId: string;
  phase: Phase;
  sb: number;
  bb: number;
  startingChips: number;
  buyInAmount: number;
  timeBankSec: number;
  paused: boolean;
  deck: Card[];
  community: Card[];
  pots: PotInfo[];
  currentBet: number;
  minRaise: number;
  dealerSeat: number;
  turnSeat: number;
  handNumber: number;
  logLines: string[];
  decisionTimeSec: number;
  turnUsesTimeBank: boolean;
  pausedTurn?: { remainingMs: number; usingTimeBank: boolean };
  turnDeadlineAt?: number;
  runoutDeadlineAt?: number;
  nextHandAt?: number;
  pendingSettings?: RoomSettings;
  pendingRemoval: string[];
  stats: Array<[string, PlayerStats]>;
  departedPlayers?: Array<[string, DepartedPlayer]>;
  pendingRebuy: Array<[string, RebuyRequest]>;
  pendingBuyIns: Array<[string, RebuyRequest]>;
}

const RUNOUT_DELAY = 1400;
const AUTO_ACTION_DELAY = 600;
const AUTO_NEXT_HAND_DELAY = 6000;
const DEFAULT_DECISION_TIME_SEC = 30;
const MIN_DECISION_TIME_SEC = 5;
const MAX_DECISION_TIME_SEC = 300;
const DEFAULT_TIME_BANK_SEC = 30;
const MAX_TIME_BANK_SEC = 300;
const MIN_BUY_IN_AMOUNT = 100;
const MAX_BUY_IN_AMOUNT = 1_000_000;
const BUY_IN_MODE_LABEL: Record<BuyInMode, string> = {
  custom: "自定义买入",
  oneHand: "买入一手",
  average: "补到均码",
  leader: "对齐领先",
};

interface ResolvedBuyIn {
  amount: number;
  targetChips?: number;
  basisName?: string;
}

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
  buyInAmount: number;
  timeBankSec: number;
  paused = false;

  private deck: Card[] = [];
  community: Card[] = [];
  private pots: PotInfo[] = [];
  currentBet = 0;
  minRaise = 0;
  dealerSeat = -1;
  turnSeat = -1;
  handNumber = 0;
  private logLines: string[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  decisionTimeSec: number;
  private turnUsesTimeBank = false;
  private pausedTurn?: { remainingMs: number; usingTimeBank: boolean };
  private turnDeadlineAt?: number;
  private runoutDeadlineAt?: number;
  private nextHandAt?: number;
  private pendingSettings?: RoomSettings;
  private pendingRemoval = new Set<string>();
  private persistentScheduling = false;

  /** 记分板统计 */
  private stats = new Map<string, PlayerStats>();
  /** 已离桌玩家的最终筹码，保留在本场总结中。 */
  private departedPlayers = new Map<string, DepartedPlayer>();
  /** 待房主审批的买入请求 */
  private pendingRebuy = new Map<string, RebuyRequest>();
  /** 已批准、下一手开始时才到账的买入 */
  private pendingBuyIns = new Map<string, RebuyRequest>();
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
    opts: {
      startingChips: number;
      buyInAmount?: number;
      sb: number;
      bb: number;
      decisionTimeSec?: number;
      timeBankSec?: number;
    },
  ) {
    this.code = code;
    this.hostId = hostId;
    this.startingChips = opts.startingChips;
    this.buyInAmount = Math.min(
      MAX_BUY_IN_AMOUNT,
      Math.max(
        MIN_BUY_IN_AMOUNT,
        Math.floor(opts.buyInAmount ?? opts.startingChips),
      ),
    );
    this.sb = opts.sb;
    this.bb = opts.bb;
    this.decisionTimeSec = Math.min(
      MAX_DECISION_TIME_SEC,
      Math.max(
        MIN_DECISION_TIME_SEC,
        Math.floor(opts.decisionTimeSec ?? DEFAULT_DECISION_TIME_SEC),
      ),
    );
    this.timeBankSec = Math.min(
      MAX_TIME_BANK_SEC,
      Math.max(0, Math.floor(opts.timeBankSec ?? DEFAULT_TIME_BANK_SEC)),
    );
  }

  /* ---------------- 工具 ---------------- */

  private log(msg: string) {
    this.logLines.push(msg);
    if (this.logLines.length > 120) this.logLines.shift();
  }

  private later(fn: () => void, ms: number) {
    if (this.persistentScheduling) return;
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

  /**
   * HTTP/D1 mode cannot rely on an isolate remaining alive after a request.
   * Deadlines are therefore advanced lazily by tick() on the next poll/action.
   */
  usePersistentScheduling() {
    this.persistentScheduling = true;
    this.clearTimers();
  }

  tick(now = Date.now()): boolean {
    if (this.paused) return false;
    let changed = false;

    // A single poll may need to catch up several delayed runout cards.
    for (let i = 0; i < 8; i++) {
      if (
        this.phase === "showdown" &&
        this.nextHandAt == null &&
        this.canStartNextHand()
      ) {
        this.ensureNextHandScheduled(now);
        changed = true;
        continue;
      }

      if (
        this.phase === "showdown" &&
        this.nextHandAt != null &&
        this.nextHandAt <= now
      ) {
        this.nextHandAt = undefined;
        this.startHand();
        changed = true;
        continue;
      }

      if (
        this.runoutDeadlineAt != null &&
        this.runoutDeadlineAt <= now
      ) {
        this.runoutDeadlineAt = undefined;
        this.runoutStep();
        changed = true;
        continue;
      }

      if (
        this.turnDeadlineAt != null &&
        this.turnDeadlineAt <= now &&
        ["preflop", "flop", "turn", "river"].includes(this.phase)
      ) {
        const current = this.bySeat(this.turnSeat);
        if (!current) {
          this.turnDeadlineAt = undefined;
          changed = true;
          break;
        }
        this.expireTurn(
          current,
          this.turnDeadlineAt,
          this.turnUsesTimeBank,
        );
        changed = true;
        continue;
      }
      break;
    }

    return changed;
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
    for (let offset = 1; offset <= MAX_SEATS; offset++) {
      const candidate = this.bySeat(
        (seat + offset + MAX_SEATS) % MAX_SEATS,
      );
      if (candidate && pred(candidate)) return candidate;
    }
    return undefined;
  }

  /* ---------------- 房间管理 ---------------- */

  addPlayer(
    id: string,
    name: string,
    options: { funded?: boolean } = {},
  ): Player {
    const funded = options.funded ?? this.phase === "waiting";
    const p: Player = {
      id,
      name,
      seat: -1,
      chips: funded ? this.startingChips : 0,
      bet: 0,
      handBet: 0,
      folded: false,
      allIn: false,
      connected: true,
      hole: [],
      shown: [],
      inHand: false,
      hasActed: false,
      timeBankRemaining: this.timeBankSec,
    };
    this.players.push(p);
    this.stats.set(id, {
      hands: 0,
      wins: 0,
      buyIns: funded ? 1 : 0,
      totalBuyIn: funded ? this.startingChips : 0,
    });
    this.log(
      funded
        ? `${name} 进入房间，等待选择座位`
        : `${name} 进入房间，等待选座和选择买入方案`,
    );
    return p;
  }

  setSeat(id: string, seat: number): string | null {
    const player = this.byId(id);
    if (!player) return "玩家不存在";
    if (!Number.isInteger(seat) || seat < 0 || seat >= MAX_SEATS)
      return "请选择有效座位";
    if (player.seat === seat) return null;
    if (this.bySeat(seat)) return "这个座位已经有人了";

    const activePhase = ["preflop", "flop", "turn", "river"].includes(
      this.phase,
    );
    if (activePhase && player.seat >= 0)
      return "当前手牌进行中，结算后才能更换座位";
    if (activePhase && player.inHand)
      return "当前手牌进行中，无法更换座位";

    const previousSeat = player.seat;
    player.seat = seat;
    this.log(
      previousSeat >= 0
        ? `${player.name} 从 ${previousSeat + 1} 号位换到 ${seat + 1} 号位`
        : `${player.name} 坐到 ${seat + 1} 号位`,
    );
    this.ensureNextHandScheduled();
    this.onChange();
    return null;
  }

  removePlayer(id: string) {
    const p = this.byId(id);
    if (!p) return;
    this.log(`${p.name} 离开了牌桌`);
    const activePhase = ["preflop", "flop", "turn", "river"].includes(
      this.phase,
    );
    // 当前手中不要立刻从 players 删除，否则其已下注筹码会从底池消失，
    // 也会改变正在进行的行动顺序。先弃牌并在本手结算后移除。
    if (p.inHand && activePhase) {
      p.folded = true;
      p.connected = false;
      p.lastAction = "离开牌桌";
      this.pendingRemoval.add(id);
      const wasTurn = this.turnSeat === p.seat;
      if (wasTurn) this.afterTurnLeft();
      else this.checkEarlyEnd();
    } else {
      this.departedPlayers.set(id, { name: p.name, chips: p.chips });
      this.players = this.players.filter((x) => x.id !== id);
      this.pendingRebuy.delete(id);
      this.pendingBuyIns.delete(id);
    }
    if (
      this.hostId === id &&
      !this.pendingRemoval.has(id) &&
      this.players.length
    ) {
      this.hostId = this.players[0].id;
      this.log(`${this.players[0].name} 成为房主`);
    }
    this.equityCache.delete(id);
    this.onChange();
  }

  private finalizePendingRemovals() {
    if (!this.pendingRemoval.size) return;
    const ids = this.pendingRemoval;
    for (const p of this.players) {
      if (ids.has(p.id)) {
        this.departedPlayers.set(p.id, { name: p.name, chips: p.chips });
      }
    }
    this.players = this.players.filter((p) => !ids.has(p.id));
    for (const id of ids) {
      this.pendingRebuy.delete(id);
      this.pendingBuyIns.delete(id);
      this.equityCache.delete(id);
    }
    this.pendingRemoval = new Set();
    if (!this.byId(this.hostId) && this.players.length) {
      this.hostId = this.players[0].id;
      this.log(`${this.players[0].name} 成为房主`);
    }
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
      this.ensureNextHandScheduled();
    }
    this.onChange();
  }

  private currentRoomSettings(): RoomSettings {
    return {
      sb: this.sb,
      bb: this.bb,
      buyInAmount: this.buyInAmount,
      decisionTimeSec: this.decisionTimeSec,
      timeBankSec: this.timeBankSec,
    };
  }

  private applyRoomSettings(settings: RoomSettings) {
    this.sb = settings.sb;
    this.bb = settings.bb;
    this.buyInAmount = settings.buyInAmount;
    this.decisionTimeSec = settings.decisionTimeSec;
    this.timeBankSec = settings.timeBankSec;
  }

  private applyPendingSettings() {
    if (!this.pendingSettings) return;
    this.applyRoomSettings(this.pendingSettings);
    this.pendingSettings = undefined;
  }

  setRoomSettings(
    hostId: string,
    settings: RoomSettings,
  ): string | null {
    if (hostId !== this.hostId) return "只有房主可以调整牌桌设置";
    if (!settings || typeof settings !== "object")
      return "牌桌设置格式不正确";
    const values = [
      settings.sb,
      settings.bb,
      settings.buyInAmount,
      settings.decisionTimeSec,
      settings.timeBankSec,
    ];
    if (values.some((value) => !Number.isInteger(value)))
      return "牌桌设置必须填写整数";
    if (settings.sb < 1 || settings.sb > 10_000)
      return "小盲需设置为 1 到 10,000";
    if (settings.bb < 2 || settings.bb > 20_000 || settings.bb <= settings.sb)
      return "大盲必须大于小盲";
    if (
      settings.buyInAmount < MIN_BUY_IN_AMOUNT ||
      settings.buyInAmount > MAX_BUY_IN_AMOUNT ||
      settings.buyInAmount < settings.bb * 10
    )
      return "一手买入至少为大盲的 10 倍";
    if (
      settings.decisionTimeSec < MIN_DECISION_TIME_SEC ||
      settings.decisionTimeSec > MAX_DECISION_TIME_SEC
    )
      return "决策时间需设置为 5 到 300 秒";
    if (settings.timeBankSec < 0 || settings.timeBankSec > MAX_TIME_BANK_SEC)
      return "时间银行需设置为 0 到 300 秒";

    const activePhase = ["preflop", "flop", "turn", "river"].includes(
      this.phase,
    );
    if (activePhase) {
      this.pendingSettings = { ...settings };
      this.log("房主更新了牌桌设置，将从下一手生效");
    } else {
      this.applyRoomSettings(settings);
      this.pendingSettings = undefined;
      for (const player of this.players)
        player.timeBankRemaining = settings.timeBankSec;
      this.log(
        `房主更新牌桌设置：盲注 ${settings.sb}/${settings.bb} · 一手买入 ${settings.buyInAmount}`,
      );
    }
    this.onChange();
    return null;
  }

  setDecisionTime(hostId: string, seconds: number): string | null {
    const settings = this.pendingSettings ?? this.currentRoomSettings();
    return this.setRoomSettings(hostId, {
      ...settings,
      decisionTimeSec: Math.floor(seconds),
    });
  }

  setTimeBank(hostId: string, seconds: number): string | null {
    const settings = this.pendingSettings ?? this.currentRoomSettings();
    return this.setRoomSettings(hostId, {
      ...settings,
      timeBankSec: Math.floor(seconds),
    });
  }

  setPaused(hostId: string, paused: boolean): string | null {
    if (hostId !== this.hostId) return "只有房主可以暂停或继续游戏";
    if (paused === this.paused) return null;

    const activePhase = ["preflop", "flop", "turn", "river"].includes(
      this.phase,
    );
    if (paused) {
      if (!activePhase) return "当前没有进行中的牌局";
      if (this.turnSeat < 0 || !this.turnDeadlineAt)
        return "当前正在处理牌面，请稍后再暂停";
      const current = this.bySeat(this.turnSeat);
      if (!current) return "当前行动玩家不存在";
      const remainingMs = Math.max(0, this.turnDeadlineAt - Date.now());
      if (this.turnUsesTimeBank) {
        current.timeBankRemaining = Math.max(0, Math.ceil(remainingMs / 1000));
      }
      this.pausedTurn = {
        remainingMs,
        usingTimeBank: this.turnUsesTimeBank,
      };
      this.clearTimers();
      this.turnDeadlineAt = undefined;
      this.paused = true;
      this.log("房主暂停了牌局");
    } else {
      this.paused = false;
      const current = this.bySeat(this.turnSeat);
      const saved = this.pausedTurn;
      this.pausedTurn = undefined;
      if (current && activePhase) {
        this.startTurn(
          current,
          saved?.remainingMs,
          saved?.usingTimeBank ?? false,
        );
      }
      this.log("房主继续了牌局");
    }
    this.onChange();
    return null;
  }

  returnToLobby(hostId: string): string | null {
    if (hostId !== this.hostId) return "只有房主可以返回大厅";
    if (this.phase === "waiting") return null;
    if (this.phase !== "showdown")
      return "当前手牌进行中，请在本手结算后返回大厅";

    this.clearTimers();
    this.turnDeadlineAt = undefined;
    this.runoutDeadlineAt = undefined;
    this.nextHandAt = undefined;
    this.turnUsesTimeBank = false;
    this.pausedTurn = undefined;
    this.paused = false;
    this.phase = "waiting";
    this.deck = [];
    this.community = [];
    this.pots = [];
    this.currentBet = 0;
    this.turnSeat = -1;
    this.applyPendingSettings();
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
      p.timeBankRemaining = this.timeBankSec;
    }
    this.equityCache.clear();
    this.finalizePendingRemovals();
    const hostName = this.byId(hostId)?.name ?? "房主";
    this.log(`${hostName} 将牌桌返回大厅`);
    this.onChange();
    return null;
  }

  /* ---------------- 游戏流程 ---------------- */

  private canStartNextHand() {
    return (
      this.players.filter(
        (player) =>
          player.seat >= 0 &&
          player.connected &&
          (player.chips > 0 || this.pendingBuyIns.has(player.id)),
      ).length >= 2
    );
  }

  private ensureNextHandScheduled(now = Date.now()) {
    if (
      this.phase !== "showdown" ||
      this.nextHandAt != null ||
      !this.canStartNextHand()
    )
      return;
    const deadline = now + AUTO_NEXT_HAND_DELAY;
    this.nextHandAt = deadline;
    this.later(() => {
      if (
        this.phase === "showdown" &&
        this.nextHandAt === deadline &&
        Date.now() >= deadline
      ) {
        this.nextHandAt = undefined;
        this.startHand();
      }
    }, AUTO_NEXT_HAND_DELAY);
  }

  startHand(): string | null {
    if (this.paused) return "牌局已暂停，请先点击继续";
    if (this.phase !== "waiting" && this.phase !== "showdown") return null;
    const startingFromShowdown = this.phase === "showdown";
    this.clearTimers();
    this.turnDeadlineAt = undefined;
    this.runoutDeadlineAt = undefined;
    this.nextHandAt = undefined;
    this.turnUsesTimeBank = false;
    this.pausedTurn = undefined;
    this.finalizePendingRemovals();
    this.applyPendingSettings();
    this.applyPendingBuyIns();
    const eligible = this.players.filter(
      (p) => p.seat >= 0 && p.chips > 0 && p.connected,
    );
    if (eligible.length < 2) {
      this.phase = startingFromShowdown ? "showdown" : "waiting";
      this.onChange();
      return null;
    }

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
      p.timeBankRemaining = this.timeBankSec;
    }
    for (const p of eligible) {
      p.inHand = true;
      const st = this.stats.get(p.id);
      if (st) st.hands++;
    }
    this.equityCache.clear();

    // 庄家轮转
    const nextDealer = this.nextSeatAfter(this.dealerSeat, (p) => p.inHand);
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
    // 盲注已让所有人全下的极端情况：直接跑牌
    if (this.roundComplete()) {
      this.nextStreet();
      return null;
    }
    this.startTurn(first);
    this.onChange();
    return null;
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
    if (this.paused) return "牌局已暂停，请等待房主继续";
    if (p.seat !== this.turnSeat) return "还没轮到你";
    if (!["preflop", "flop", "turn", "river"].includes(this.phase))
      return "当前不能行动";

    this.consumeTurnTimeBank(p);
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
    this.turnDeadlineAt = undefined;
    this.turnUsesTimeBank = false;
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
    this.startTurn(next);
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
      this.startTurn(next);
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
    this.turnDeadlineAt = undefined;
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
      this.turnSeat = -1;
      this.scheduleRunout();
      this.onChange();
      return;
    }
    this.dealStreet();
    const first = this.nextSeatAfter(
      this.dealerSeat,
      (p) => p.inHand && !p.folded && !p.allIn,
    );
    if (!first) {
      this.turnSeat = -1;
      this.scheduleRunout();
      this.onChange();
      return;
    }
    this.startTurn(first);
    this.onChange();
  }

  /** 全下后的自动发牌流程 */
  private runoutStep() {
    this.runoutDeadlineAt = undefined;
    if (this.phase === "river") {
      this.showdown();
      return;
    }
    this.dealStreet();
    this.onChange();
    this.scheduleRunout();
  }

  private scheduleRunout() {
    const deadline = Date.now() + RUNOUT_DELAY;
    this.runoutDeadlineAt = deadline;
    this.later(() => {
      if (this.runoutDeadlineAt !== deadline) return;
      this.runoutDeadlineAt = undefined;
      this.runoutStep();
    }, RUNOUT_DELAY);
  }

  private scheduleAutoAction(p: Player) {
    if (this.paused) return;
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

  private consumeTurnTimeBank(p: Player) {
    if (!this.turnUsesTimeBank || !this.turnDeadlineAt) return;
    p.timeBankRemaining = Math.max(
      0,
      Math.ceil((this.turnDeadlineAt - Date.now()) / 1000),
    );
  }

  private startTurn(
    p: Player,
    durationMs = this.decisionTimeSec * 1000,
    usingTimeBank = false,
  ) {
    if (this.paused) return;
    this.turnSeat = p.seat;
    this.turnUsesTimeBank = usingTimeBank;
    const deadline = Date.now() + Math.max(1, durationMs);
    this.turnDeadlineAt = deadline;
    this.later(
      () => {
        this.expireTurn(p, deadline, usingTimeBank);
      },
      Math.max(1, durationMs),
    );
    if (!p.connected) this.scheduleAutoAction(p);
  }

  private expireTurn(p: Player, deadline: number, usingTimeBank: boolean) {
    if (this.turnSeat !== p.seat || this.turnDeadlineAt !== deadline) return;
    if (!["preflop", "flop", "turn", "river"].includes(this.phase)) return;
    if (!usingTimeBank && p.timeBankRemaining > 0) {
      p.lastAction = "时间银行";
      this.log(p.name + " 用完基础时间，启用时间银行");
      this.startTurn(p, p.timeBankRemaining * 1000, true);
      this.onChange();
      return;
    }
    if (usingTimeBank) p.timeBankRemaining = 0;
    this.turnDeadlineAt = undefined;
    this.turnUsesTimeBank = false;
    const toCall = this.currentBet - p.bet;
    if (toCall <= 0) {
      p.lastAction = "看牌";
      p.hasActed = true;
      this.log(`${p.name} 看牌（超时自动）`);
    } else {
      p.folded = true;
      p.lastAction = "弃牌";
      p.hasActed = true;
      this.log(`${p.name} 弃牌（超时自动）`);
    }
    this.advance();
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
      const eligible = contribs.filter((c) => !c.p.folded).map((c) => c.p.id);
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
    this.turnDeadlineAt = undefined;
    const alive = this.inHandPlayers().filter((p) => !p.folded);
    for (const p of alive) {
      p.shown = p.hole.map(() => true);
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
      const names = winners.map((w) => `${w.name}（${w.handName}）`).join("、");
      this.log(`${names} 赢得底池 ${pot.amount}`);
    }
    this.finishHand();
  }

  private finishHand() {
    this.phase = "showdown";
    this.turnSeat = -1;
    this.turnDeadlineAt = undefined;
    this.runoutDeadlineAt = undefined;
    for (const p of this.inHandPlayers().filter((x) => !x.folded)) {
      p.shown = p.hole.map(() => true);
    }
    this.logHandSummary();
    this.finalizePendingRemovals();
    this.ensureNextHandScheduled();
    this.onChange();
  }

  private logHandSummary() {
    const participants = this.players.filter((p) => p.inHand);
    if (!participants.length) return;
    const signed = (value: number) =>
      value > 0 ? `+${value.toLocaleString()}` : value.toLocaleString();
    const changes = participants
      .map((p) => {
        const net = (p.winAmount ?? 0) - p.handBet;
        return `${p.name} ${signed(net)} → ${p.chips.toLocaleString()}`;
      })
      .join(" · ");
    const totals = this.buildScoreboard()
      .map(
        (entry) =>
          `${entry.name} ${entry.chips.toLocaleString()}（总盈亏 ${signed(entry.profit)}）`,
      )
      .join(" · ");
    this.log(`—— 第 ${this.handNumber} 手总结 ——`);
    if (this.community.length) {
      this.log(`公共牌：${this.community.map(cardToString).join(" ")}`);
    }
    this.log(`本手盈亏：${changes}`);
    this.log(`牌桌总结：${totals}`);
  }

  /* ---------------- 买入（需房主审批） ---------------- */

  /** 买入申请可以随时提交，但到账必须等下一手开始。 */
  private rebuyEligible(p: Player): string | null {
    if (this.pendingRebuy.has(p.id) || this.pendingBuyIns.has(p.id))
      return "买入申请已提交，等待下一手生效";
    return null;
  }

  private validateBuyInAmount(
    amount: number,
    minimum = MIN_BUY_IN_AMOUNT,
  ): number | string {
    if (!Number.isFinite(amount)) return "买入金额格式不正确";
    const value = Math.floor(amount);
    if (value < minimum) return `买入金额至少为 ${minimum}`;
    if (value > MAX_BUY_IN_AMOUNT)
      return `买入金额不能超过 ${MAX_BUY_IN_AMOUNT.toLocaleString()}`;
    return value;
  }

  private currentBuyInTargets(): BuyInTargets {
    const currentPlayers = this.players.filter(
      (player) => !this.pendingRemoval.has(player.id),
    );
    if (!currentPlayers.length) {
      return {
        average: this.buyInAmount,
        leader: this.buyInAmount,
      };
    }
    const average = Math.floor(
      currentPlayers.reduce((sum, player) => sum + player.chips, 0) /
        currentPlayers.length,
    );
    const chipLeader = currentPlayers.reduce((leader, player) =>
      player.chips > leader.chips ? player : leader,
    );
    return {
      average,
      leader: chipLeader.chips,
      leaderName: chipLeader.name,
    };
  }

  private resolveBuyIn(
    p: Player,
    mode: BuyInMode = "oneHand",
    customAmount?: number,
  ): ResolvedBuyIn | string {
    let amount: number;
    let targetChips: number | undefined;
    const targets = this.currentBuyInTargets();
    switch (mode) {
      case "custom":
        amount = customAmount ?? Number.NaN;
        break;
      case "average": {
        targetChips = targets.average;
        amount = targetChips - p.chips;
        break;
      }
      case "leader": {
        targetChips = targets.leader;
        amount = targetChips - p.chips;
        break;
      }
      case "oneHand":
      default:
        amount = this.buyInAmount;
        break;
    }
    if (amount <= 0 && mode !== "custom") return "当前筹码已达到目标，无需买入";
    const validated = this.validateBuyInAmount(
      amount,
      mode === "average" || mode === "leader" ? 1 : MIN_BUY_IN_AMOUNT,
    );
    if (typeof validated === "string") return validated;
    return {
      amount: validated,
      targetChips,
      basisName: mode === "leader" ? targets.leaderName : undefined,
    };
  }

  private describeBuyIn(request: RebuyRequest): string {
    const approved =
      request.approvedAmount != null
        ? `，房主批准补充 ${request.approvedAmount.toLocaleString()}`
        : "";
    const base = `${BUY_IN_MODE_LABEL[request.mode]}，申请补充 ${request.amount.toLocaleString()}${approved}`;
    if (
      request.targetChips == null ||
      request.chipsAtRequest == null ||
      !["average", "leader"].includes(request.mode)
    ) {
      return base;
    }
    const basis =
      request.mode === "leader" && request.basisName
        ? `${request.basisName} 的领先筹码`
        : request.mode === "average"
          ? "当前牌桌均码"
          : "目标";
    return `${BUY_IN_MODE_LABEL[request.mode]}：${basis} ${request.targetChips.toLocaleString()}（申请时 ${request.chipsAtRequest.toLocaleString()}，申请补充 ${request.amount.toLocaleString()}${approved}）`;
  }

  /**
   * 申请买入：游戏开始后才能申请；普通玩家进入待房主审批队列，
   * 房主申请后直接登记，所有买入都在下一手开始时到账。
   * 当前手进行中时，即使已经批准，也不会改变当前手的筹码。
   */
  requestRebuy(
    id: string,
    mode: BuyInMode = "oneHand",
    customAmount?: number,
  ): string | null {
    const p = this.byId(id);
    if (!p) return "玩家不存在";
    const err = this.rebuyEligible(p);
    if (err) return err;
    const resolved = this.resolveBuyIn(p, mode, customAmount);
    if (typeof resolved === "string") return resolved;
    const request: RebuyRequest = {
      playerId: id,
      name: p.name,
      at: Date.now(),
      amount: resolved.amount,
      mode,
      chipsAtRequest: p.chips,
      targetChips: resolved.targetChips,
      basisName: resolved.basisName,
    };
    if (id === this.hostId) {
      this.pendingBuyIns.set(id, request);
      this.log(
        `${p.name} ${this.describeBuyIn(request)}，已登记，将在下一手到账`,
      );
      this.ensureNextHandScheduled();
      this.onChange();
      return null;
    }
    this.pendingRebuy.set(id, request);
    this.log(
      `${p.name} 申请${this.describeBuyIn(request)}，等待房主审批`,
    );
    this.onChange();
    return null;
  }

  /** 房主批准买入，可覆盖申请金额。返回 null 或错误信息。 */
  approveRebuy(
    hostId: string,
    playerId: string,
    customAmount?: number,
  ): string | null {
    if (hostId !== this.hostId) return "只有房主可以审批买入";
    const req = this.pendingRebuy.get(playerId);
    if (!req) return "该买入申请不存在";
    const p = this.byId(playerId);
    this.pendingRebuy.delete(playerId);
    if (!p) return "玩家已离开";
    const err = this.rebuyEligible(p);
    if (err) return err;
    let approved = req;
    if (customAmount !== undefined && customAmount !== req.amount) {
      const amount = this.validateBuyInAmount(
        customAmount,
        req.mode === "average" || req.mode === "leader"
          ? 1
          : MIN_BUY_IN_AMOUNT,
      );
      if (typeof amount === "string") {
        this.pendingRebuy.set(playerId, req);
        return amount;
      }
      approved = { ...req, approvedAmount: amount };
      this.log(
        `房主将 ${p.name} 的买入从申请补充 ${req.amount.toLocaleString()} 调整为 ${amount.toLocaleString()}`,
      );
    }
    this.pendingBuyIns.set(playerId, approved);
    this.log(
      `${p.name} 的买入申请已批准：${this.describeBuyIn(approved)}，将在下一手到账`,
    );
    this.ensureNextHandScheduled();
    this.onChange();
    return null;
  }

  /** 房主拒绝买入。返回被拒玩家名（用于通知），或 null 表示请求不存在。 */
  rejectRebuy(hostId: string, playerId: string): string | null {
    if (hostId !== this.hostId) return null;
    const req = this.pendingRebuy.get(playerId);
    if (!req) return null;
    this.pendingRebuy.delete(playerId);
    this.log(`房主拒绝了 ${req.name} 的买入申请：${this.describeBuyIn(req)}`);
    this.onChange();
    return req.name;
  }

  /** 玩家取消自己的买入申请 */
  cancelRebuy(id: string) {
    const req = this.pendingRebuy.get(id);
    if (req && this.pendingRebuy.delete(id)) {
      const p = this.byId(id);
      if (p) {
        this.log(
          `${p.name} 取消了买入申请：${this.describeBuyIn(req)}`,
        );
      }
      this.onChange();
    }
  }

  private applyPendingBuyIns() {
    if (!this.pendingBuyIns.size) return;
    for (const [playerId, req] of this.pendingBuyIns) {
      const p = this.byId(playerId);
      if (!p) continue;
      const amount =
        req.approvedAmount ??
        (req.targetChips != null && ["average", "leader"].includes(req.mode)
          ? Math.max(0, req.targetChips - p.chips)
          : req.amount);
      if (amount <= 0) {
        this.log(
          `${p.name} 已达到${BUY_IN_MODE_LABEL[req.mode]}目标 ${req.targetChips?.toLocaleString() ?? ""}，本手无需补充`,
        );
        continue;
      }
      const before = p.chips;
      p.chips += amount;
      const st = this.stats.get(playerId);
      if (st) {
        st.buyIns++;
        st.totalBuyIn += amount;
      }
      this.log(
        `${p.name} 买入到账：${before.toLocaleString()} + ${amount.toLocaleString()} = ${p.chips.toLocaleString()}（本手生效${req.targetChips != null ? `，申请目标 ${req.targetChips.toLocaleString()}` : ""}）`,
      );
    }
    this.pendingBuyIns.clear();
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
      for (const i of newly)
        this.log(`${p.name} 亮出了 ${cardToString(p.hole[i])}`);
    }
    this.onChange();
    return null;
  }

  /* ---------------- 状态序列化 ---------------- */

  toSnapshot(): PokerRoomSnapshot {
    return {
      version: 1,
      code: this.code,
      players: this.players,
      hostId: this.hostId,
      phase: this.phase,
      sb: this.sb,
      bb: this.bb,
      startingChips: this.startingChips,
      buyInAmount: this.buyInAmount,
      timeBankSec: this.timeBankSec,
      paused: this.paused,
      deck: this.deck,
      community: this.community,
      pots: this.pots,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      dealerSeat: this.dealerSeat,
      turnSeat: this.turnSeat,
      handNumber: this.handNumber,
      logLines: this.logLines,
      decisionTimeSec: this.decisionTimeSec,
      turnUsesTimeBank: this.turnUsesTimeBank,
      pausedTurn: this.pausedTurn,
      turnDeadlineAt: this.turnDeadlineAt,
      runoutDeadlineAt: this.runoutDeadlineAt,
      nextHandAt: this.nextHandAt,
      pendingSettings: this.pendingSettings,
      pendingRemoval: [...this.pendingRemoval],
      stats: [...this.stats.entries()],
      departedPlayers: [...this.departedPlayers.entries()],
      pendingRebuy: [...this.pendingRebuy.entries()],
      pendingBuyIns: [...this.pendingBuyIns.entries()],
    };
  }

  static fromSnapshot(snapshot: PokerRoomSnapshot): PokerRoom {
    const room = new PokerRoom(snapshot.code, snapshot.hostId, {
      startingChips: snapshot.startingChips,
      buyInAmount: snapshot.buyInAmount,
      sb: snapshot.sb,
      bb: snapshot.bb,
      decisionTimeSec: snapshot.decisionTimeSec,
      timeBankSec: snapshot.timeBankSec,
    });
    room.players = snapshot.players;
    room.phase = snapshot.phase;
    room.paused = snapshot.paused;
    room.deck = snapshot.deck;
    room.community = snapshot.community;
    room.pots = snapshot.pots;
    room.currentBet = snapshot.currentBet;
    room.minRaise = snapshot.minRaise;
    room.dealerSeat = snapshot.dealerSeat;
    room.turnSeat = snapshot.turnSeat;
    room.handNumber = snapshot.handNumber;
    room.logLines = snapshot.logLines;
    room.turnUsesTimeBank = snapshot.turnUsesTimeBank;
    room.pausedTurn = snapshot.pausedTurn;
    room.turnDeadlineAt = snapshot.turnDeadlineAt;
    room.runoutDeadlineAt = snapshot.runoutDeadlineAt;
    room.nextHandAt = snapshot.nextHandAt;
    room.pendingSettings = snapshot.pendingSettings;
    room.pendingRemoval = new Set(snapshot.pendingRemoval);
    room.stats = new Map(snapshot.stats);
    room.departedPlayers = new Map(snapshot.departedPlayers ?? []);
    room.pendingRebuy = new Map(snapshot.pendingRebuy);
    room.pendingBuyIns = new Map(snapshot.pendingBuyIns);
    room.usePersistentScheduling();
    return room;
  }

  toJSON(viewerId: string): RoomState {
    const pot = this.players.reduce((s, p) => s + p.handBet, 0);
    const players: PublicPlayer[] = [...this.players]
      .sort(
        (a, b) =>
          (a.seat < 0 ? MAX_SEATS : a.seat) -
          (b.seat < 0 ? MAX_SEATS : b.seat),
      )
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
          handName:
            atShowdown && (isViewer || bothShown) ? p.handName : undefined,
          winAmount: p.winAmount,
          isWinner: p.isWinner,
          timeBankRemaining:
            p.id === this.bySeat(this.turnSeat)?.id &&
            this.turnUsesTimeBank &&
            this.turnDeadlineAt
              ? Math.max(
                  0,
                  Math.ceil((this.turnDeadlineAt - Date.now()) / 1000),
                )
              : p.timeBankRemaining,
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
      buyInAmount: this.buyInAmount,
      timeBankSec: this.timeBankSec,
      paused: this.paused,
      handNumber: this.handNumber,
      log: this.logLines.slice(-120),
      decisionTimeSec: this.decisionTimeSec,
      turnDeadline: this.turnDeadlineAt,
      nextHandAt: this.nextHandAt,
      pendingSettings: this.pendingSettings,
      scoreboard: this.buildScoreboard(),
      buyInTargets: this.currentBuyInTargets(),
      rebuyRequests: [...this.pendingRebuy.values()],
      pendingBuyIns: [...this.pendingBuyIns.values()],
      equity: this.viewerEquity(viewerId),
    };
  }

  /* ---------------- 记分板与胜率 ---------------- */

  private buildScoreboard(): ScoreEntry[] {
    return [...this.stats.entries()]
      .map(([playerId, st]) => {
        const player = this.byId(playerId);
        const departed = this.departedPlayers.get(playerId);
        const chips = player?.chips ?? departed?.chips ?? 0;
        const totalBuyIn = st.totalBuyIn;
        return {
          playerId,
          name: player?.name ?? departed?.name ?? "已离桌玩家",
          isHost: playerId === this.hostId,
          connected: player?.connected ?? false,
          chips,
          profit: chips - totalBuyIn,
          hands: st.hands,
          wins: st.wins,
          buyIns: st.buyIns,
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
