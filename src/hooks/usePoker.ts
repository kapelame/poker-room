import { useSyncExternalStore } from "react";
import type {
  ChatMessage,
  ClientMsg,
  EmoteEvent,
  RoomState,
  ServerMsg,
} from "@contracts/game";
import { buildPokerApiUrl } from "@/lib/server-url";

interface PokerStore {
  wsReady: boolean;
  joined: boolean;
  roomCode: string | null;
  playerId: string | null;
  state: RoomState | null;
  kicked: boolean;
  lastError: string | null;
  requesting: "create" | "join" | null;
  emotes: EmoteEvent[];
  chatMessages: ChatMessage[];
}

interface PokerApiResponse {
  messages: ServerMsg[];
  cursor: number;
}

interface PokerSession {
  code: string;
  playerId: string;
  name: string;
  sessionToken: string;
}

const REQUEST_TIMEOUT_MS = 12000;

function storageGet(key: string) {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage may be blocked by privacy settings. The live session still works.
  }
}

function storageRemove(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore blocked storage so leaving a room never breaks the UI.
  }
}

const initial: PokerStore = {
  wsReady: false,
  joined: false,
  roomCode: null,
  playerId: null,
  state: null,
  kicked: false,
  lastError: null,
  requesting: null,
  emotes: [],
  chatMessages: [],
};

class PokerClient {
  private store: PokerStore = { ...initial };
  private listeners = new Set<() => void>();
  private session: PokerSession | null = null;
  private pendingName = "";
  private cursor = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollQueued = false;
  private requestQueue: Promise<void> = Promise.resolve();
  private emoteTimers = new Map<string, ReturnType<typeof setTimeout>>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.store;

  private set(partial: Partial<PokerStore>) {
    this.store = { ...this.store, ...partial };
    for (const fn of this.listeners) fn();
  }

  connect() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.queuePoll(), 800);
    this.set({ wsReady: true });
    this.queuePoll();
  }

  private enqueue(task: () => Promise<void>) {
    this.requestQueue = this.requestQueue
      .catch(() => undefined)
      .then(task)
      .catch((cause: unknown) => {
        const timedOut =
          typeof cause === "object" &&
          cause !== null &&
          "name" in cause &&
          cause.name === "AbortError";
        this.set({
          wsReady: false,
          lastError: timedOut
            ? "连接超时，请重试"
            : "网络连接失败，请检查网络后重试",
          requesting: null,
        });
      });
  }

  private async request(body: Record<string, unknown>) {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await fetch(buildPokerApiUrl(), {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: controller.signal,
      });
      const data = (await response.json()) as PokerApiResponse;
      return { response, data };
    } finally {
      window.clearTimeout(timer);
    }
  }

  private async post(body: Record<string, unknown>) {
    const { response, data } = await this.request(body);
    this.set({ wsReady: response.status < 500 });
    this.consume(data);
  }

  private queuePoll() {
    if (!this.session || this.pollQueued) return;
    this.pollQueued = true;
    this.enqueue(async () => {
      try {
        const session = this.session;
        if (!session) return;
        const { response, data } = await this.request({
            poll: true,
            roomCode: session.code,
            sessionToken: session.sessionToken,
            cursor: this.cursor,
        });
        this.set({ wsReady: response.status < 500 });
        this.consume(data);
      } finally {
        this.pollQueued = false;
      }
    });
  }

  private consume(data: PokerApiResponse) {
    if (!data || !Array.isArray(data.messages)) {
      throw new Error("invalid poker response");
    }
    this.cursor = Math.max(0, Number(data.cursor) || 0);
    for (const message of data.messages) this.handle(message);
  }

  private handle(msg: ServerMsg) {
    switch (msg.t) {
      case "joined": {
        const sessionToken = msg.sessionToken;
        if (!sessionToken) {
          this.set({ lastError: "服务器未返回有效会话，请重试" });
          return;
        }
        this.session = {
          code: msg.code,
          playerId: msg.playerId,
          name: this.pendingName || this.savedName,
          sessionToken,
        };
        this.pendingName = "";
        storageSet(`poker:session:${msg.code}`, sessionToken);
        this.set({
          joined: true,
          roomCode: msg.code,
          playerId: msg.playerId,
          state: msg.state,
          kicked: false,
          lastError: null,
          requesting: null,
          emotes: [],
          chatMessages: [],
        });
        this.queuePoll();
        break;
      }
      case "state":
        this.set({ state: msg.state });
        break;
      case "emote": {
        const event = msg.event;
        const existing = this.store.emotes.filter((item) => item.id !== event.id);
        this.set({ emotes: [...existing, event].slice(-20) });
        const previous = this.emoteTimers.get(event.id);
        if (previous) clearTimeout(previous);
        const timer = setTimeout(() => {
          this.emoteTimers.delete(event.id);
          this.set({
            emotes: this.store.emotes.filter((item) => item.id !== event.id),
          });
        }, 4500);
        this.emoteTimers.set(event.id, timer);
        break;
      }
      case "chat":
        if (this.store.chatMessages.some((item) => item.id === msg.message.id))
          break;
        this.set({
          chatMessages: [...this.store.chatMessages, msg.message].slice(-50),
        });
        break;
      case "error":
        this.set({ lastError: msg.message, requesting: null });
        break;
      case "kicked":
        this.leaveLocal();
        this.set({ kicked: true });
        break;
    }
  }

  send(msg: ClientMsg) {
    this.connect();
    if (msg.t === "create" || msg.t === "join") {
      this.pendingName = String(msg.name ?? "").trim();
      this.set({ requesting: msg.t, lastError: null });
    }
    const session = this.session;
    const body = {
      message: msg,
      roomCode: session?.code,
      sessionToken: session?.sessionToken,
      cursor: this.cursor,
    };
    this.enqueue(async () => {
      await this.post(body);
      this.queuePoll();
    });
  }

  clearError() {
    this.set({ lastError: null });
  }

  clearKicked() {
    this.set({ kicked: false });
  }

  leaveLocal() {
    if (this.session) {
      storageRemove(`poker:session:${this.session.code}`);
    }
    this.session = null;
    this.cursor = 0;
    this.pendingName = "";
    this.set({
      joined: false,
      roomCode: null,
      playerId: null,
      state: null,
      lastError: null,
      requesting: null,
      emotes: [],
      chatMessages: [],
    });
  }

  leave() {
    this.send({ t: "leave" });
    this.leaveLocal();
  }

  get savedName() {
    return storageGet("poker:name") ?? "";
  }

  set savedName(value: string) {
    storageSet("poker:name", value);
  }

  savedSession(code: string) {
    return storageGet(`poker:session:${code}`);
  }
}

export const poker = new PokerClient();

export function usePoker() {
  return useSyncExternalStore(poker.subscribe, poker.getSnapshot);
}
