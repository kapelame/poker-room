import { PokerRoom, type PokerRoomSnapshot } from "../api/game/room";
import type {
  ChatMessage,
  ClientMsg,
  EmoteEvent,
  ServerMsg,
} from "../contracts/game";
import { MAX_PLAYERS } from "../contracts/game";

interface PokerRequest {
  poll?: boolean;
  message?: ClientMsg;
  roomCode?: string;
  sessionToken?: string;
  cursor?: number;
}

interface PokerResponse {
  messages: ServerMsg[];
  cursor: number;
}

interface RoomRow {
  state_json: string;
  revision: number;
}

interface SessionRow {
  player_id: string;
  room_code: string;
}

interface EventRow {
  id: number;
  payload_json: string;
}

interface ActionOutcome {
  error?: string;
  deleteRoom?: boolean;
  skipWrite?: boolean;
  event?: {
    message: ServerMsg;
    targetPlayerId?: string;
  };
  deletePlayerSessions?: string;
}

const DEFAULT_DECISION_TIME_SEC = 30;
const DEFAULT_TIME_BANK_SEC = 30;
const MAX_MUTATION_ATTEMPTS = 4;
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

let schemaReady = false;

function json(body: PokerResponse, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function error(message: string, status = 200) {
  return json({ messages: [{ t: "error", message }], cursor: 0 }, status);
}

async function ensureSchema(db: D1Database) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS poker_rooms (
        code TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS poker_sessions (
        token TEXT PRIMARY KEY,
        room_code TEXT NOT NULL,
        player_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS poker_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_code TEXT NOT NULL,
        target_player_id TEXT,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS poker_sessions_room_player_idx ON poker_sessions(room_code, player_id)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS poker_events_room_id_idx ON poker_events(room_code, id)",
    ),
  ]);
  schemaReady = true;
}

function clamp(n: number, lo: number, hi: number, fallback: number) {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

function genCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => chars[value % chars.length]).join("");
}

function newToken() {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
}

function isRoomCodeCollision(cause: unknown) {
  const message =
    cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  return /unique constraint failed:\s*poker_rooms\.code/i.test(message);
}

function parseRoom(row: RoomRow) {
  return PokerRoom.fromSnapshot(
    JSON.parse(row.state_json) as PokerRoomSnapshot,
  );
}

async function loadRoom(db: D1Database, code: string) {
  const row = await db
    .prepare(
      "SELECT state_json, revision FROM poker_rooms WHERE code = ? LIMIT 1",
    )
    .bind(code)
    .first<RoomRow>();
  if (!row) return null;
  return { room: parseRoom(row), revision: Number(row.revision) };
}

async function latestCursor(db: D1Database, code: string) {
  const row = await db
    .prepare(
      "SELECT COALESCE(MAX(id), 0) AS id FROM poker_events WHERE room_code = ?",
    )
    .bind(code)
    .first<{ id: number }>();
  return Number(row?.id ?? 0);
}

async function readEvents(
  db: D1Database,
  code: string,
  playerId: string,
  cursor: number,
) {
  const result = await db
    .prepare(
      `SELECT id, payload_json
       FROM poker_events
       WHERE room_code = ?
         AND id > ?
         AND (target_player_id IS NULL OR target_player_id = ?)
       ORDER BY id ASC
       LIMIT 100`,
    )
    .bind(code, cursor, playerId)
    .all<EventRow>();
  const rows = result.results ?? [];
  const messages = rows.flatMap((row) => {
    try {
      return [JSON.parse(row.payload_json) as ServerMsg];
    } catch {
      return [];
    }
  });
  const nextCursor =
    rows.length >= 100
      ? Number(rows[rows.length - 1].id)
      : await latestCursor(db, code);
  return { messages, cursor: nextCursor };
}

async function appendEvent(
  db: D1Database,
  code: string,
  message: ServerMsg,
  targetPlayerId?: string,
) {
  await db
    .prepare(
      `INSERT INTO poker_events
       (room_code, target_player_id, payload_json, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(
      code,
      targetPlayerId ?? null,
      JSON.stringify(message),
      Date.now(),
    )
    .run();
}

async function sessionFor(db: D1Database, token: string) {
  return db
    .prepare(
      "SELECT room_code, player_id FROM poker_sessions WHERE token = ? LIMIT 1",
    )
    .bind(token)
    .first<SessionRow>();
}

async function createSession(
  db: D1Database,
  code: string,
  playerId: string,
) {
  const token = newToken();
  await db
    .prepare(
      `INSERT INTO poker_sessions (token, room_code, player_id, updated_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(token, code, playerId, Date.now())
    .run();
  return token;
}

async function deletePlayerSessions(
  db: D1Database,
  code: string,
  playerId: string,
) {
  await db
    .prepare(
      "DELETE FROM poker_sessions WHERE room_code = ? AND player_id = ?",
    )
    .bind(code, playerId)
    .run();
}

async function mutateRoom(
  db: D1Database,
  code: string,
  mutate: (room: PokerRoom) => ActionOutcome,
) {
  for (let attempt = 0; attempt < MAX_MUTATION_ATTEMPTS; attempt++) {
    const loaded = await loadRoom(db, code);
    if (!loaded) return null;
    const { room, revision } = loaded;
    const ticked = room.tick();
    const outcome = mutate(room);
    const now = Date.now();

    if (outcome.skipWrite && !ticked) {
      return { room, outcome };
    }

    const result = outcome.deleteRoom
      ? await db
          .prepare("DELETE FROM poker_rooms WHERE code = ? AND revision = ?")
          .bind(code, revision)
          .run()
      : await db
          .prepare(
            `UPDATE poker_rooms
             SET state_json = ?, revision = revision + 1, updated_at = ?
             WHERE code = ? AND revision = ?`,
          )
          .bind(JSON.stringify(room.toSnapshot()), now, code, revision)
          .run();

    if (Number(result.meta.changes ?? 0) === 1) {
      return { room, outcome };
    }
  }
  throw new Error("room update conflict");
}

type RoomSessionResult =
  | {
      room: PokerRoom;
      code: string;
      playerId: string;
      sessionToken: string;
    }
  | { error: string };

async function createRoom(
  db: D1Database,
  msg: Extract<ClientMsg, { t: "create" }>,
): Promise<RoomSessionResult> {
  const name = String(msg.name ?? "").trim().slice(0, 16);
  if (!name) return { error: "请输入昵称" };
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
  if (bb <= sb) return { error: "大盲必须大于小盲" };
  if (startingChips < bb * 10)
    return { error: "初始筹码至少为大盲的 10 倍" };
  if (buyInAmount < bb * 10)
    return { error: "一手买入金额至少为大盲的 10 倍" };

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = genCode();
    const playerId = crypto.randomUUID();
    const sessionToken = newToken();
    const room = new PokerRoom(code, playerId, {
      startingChips,
      buyInAmount,
      sb,
      bb,
      decisionTimeSec,
      timeBankSec,
    });
    room.usePersistentScheduling();
    room.addPlayer(playerId, name);
    try {
      const [inserted, session] = await db.batch([
        db
          .prepare(
          `INSERT INTO poker_rooms
           (code, state_json, revision, updated_at)
           VALUES (?, ?, 0, ?)`,
        )
          .bind(code, JSON.stringify(room.toSnapshot()), Date.now()),
        db
          .prepare(
            `INSERT INTO poker_sessions
             (token, room_code, player_id, updated_at)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(sessionToken, code, playerId, Date.now()),
      ]);
      if (
        Number(inserted.meta.changes ?? 0) !== 1 ||
        Number(session.meta.changes ?? 0) !== 1
      ) {
        throw new Error("D1 create-room batch did not insert both records");
      }
      return { room, code, playerId, sessionToken };
    } catch (cause) {
      if (isRoomCodeCollision(cause)) continue;
      console.error("create room storage error", cause);
      throw cause;
    }
  }
  return { error: "暂时无法生成房间码，请重试" };
}

async function joinRoom(
  db: D1Database,
  msg: Extract<ClientMsg, { t: "join" }>,
): Promise<RoomSessionResult> {
  const code = String(msg.code ?? "").trim().toUpperCase();
  const name = String(msg.name ?? "").trim().slice(0, 16);
  if (!name) return { error: "请输入昵称" };

  const existingSession = msg.sessionToken
    ? await sessionFor(db, msg.sessionToken)
    : null;
  let resumed: SessionRow | null =
    existingSession?.room_code === code ? existingSession : null;

  const result = await mutateRoom(db, code, (room) => {
    if (resumed && room.byId(resumed.player_id)) {
      room.byId(resumed.player_id)!.connected = true;
      return {};
    }
    if (room.players.length >= MAX_PLAYERS) {
      return { error: "房间已满（最多 9 人）" };
    }
    const playerId = crypto.randomUUID();
    room.addPlayer(playerId, name, { funded: false });
    resumed = { room_code: code, player_id: playerId };
    return {};
  });
  if (!result) return { error: "房间不存在，请检查房间码" };
  if (result.outcome.error) return { error: result.outcome.error };
  if (!resumed) return { error: "加入房间失败，请重试" };

  const playerId = resumed.player_id;
  const sessionToken =
    msg.sessionToken &&
    existingSession?.room_code === code &&
    existingSession.player_id === playerId
      ? msg.sessionToken
      : await createSession(db, code, playerId);
  return { room: result.room, code, playerId, sessionToken };
}

function applyAction(
  room: PokerRoom,
  playerId: string,
  msg: ClientMsg,
): ActionOutcome {
  switch (msg.t) {
    case "setSeat":
      return { error: room.setSeat(playerId, msg.seat) ?? undefined };
    case "start":
      if (playerId !== room.hostId)
        return { error: "只有房主可以开始游戏" };
      return { error: room.startHand() ?? undefined };
    case "action":
      return {
        error:
          room.applyAction(playerId, msg.action, msg.amount) ?? undefined,
      };
    case "rebuy":
      return {
        error:
          room.requestRebuy(
            playerId,
            msg.mode ?? "oneHand",
            msg.amount,
          ) ?? undefined,
      };
    case "rebuyCancel":
      room.cancelRebuy(playerId);
      return {};
    case "rebuyApprove":
      return {
        error:
          room.approveRebuy(playerId, msg.playerId, msg.amount) ?? undefined,
      };
    case "rebuyReject": {
      if (playerId !== room.hostId)
        return { error: "只有房主可以审批买入" };
      const rejectedName = room.rejectRebuy(playerId, msg.playerId);
      if (rejectedName === null) return {};
      return {
        event: {
          targetPlayerId: msg.playerId,
          message: { t: "error", message: "房主拒绝了你的买入申请" },
        },
      };
    }
    case "setDecisionTime":
      return {
        error:
          room.setDecisionTime(playerId, msg.seconds) ?? undefined,
      };
    case "setTimeBank":
      return {
        error: room.setTimeBank(playerId, msg.seconds) ?? undefined,
      };
    case "setRoomSettings":
      return {
        error:
          room.setRoomSettings(playerId, msg.settings) ?? undefined,
      };
    case "setPaused":
      return {
        error: room.setPaused(playerId, msg.paused) ?? undefined,
      };
    case "returnToLobby":
      return {
        error: room.returnToLobby(playerId) ?? undefined,
      };
    case "show":
      return {
        error: room.showCards(playerId, msg.indices) ?? undefined,
      };
    case "emote": {
      const emoji = String(msg.emoji ?? "").trim();
      if (!ALLOWED_EMOTES.has(emoji))
        return { error: "这个表情暂不支持" };
      const player = room.byId(playerId);
      if (!player) return { error: "玩家不存在" };
      const targetPlayerId = String(msg.targetPlayerId ?? "").trim();
      if (!targetPlayerId) return { error: "请先选择表情目标" };
      if (targetPlayerId === playerId)
        return { error: "请选择其他玩家作为目标" };
      const target = room.byId(targetPlayerId);
      if (!target) return { error: "目标玩家已离开" };
      if (!target.connected) return { error: "目标玩家已离线" };
      const event: EmoteEvent = {
        id: crypto.randomUUID(),
        playerId,
        name: player.name,
        targetPlayerId: target.id,
        targetName: target.name,
        emoji,
        at: Date.now(),
      };
      return { event: { message: { t: "emote", event } } };
    }
    case "chat": {
      const player = room.byId(playerId);
      if (!player) return { error: "玩家不存在" };
      const text = String(msg.text ?? "").trim().slice(0, 120);
      if (!text) return {};
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        playerId,
        name: player.name,
        text,
        at: Date.now(),
      };
      return { event: { message: { t: "chat", message } } };
    }
    case "kick":
      if (playerId !== room.hostId)
        return { error: "只有房主可以移出玩家" };
      if (msg.playerId === playerId) return { error: "不能移出自己" };
      if (!room.byId(msg.playerId)) return { error: "玩家不存在" };
      room.removePlayer(msg.playerId);
      return {
        deletePlayerSessions: msg.playerId,
        event: {
          targetPlayerId: msg.playerId,
          message: { t: "kicked" },
        },
      };
    case "leave":
      room.removePlayer(playerId);
      return {
        deletePlayerSessions: playerId,
        deleteRoom: room.players.length === 0,
      };
    default:
      return { error: "不支持的操作" };
  }
}

async function poll(
  db: D1Database,
  code: string,
  sessionToken: string,
  cursor: number,
) {
  const session = await sessionFor(db, sessionToken);
  if (!session || session.room_code !== code)
    return error("会话已失效，请重新加入房间", 401);

  const updated = await mutateRoom(db, code, () => ({ skipWrite: true }));
  if (!updated) return error("房间不存在或已结束", 404);
  const { room } = updated;
  const events = await readEvents(
    db,
    code,
    session.player_id,
    cursor,
  );
  if (!room.byId(session.player_id)) {
    return json({
      messages:
        events.messages.length > 0
          ? events.messages
          : [{ t: "kicked" }],
      cursor: events.cursor,
    });
  }
  return json({
    messages: [
      { t: "state", state: room.toJSON(session.player_id) },
      ...events.messages,
    ],
    cursor: events.cursor,
  });
}

export async function handlePokerHttp(
  request: Request,
  db: D1Database | undefined,
): Promise<Response> {
  try {
    if (!db) throw new Error("D1 binding DB is unavailable");
    await ensureSchema(db);

    if (request.method === "GET") {
      return error("请使用 POST 请求", 405);
    }

    if (request.method !== "POST") {
      return error("请求方法不支持", 405);
    }

    const payload = (await request.json()) as PokerRequest;
    if (payload.poll) {
      const code = String(payload.roomCode ?? "").trim().toUpperCase();
      const sessionToken = String(payload.sessionToken ?? "");
      const cursor = Math.max(0, Number(payload.cursor ?? 0) || 0);
      if (!code || !sessionToken)
        return error("缺少房间会话信息", 400);
      return poll(db, code, sessionToken, cursor);
    }

    const msg = payload?.message;
    if (!msg || typeof msg !== "object" || typeof msg.t !== "string") {
      return error("消息格式错误", 400);
    }

    if (msg.t === "create") {
      const created = await createRoom(db, msg);
      if (!("room" in created)) return error(created.error);
      const cursor = await latestCursor(db, created.code);
      return json({
        messages: [
          {
            t: "joined",
            code: created.code,
            playerId: created.playerId,
            sessionToken: created.sessionToken,
            state: created.room.toJSON(created.playerId),
          },
        ],
        cursor,
      });
    }

    if (msg.t === "join") {
      const joined = await joinRoom(db, msg);
      if (!("room" in joined)) return error(joined.error);
      const cursor = await latestCursor(db, joined.code);
      return json({
        messages: [
          {
            t: "joined",
            code: joined.code,
            playerId: joined.playerId,
            sessionToken: joined.sessionToken,
            state: joined.room.toJSON(joined.playerId),
          },
        ],
        cursor,
      });
    }

    const code = String(payload.roomCode ?? "").trim().toUpperCase();
    const sessionToken = String(payload.sessionToken ?? "");
    if (!code || !sessionToken)
      return error("会话已失效，请重新加入房间", 401);
    const session = await sessionFor(db, sessionToken);
    if (!session || session.room_code !== code)
      return error("会话已失效，请重新加入房间", 401);

    const updated = await mutateRoom(db, code, (room) => {
      if (!room.byId(session.player_id))
        return { error: "你已不在这个房间中" };
      return applyAction(room, session.player_id, msg);
    });
    if (!updated) return error("房间不存在或已结束", 404);

    const { room, outcome } = updated;
    if (outcome.event) {
      await appendEvent(
        db,
        code,
        outcome.event.message,
        outcome.event.targetPlayerId,
      );
    }
    if (outcome.deletePlayerSessions) {
      await deletePlayerSessions(db, code, outcome.deletePlayerSessions);
    }
    if (outcome.deleteRoom) {
      await db
        .prepare("DELETE FROM poker_events WHERE room_code = ?")
        .bind(code)
        .run();
      return json({ messages: [], cursor: 0 });
    }

    const cursor = Math.max(0, Number(payload.cursor ?? 0) || 0);
    const events = await readEvents(
      db,
      code,
      session.player_id,
      cursor,
    );
    const messages: ServerMsg[] = [];
    if (outcome.error) messages.push({ t: "error", message: outcome.error });
    messages.push({ t: "state", state: room.toJSON(session.player_id) });
    messages.push(...events.messages);
    return json({ messages, cursor: events.cursor });
  } catch (cause) {
    console.error("poker http error", cause);
    return error("服务器处理失败，请稍后重试", 500);
  }
}
