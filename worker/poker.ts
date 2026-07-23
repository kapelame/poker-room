import { randomInt, randomUUID } from "node:crypto";
import { PokerRoom } from "../api/game/room";
import type {
  ChatMessage,
  ClientMsg,
  EmoteEvent,
  ServerMsg,
} from "../contracts/game";
import { MAX_PLAYERS } from "../contracts/game";

interface ServerWebSocket extends WebSocket {
  accept(): void;
}

interface ClientInfo {
  roomCode: string;
  playerId: string;
  alive: boolean;
}

const rooms = new Map<string, PokerRoom>();
const clients = new Map<ServerWebSocket, ClientInfo>();
const emptyTimers = new Map<string, ReturnType<typeof setTimeout>>();

const ROOM_IDLE_TTL = 10 * 60 * 1000;
const DEFAULT_DECISION_TIME_SEC = 30;
const DEFAULT_TIME_BANK_SEC = 30;

const ALLOWED_EMOTES = new Set([
  "💩",
  "😂",
  "🤣",
  "👍",
  "👏",
  "🔥",
  "😈",
  "😎",
  "🤡",
  "🙈",
]);

function send(ws: ServerWebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function sendError(ws: WebSocket, message: string) {
  send(ws, { t: "error", message });
}

function broadcast(room: PokerRoom) {
  for (const [ws, info] of clients) {
    if (info.roomCode !== room.code) continue;
    send(ws, { t: "state", state: room.toJSON(info.playerId) });
  }
}

function genCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  for (;;) {
    const code = Array.from({ length: 6 }, () =>
      chars.charAt(randomInt(chars.length)),
    ).join("");
    if (!rooms.has(code)) return code;
  }
}

function clamp(n: number, lo: number, hi: number, fallback: number) {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

function scheduleRoomCleanup(code: string) {
  if (emptyTimers.has(code)) return;
  const timer = setTimeout(() => {
    emptyTimers.delete(code);
    const room = rooms.get(code);
    if (!room) return;
    const hasConnected = [...clients.values()].some((i) => i.roomCode === code);
    if (!hasConnected) {
      room.dispose();
      rooms.delete(code);
    }
  }, ROOM_IDLE_TTL);
  emptyTimers.set(code, timer);
}

function cancelRoomCleanup(code: string) {
  const t = emptyTimers.get(code);
  if (t) {
    clearTimeout(t);
    emptyTimers.delete(code);
  }
}

function roomOf(
  ws: ServerWebSocket,
): { room: PokerRoom; info: ClientInfo } | null {
  const info = clients.get(ws);
  if (!info) return null;
  const room = rooms.get(info.roomCode);
  if (!room) return null;
  return { room, info };
}

function handleMessage(ws: ServerWebSocket, raw: string) {
  let msg: ClientMsg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return sendError(ws, "消息格式错误");
  }

  switch (msg.t) {
    case "create": {
      const name = String(msg.name ?? "")
        .trim()
        .slice(0, 16);
      if (!name) return sendError(ws, "请输入昵称");
      const startingChips = clamp(msg.startingChips ?? 1000, 100, 100000, 1000);
      const buyInAmount = clamp(
        msg.buyInAmount ?? startingChips,
        100,
        100000,
        startingChips,
      );
      const sb = clamp(msg.sb ?? 5, 1, 10000, 5);
      const bb = clamp(msg.bb ?? 10, 2, 20000, 10);
      const decisionTimeSec = clamp(
        msg.decisionTimeSec ?? DEFAULT_DECISION_TIME_SEC,
        5,
        300,
        DEFAULT_DECISION_TIME_SEC,
      );
      const timeBankSec = clamp(
        msg.timeBankSec ?? DEFAULT_TIME_BANK_SEC,
        0,
        300,
        DEFAULT_TIME_BANK_SEC,
      );
      if (bb <= sb) return sendError(ws, "大盲必须大于小盲");
      if (startingChips < bb * 10)
        return sendError(ws, "初始筹码至少为大盲的 10 倍");
      if (buyInAmount < bb * 10)
        return sendError(ws, "一手买入金额至少为大盲的 10 倍");

      const code = genCode();
      const playerId = randomUUID();
      const room = new PokerRoom(code, playerId, {
        startingChips,
        buyInAmount,
        sb,
        bb,
        decisionTimeSec,
        timeBankSec,
      });
      room.onChange = () => broadcast(room);
      room.addPlayer(playerId, name);
      rooms.set(code, room);
      clients.set(ws, { roomCode: code, playerId, alive: true });
      send(ws, { t: "joined", code, playerId, state: room.toJSON(playerId) });
      broadcast(room);
      break;
    }

    case "join": {
      const code = String(msg.code ?? "")
        .trim()
        .toUpperCase();
      const room = rooms.get(code);
      if (!room) return sendError(ws, "房间不存在，请检查房间码");

      // 断线重连：沿用原 playerId
      if (msg.playerId && room.byId(msg.playerId)) {
        const playerId = msg.playerId;
        // 若旧连接还在，踢掉旧 socket 的绑定
        for (const [old, info] of clients) {
          if (info.playerId === playerId && old !== ws) clients.delete(old);
        }
        clients.set(ws, { roomCode: code, playerId, alive: true });
        cancelRoomCleanup(code);
        room.setConnected(playerId, true);
        send(ws, { t: "joined", code, playerId, state: room.toJSON(playerId) });
        broadcast(room);
        return;
      }

      if (room.players.length >= MAX_PLAYERS)
        return sendError(ws, "房间已满（最多 9 人）");
      const name = String(msg.name ?? "")
        .trim()
        .slice(0, 16);
      if (!name) return sendError(ws, "请输入昵称");
      const playerId = randomUUID();
      room.addPlayer(playerId, name, { funded: false });
      clients.set(ws, { roomCode: code, playerId, alive: true });
      cancelRoomCleanup(code);
      send(ws, { t: "joined", code, playerId, state: room.toJSON(playerId) });
      broadcast(room);
      break;
    }

    case "setSeat": {
      const ctx = roomOf(ws);
      if (!ctx) return sendError(ws, "未加入房间");
      const err = ctx.room.setSeat(ctx.info.playerId, msg.seat);
      if (err) sendError(ws, err);
      break;
    }

    case "start": {
      const ctx = roomOf(ws);
      if (!ctx) return sendError(ws, "未加入房间");
      if (ctx.info.playerId !== ctx.room.hostId)
        return sendError(ws, "只有房主可以开始游戏");
      const err = ctx.room.startHand();
      if (err) sendError(ws, err);
      break;
    }

    case "action": {
      const ctx = roomOf(ws);
      if (!ctx) return sendError(ws, "未加入房间");
      const err = ctx.room.applyAction(
        ctx.info.playerId,
        msg.action,
        msg.amount,
      );
      if (err) sendError(ws, err);
      break;
    }

    case "rebuy": {
      const ctx = roomOf(ws);
      if (!ctx) return sendError(ws, "未加入房间");
      const modes = new Set(["custom", "oneHand", "average", "leader"]);
      const mode = modes.has(String(msg.mode))
        ? (msg.mode ?? "oneHand")
        : "oneHand";
      const err = ctx.room.requestRebuy(ctx.info.playerId, mode, msg.amount);
      if (err) sendError(ws, err);
      break;
    }

    case "rebuyCancel": {
      const ctx = roomOf(ws);
      if (!ctx) return sendError(ws, "未加入房间");
      ctx.room.cancelRebuy(ctx.info.playerId);
      break;
    }

    case "rebuyApprove": {
      const ctx = roomOf(ws);
      if (!ctx) return sendError(ws, "未加入房间");
      const err = ctx.room.approveRebuy(
        ctx.info.playerId,
        msg.playerId,
        msg.amount,
      );
      if (err) sendError(ws, err);
      break;
    }

    case "rebuyReject": {
      const ctx = roomOf(ws);
      if (!ctx) return sendError(ws, "未加入房间");
      const name = ctx.room.rejectRebuy(ctx.info.playerId, msg.playerId);
      if (name === null) {
        if (ctx.info.playerId !== ctx.room.hostId)
          sendError(ws, "只有房主可以审批买入");
        break;
      }
      // 通知被拒绝的玩家
      for (const [target, info] of clients) {
        if (info.playerId === msg.playerId) {
          send(target, { t: "error", message: "房主拒绝了你的买入申请" });
        }
      }
      break;
    }

    case "setDecisionTime": {
      const ctx = roomOf(ws);
      if (!ctx) return sendError(ws, "未加入房间");
      const err = ctx.room.setDecisionTime(ctx.info.playerId, msg.seconds);
      if (err) sendError(ws, err);
      break;
    }

    case "setTimeBank": {
      const ctx = roomOf(ws);
      if (!ctx) return sendError(ws, "未加入房间");
      const err = ctx.room.setTimeBank(ctx.info.playerId, msg.seconds);
      if (err) sendError(ws, err);
      break;
    }

    case "setRoomSettings": {
      const ctx = roomOf(ws);
      if (!ctx) return sendError(ws, "未加入房间");
      const err = ctx.room.setRoomSettings(
        ctx.info.playerId,
        msg.settings,
      );
      if (err) sendError(ws, err);
      break;
    }

    case "setPaused": {
      const ctx = roomOf(ws);
      if (!ctx) return sendError(ws, "未加入房间");
      const err = ctx.room.setPaused(ctx.info.playerId, msg.paused);
      if (err) sendError(ws, err);
      break;
    }

    case "returnToLobby": {
      const ctx = roomOf(ws);
      if (!ctx) return sendError(ws, "未加入房间");
      const err = ctx.room.returnToLobby(ctx.info.playerId);
      if (err) sendError(ws, err);
      break;
    }

    case "show": {
      const ctx = roomOf(ws);
      if (!ctx) return sendError(ws, "未加入房间");
      const indices = Array.isArray(msg.indices) ? msg.indices : [];
      const err = ctx.room.showCards(ctx.info.playerId, indices);
      if (err) sendError(ws, err);
      break;
    }

    case "emote": {
      const ctx = roomOf(ws);
      if (!ctx) return sendError(ws, "未加入房间");
      const emoji = String(msg.emoji ?? "").trim();
      if (!ALLOWED_EMOTES.has(emoji)) return sendError(ws, "这个表情暂不支持");
      const player = ctx.room.byId(ctx.info.playerId);
      if (!player) return sendError(ws, "玩家不存在");
      const targetPlayerId = String(msg.targetPlayerId ?? "").trim();
      if (!targetPlayerId) return sendError(ws, "请先选择表情目标");
      if (targetPlayerId === player.id)
        return sendError(ws, "请选择其他玩家作为目标");
      const targetPlayer = ctx.room.byId(targetPlayerId);
      if (!targetPlayer) return sendError(ws, "目标玩家已离开");
      if (!targetPlayer.connected) return sendError(ws, "目标玩家已离线");
      const event: EmoteEvent = {
        id: randomUUID(),
        playerId: player.id,
        name: player.name,
        targetPlayerId: targetPlayer.id,
        targetName: targetPlayer.name,
        emoji,
        at: Date.now(),
      };
      for (const [target, info] of clients) {
        if (info.roomCode === ctx.room.code)
          send(target, { t: "emote", event });
      }
      break;
    }

    case "chat": {
      const ctx = roomOf(ws);
      if (!ctx) return sendError(ws, "未加入房间");
      const player = ctx.room.byId(ctx.info.playerId);
      if (!player) return sendError(ws, "玩家不存在");
      const text = String(msg.text ?? "")
        .trim()
        .slice(0, 120);
      if (!text) return;
      const message: ChatMessage = {
        id: randomUUID(),
        playerId: player.id,
        name: player.name,
        text,
        at: Date.now(),
      };
      for (const [target, info] of clients) {
        if (info.roomCode === ctx.room.code)
          send(target, { t: "chat", message });
      }
      break;
    }

    case "kick": {
      const ctx = roomOf(ws);
      if (!ctx) return sendError(ws, "未加入房间");
      if (ctx.info.playerId !== ctx.room.hostId)
        return sendError(ws, "只有房主可以移出玩家");
      if (msg.playerId === ctx.info.playerId)
        return sendError(ws, "不能移出自己");
      const target = [...clients.entries()].find(
        ([, i]) => i.roomCode === ctx.room.code && i.playerId === msg.playerId,
      );
      ctx.room.removePlayer(msg.playerId);
      if (target) {
        send(target[0], { t: "kicked" });
        clients.delete(target[0]);
      }
      broadcast(ctx.room);
      break;
    }

    case "leave": {
      const ctx = roomOf(ws);
      if (!ctx) return;
      ctx.room.removePlayer(ctx.info.playerId);
      clients.delete(ws);
      broadcast(ctx.room);
      if (ctx.room.players.length === 0) {
        ctx.room.dispose();
        rooms.delete(ctx.room.code);
      }
      break;
    }
  }
}

function handleClose(ws: ServerWebSocket) {
  const info = clients.get(ws);
  if (!info) return;
  clients.delete(ws);
  const room = rooms.get(info.roomCode);
  if (!room) return;
  room.setConnected(info.playerId, false);
  const hasConnected = [...clients.values()].some(
    (i) => i.roomCode === info.roomCode,
  );
  if (!hasConnected) scheduleRoomCleanup(info.roomCode);
  broadcast(room);
}

type WebSocketPairConstructor = new () => {
  0: WebSocket;
  1: ServerWebSocket;
};

export function upgradePokerWebSocket(request: Request): Response {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket upgrade", { status: 426 });
  }

  const Pair = (globalThis as typeof globalThis & {
    WebSocketPair: WebSocketPairConstructor;
  }).WebSocketPair;
  const pair = new Pair();
  const client = pair[0];
  const server = pair[1];

  server.accept();
  server.addEventListener("message", (event) => {
    try {
      const data = event.data;
      const raw =
        typeof data === "string"
          ? data
          : data instanceof ArrayBuffer
            ? new TextDecoder().decode(data)
            : String(data);
      handleMessage(server, raw);
    } catch (error) {
      console.error("ws message error", error);
      sendError(server, "处理消息时出错，请重试");
    }
  });
  server.addEventListener("close", () => handleClose(server));
  server.addEventListener("error", () => handleClose(server));

  return new Response(null, {
    status: 101,
    webSocket: client,
  } as ResponseInit & { webSocket: WebSocket });
}
