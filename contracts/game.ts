// 德州扑克 —— 前后端共享协议类型

export type Suit = "s" | "h" | "d" | "c";

/** rank: 2-14 (11=J 12=Q 13=K 14=A) */
export interface Card {
  r: number;
  s: Suit;
}

export type Phase =
  | "waiting" // 等待开局
  | "preflop"
  | "flop"
  | "turn"
  | "river"
  | "showdown"; // 摊牌 / 结算展示

export type ActionType = "fold" | "check" | "call" | "raise" | "allin";

export interface PublicPlayer {
  id: string;
  name: string;
  /** -1 = 已进入房间但尚未选座；0-8 = 牌桌座位 */
  seat: number;
  chips: number; // 剩余筹码
  bet: number; // 本轮已下注
  handBet: number; // 本手累计下注
  folded: boolean;
  allIn: boolean;
  connected: boolean;
  isHost: boolean;
  isDealer: boolean;
  /** 手牌：自己始终可见；对手在摊牌阶段仅显示其主动亮出的牌（null = 未亮） */
  hole?: (Card | null)[];
  /** 摊牌阶段各张牌是否已亮出（与 hole 下标对应） */
  shown?: boolean[];
  lastAction?: string; // 最近一次动作描述
  inHand: boolean; // 本手是否参与（未弃牌且发了牌）
  handName?: string; // 摊牌牌型名
  winAmount?: number; // 本手赢得筹码
  isWinner?: boolean;
  timeBankRemaining: number; // 本手剩余时间银行秒数
}

export interface PotInfo {
  amount: number;
  eligible: string[]; // player ids
}

/** 记分板条目（按盈亏降序） */
export interface ScoreEntry {
  playerId: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  chips: number; // 当前筹码
  profit: number; // 盈亏 = 当前筹码 - 累计买入
  hands: number; // 参与手数
  wins: number; // 赢下手数
  buyIns: number; // 买入次数（含初始）
  totalBuyIn: number; // 累计买入筹码
}

/** 待审批的买入请求 */
export type BuyInMode = "custom" | "oneHand" | "average" | "leader";

export interface RebuyRequest {
  playerId: string;
  name: string;
  at: number; // 请求时间戳
  amount: number; // 申请/批准的补充筹码数
  mode: BuyInMode;
  chipsAtRequest?: number; // 提交申请时的筹码
  targetChips?: number; // 均码/领先模式锁定的目标筹码
  basisName?: string; // 对齐领先时，申请时的 chip leader
  approvedAmount?: number; // 房主手动调整后的固定补充值
}

export interface BuyInTargets {
  average: number; // 当前牌桌玩家的平均筹码
  leader: number; // 当前 chip leader 的筹码
  leaderName?: string;
}

export interface RoomSettings {
  sb: number;
  bb: number;
  buyInAmount: number;
  decisionTimeSec: number;
  timeBankSec: number;
}

export interface EmoteEvent {
  id: string;
  playerId: string; // 发送者
  name: string; // 发送者昵称
  targetPlayerId?: string; // 目标玩家；可选以兼容旧事件
  targetName?: string;
  emoji: string;
  at: number;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  name: string;
  text: string;
  at: number;
}

export interface RoomState {
  code: string;
  phase: Phase;
  players: PublicPlayer[]; // 按座位排序
  community: Card[];
  pot: number; // 总底池（含本轮下注）
  pots: PotInfo[]; // 已结算的边池
  currentBet: number; // 本轮最高下注
  minRaise: number; // 最小加注增量
  turnSeat: number; // 当前行动座位 (-1 无)
  dealerSeat: number;
  sb: number;
  bb: number;
  startingChips: number;
  buyInAmount: number; // “买入一手”默认金额
  timeBankSec: number; // 每手时间银行总秒数
  paused: boolean;
  handNumber: number;
  log: string[];
  decisionTimeSec: number; // 每次行动的决策时间
  turnDeadline?: number; // 当前行动截止时间（Unix ms）
  nextHandAt?: number; // 摊牌后自动开始下一手的时间（Unix ms）
  pendingSettings?: RoomSettings; // 当前手结束后生效的房主设置
  scoreboard: ScoreEntry[]; // 记分板（盈亏降序）
  buyInTargets: BuyInTargets;
  rebuyRequests: RebuyRequest[]; // 待房主审批的买入请求
  pendingBuyIns: RebuyRequest[]; // 已批准、下一手生效的买入
  /** 当前观看者的实时胜率（0-100），仅在局中未弃牌时提供 */
  equity?: number;
}

/* ---------------- 客户端 -> 服务器 ---------------- */

export type ClientMsg =
  | {
      t: "create";
      name: string;
      startingChips?: number;
      buyInAmount?: number;
      sb?: number;
      bb?: number;
      decisionTimeSec?: number;
      timeBankSec?: number;
    }
  | {
      t: "join";
      code: string;
      name: string;
      playerId?: string;
      sessionToken?: string;
    }
  | { t: "setSeat"; seat: number } // 选择或更换自己的牌桌座位（0-8）
  | { t: "start" }
  | { t: "action"; action: ActionType; amount?: number }
  | { t: "rebuy"; mode?: BuyInMode; amount?: number } // 申请买入
  | { t: "rebuyCancel" } // 取消自己的买入申请
  | { t: "rebuyApprove"; playerId: string; amount?: number } // 房主批准，可覆盖金额
  | { t: "rebuyReject"; playerId: string } // 房主拒绝
  | { t: "setDecisionTime"; seconds: number } // 房主设置每次决策时间
  | { t: "setTimeBank"; seconds: number } // 房主设置每手时间银行
  | { t: "setRoomSettings"; settings: RoomSettings } // 房主更新牌桌设置
  | { t: "setPaused"; paused: boolean } // 房主暂停/继续
  | { t: "returnToLobby" } // 房主在一手结算后返回房间大厅
  | { t: "show"; indices: number[] } // 摊牌阶段亮牌（0/1 为两张手牌的下标）
  | { t: "emote"; emoji: string; targetPlayerId: string } // 向指定玩家丢表情
  | { t: "chat"; text: string } // 向房间发送文字消息
  | { t: "kick"; playerId: string }
  | { t: "leave" };

/* ---------------- 服务器 -> 客户端 ---------------- */

export type ServerMsg =
  | {
      t: "joined";
      code: string;
      playerId: string;
      sessionToken?: string;
      state: RoomState;
    }
  | { t: "state"; state: RoomState }
  | { t: "emote"; event: EmoteEvent }
  | { t: "chat"; message: ChatMessage }
  | { t: "error"; message: string }
  | { t: "kicked" };

export const MAX_PLAYERS = 9;

export const HAND_NAMES = [
  "高牌",
  "一对",
  "两对",
  "三条",
  "顺子",
  "同花",
  "葫芦",
  "四条",
  "同花顺",
  "皇家同花顺",
] as const;

export function cardToString(c: Card): string {
  const ranks = "23456789TJQKA";
  const suits: Record<Suit, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
  return ranks[c.r - 2] + suits[c.s];
}
