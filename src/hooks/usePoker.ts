import { useSyncExternalStore } from "react";
import type {
  ClientMsg,
  EmoteEvent,
  RoomState,
  ServerMsg,
} from "@contracts/game";
import { buildWebSocketUrl } from "@/lib/server-url";

interface PokerStore {
  wsReady: boolean;
  joined: boolean;
  roomCode: string | null;
  playerId: string | null;
  state: RoomState | null;
  kicked: boolean;
  lastError: string | null;
  emotes: EmoteEvent[];
}

const initial: PokerStore = {
  wsReady: false,
  joined: false,
  roomCode: null,
  playerId: null,
  state: null,
  kicked: false,
  lastError: null,
  emotes: [],
};

class PokerClient {
  private ws: WebSocket | null = null;
  private store: PokerStore = { ...initial };
  private listeners = new Set<() => void>();
  private reconnectDelay = 500;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private emoteTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** 重连后要恢复的房间会话 */
  private session: { code: string; playerId: string; name: string } | null =
    null;

  /* ---------- store ---------- */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.store;
  private set(partial: Partial<PokerStore>) {
    this.store = { ...this.store, ...partial };
    for (const fn of this.listeners) fn();
  }

  /* ---------- 连接 ---------- */
  connect() {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    )
      return;
    const ws = new WebSocket(buildWebSocketUrl());
    this.ws = ws;
    this.intentionalClose = false;

    ws.onopen = () => {
      this.reconnectDelay = 500;
      this.set({ wsReady: true });
      // 断线重连：恢复原座位
      if (this.session) {
        const raw = localStorage.getItem(`poker:session:${this.session.code}`);
        const pid = raw ?? this.session.playerId;
        this.sendRaw({
          t: "join",
          code: this.session.code,
          name: this.session.name,
          playerId: pid,
        });
      }
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.handle(msg);
    };
    ws.onclose = () => {
      this.set({ wsReady: false });
      this.ws = null;
      if (!this.intentionalClose) this.scheduleReconnect();
    };
    ws.onerror = () => {
      ws.close();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 5000);
      this.connect();
    }, this.reconnectDelay);
  }

  private handle(msg: ServerMsg) {
    switch (msg.t) {
      case "joined":
        this.session = {
          code: msg.code,
          playerId: msg.playerId,
          name: this.session?.name ?? "",
        };
        localStorage.setItem(`poker:session:${msg.code}`, msg.playerId);
        this.set({
          joined: true,
          roomCode: msg.code,
          playerId: msg.playerId,
          state: msg.state,
          kicked: false,
          emotes: [],
        });
        break;
      case "state":
        this.set({ state: msg.state });
        break;
      case "emote": {
        const event = msg.event;
        this.set({
          emotes: [
            ...this.store.emotes.filter((e) => e.id !== event.id),
            event,
          ].slice(-20),
        });
        const timer = setTimeout(() => {
          this.emoteTimers.delete(event.id);
          this.set({
            emotes: this.store.emotes.filter((e) => e.id !== event.id),
          });
        }, 2600);
        this.emoteTimers.set(event.id, timer);
        break;
      }
      case "error":
        this.set({ lastError: msg.message });
        break;
      case "kicked":
        this.leaveLocal();
        this.set({ kicked: true });
        break;
    }
  }

  private sendRaw(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  send(msg: ClientMsg) {
    this.connect();
    const w = this.ws;
    if (!w) return;
    if (w.readyState === WebSocket.OPEN) {
      w.send(JSON.stringify(msg));
    } else {
      // 等连接就绪后再发
      const t = setInterval(() => {
        if (w.readyState === WebSocket.OPEN) {
          clearInterval(t);
          w.send(JSON.stringify(msg));
        }
      }, 50);
      setTimeout(() => clearInterval(t), 3000);
    }
  }

  clearError() {
    this.set({ lastError: null });
  }

  clearKicked() {
    this.set({ kicked: false });
  }

  /** 本地登出（保持连接，仅清会话） */
  leaveLocal() {
    if (this.session) {
      localStorage.removeItem(`poker:session:${this.session.code}`);
    }
    this.session = null;
    this.set({
      joined: false,
      roomCode: null,
      playerId: null,
      state: null,
      emotes: [],
    });
  }

  leave() {
    this.send({ t: "leave" });
    this.leaveLocal();
  }

  get savedName() {
    return localStorage.getItem("poker:name") ?? "";
  }
  set savedName(v: string) {
    localStorage.setItem("poker:name", v);
  }
  savedSession(code: string) {
    return localStorage.getItem(`poker:session:${code}`);
  }
}

export const poker = new PokerClient();

export function usePoker() {
  return useSyncExternalStore(poker.subscribe, poker.getSnapshot);
}
