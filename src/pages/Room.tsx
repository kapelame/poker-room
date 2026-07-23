import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { poker, usePoker } from "@/hooks/usePoker";
import type {
  BuyInMode,
  PublicPlayer,
  RebuyRequest,
  RoomState,
} from "@contracts/game";
import { Seat } from "@/components/poker/Seat";
import { PlayingCard } from "@/components/poker/PlayingCard";
import { ActionBar } from "@/components/poker/ActionBar";
import { LogPanel } from "@/components/poker/LogPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Copy,
  Check,
  Coins,
  Crown,
  DoorOpen,
  ListOrdered,
  Spade,
  TrendingUp,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";

const PHASE_LABEL: Record<string, string> = {
  waiting: "等待开局",
  preflop: "翻牌前",
  flop: "翻牌圈",
  turn: "转牌圈",
  river: "河牌圈",
  showdown: "摊牌",
};

function playTurnSound() {
  try {
    const AudioContextClass =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      660,
      context.currentTime + 0.18,
    );
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.23);
    void context.resume().catch(() => undefined);
    window.setTimeout(() => void context.close(), 500);
  } catch {
    // 浏览器禁止自动播放时，行动仍然可以正常进行。
  }
}

export default function Room() {
  const { code = "" } = useParams();
  const nav = useNavigate();
  const {
    joined,
    roomCode,
    playerId,
    state,
    wsReady,
    lastError,
    kicked,
    emotes,
  } = usePoker();
  const [name, setName] = useState(poker.savedName);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [now, setNow] = useState(Date.now());
  const [decisionSetting, setDecisionSetting] = useState("30");
  const nextHandAtRef = useRef<number>(0);
  const joinTriedRef = useRef(false);
  const lastTurnSoundRef = useRef("");
  const isMobile = useIsMobile();

  /* ---------- 连接 & 加入 ---------- */
  useEffect(() => {
    poker.connect();
  }, []);

  useEffect(() => {
    if (kicked) nav("/");
  }, [kicked, nav]);

  // 已有会话（刷新/重进）自动恢复
  useEffect(() => {
    if (joinTriedRef.current) return;
    if (joined && roomCode === code.toUpperCase()) return;
    const saved = poker.savedSession(code.toUpperCase());
    const savedName = poker.savedName;
    if (saved && savedName) {
      joinTriedRef.current = true;
      poker.send({
        t: "join",
        code: code.toUpperCase(),
        name: savedName,
        playerId: saved,
      });
    }
  }, [code, joined, roomCode]);

  useEffect(() => {
    if (lastError) {
      toast.error(lastError);
      poker.clearError();
    }
  }, [lastError]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (state?.nextHandIn != null) {
      nextHandAtRef.current = Date.now() + state.nextHandIn * 1000;
    }
  }, [state?.nextHandIn]);

  useEffect(() => {
    if (state?.decisionTimeSec != null) {
      setDecisionSetting(String(state.decisionTimeSec));
    }
  }, [state?.decisionTimeSec]);

  const me = state?.players.find((p) => p.id === playerId);

  const countdown = useMemo(() => {
    if (state?.nextHandIn == null) return null;
    return Math.max(0, Math.ceil((nextHandAtRef.current - now) / 1000));
  }, [state?.nextHandIn, now]);

  const myTurn =
    me != null &&
    state?.turnSeat === me.seat &&
    ["preflop", "flop", "turn", "river"].includes(state.phase);

  const decisionCountdown = useMemo(() => {
    if (!state?.turnDeadline) return null;
    return Math.max(0, Math.ceil((state.turnDeadline - now) / 1000));
  }, [state?.turnDeadline, now]);

  useEffect(() => {
    if (!myTurn || !state) return;
    const key = `${state.handNumber}:${state.phase}:${state.turnSeat}`;
    if (lastTurnSoundRef.current === key) return;
    lastTurnSoundRef.current = key;
    playTurnSound();
  }, [myTurn, state?.handNumber, state?.phase, state?.turnSeat]);

  /* ---------- 渲染 ---------- */

  // 加入入口（昵称门）
  const needJoin = !joined || roomCode !== code.toUpperCase() || !state || !me;
  if (needJoin) {
    return (
      <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,#064e3b_0%,#022c22_45%,#01120e_100%)] flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-black/50 backdrop-blur p-6 space-y-4">
          <div className="flex items-center gap-2 text-white">
            <Spade className="w-6 h-6 text-amber-400" />
            <h1 className="text-xl font-bold">加入房间 {code.toUpperCase()}</h1>
          </div>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="输入你的昵称"
            maxLength={16}
            className="bg-white/5 border-white/15 text-white"
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) {
                poker.savedName = name.trim();
                poker.leaveLocal();
                poker.send({
                  t: "join",
                  code: code.toUpperCase(),
                  name: name.trim(),
                });
              }
            }}
          />
          <Button
            className="w-full bg-emerald-600 hover:bg-emerald-700 font-bold"
            disabled={!name.trim()}
            onClick={() => {
              poker.savedName = name.trim();
              poker.leaveLocal();
              poker.send({
                t: "join",
                code: code.toUpperCase(),
                name: name.trim(),
              });
            }}
          >
            坐下
          </Button>
          <Button
            variant="ghost"
            className="w-full text-neutral-400"
            onClick={() => nav("/")}
          >
            返回首页
          </Button>
        </div>
      </div>
    );
  }

  const s = state as RoomState;
  const isHost = me!.isHost;
  const activeCount = s.players.filter(
    (p) =>
      p.connected &&
      (p.chips > 0 ||
        s.pendingBuyIns.some((request) => request.playerId === p.id)),
  ).length;
  const inLobby = s.phase === "waiting";
  const myRebuyRequest = s.rebuyRequests.find(
    (request) => request.playerId === playerId,
  );
  const myApprovedBuyIn = s.pendingBuyIns.find(
    (request) => request.playerId === playerId,
  );
  const canShowCards =
    s.phase === "showdown" &&
    me != null &&
    me!.inHand &&
    !me!.folded &&
    (me!.hole?.length ?? 0) === 2;

  const copy = async (what: "code" | "link") => {
    const text = what === "code" ? s.code : `${location.origin}/room/${s.code}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };

  const saveDecisionTime = () => {
    const seconds = Number(decisionSetting);
    if (!Number.isInteger(seconds) || seconds < 5 || seconds > 300) {
      toast.error("决策时间需设置为 5 到 300 秒");
      return;
    }
    poker.send({ t: "setDecisionTime", seconds });
  };

  /* ---------- 大厅 ---------- */
  if (inLobby) {
    return (
      <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,#064e3b_0%,#022c22_45%,#01120e_100%)] text-white flex flex-col">
        <Header
          code={s.code}
          wsReady={wsReady}
          copied={copied}
          copy={copy}
          onLeave={() => {
            poker.leave();
            nav("/");
          }}
          logSlot={<SidePanels state={s} meId={playerId!} isHost={isHost} />}
        />
        <div className="flex-1 flex flex-col items-center justify-center p-4 gap-8">
          <div className="text-center space-y-2">
            <div className="text-neutral-400 text-sm">房间码</div>
            <button
              onClick={() => copy("code")}
              className="text-6xl font-black tracking-[0.25em] font-mono text-amber-300 hover:text-amber-200 transition-colors"
            >
              {s.code}
            </button>
            <div className="text-neutral-400 text-sm">
              或分享链接：{location.origin}/room/{s.code}
            </div>
          </div>

          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-black/40 backdrop-blur p-5">
            <div className="flex items-center gap-2 mb-3 text-neutral-300">
              <Users className="w-4 h-4" /> 玩家（{s.players.length}/9）
            </div>
            <div className="space-y-2">
              {s.players.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5"
                >
                  {p.isHost && <Crown className="w-4 h-4 text-yellow-400" />}
                  <span className="flex-1 truncate">
                    {p.name}
                    {p.id === playerId && (
                      <span className="text-emerald-400 text-xs ml-1">
                        (你)
                      </span>
                    )}
                  </span>
                  {!p.connected && <WifiOff className="w-4 h-4 text-red-400" />}
                  <span className="text-amber-300 text-sm font-semibold">
                    {p.chips.toLocaleString()}
                  </span>
                  {isHost && p.id !== playerId && (
                    <button
                      className="text-neutral-500 hover:text-red-400"
                      onClick={() => poker.send({ t: "kick", playerId: p.id })}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4 text-center text-xs text-neutral-400">
              盲注 {s.sb}/{s.bb} · 初始筹码 {s.startingChips.toLocaleString()} ·
              一手买入 {s.buyInAmount.toLocaleString()}
            </div>
          </div>

          {isHost && (
            <DecisionTimeSetting
              value={decisionSetting}
              onChange={setDecisionSetting}
              onSave={saveDecisionTime}
            />
          )}

          <div className="flex flex-col items-center gap-3">
            {isHost ? (
              <Button
                size="lg"
                disabled={activeCount < 2}
                onClick={() => poker.send({ t: "start" })}
                className="bg-amber-500 hover:bg-amber-600 text-black font-black text-lg px-12 h-14 rounded-full shadow-[0_0_30px_rgba(245,158,11,0.35)]"
              >
                {s.handNumber > 0 ? "继续游戏" : "开始游戏"}
                {activeCount < 2 && "（至少 2 人）"}
              </Button>
            ) : (
              <div className="text-neutral-300 animate-pulse">
                等待房主开始游戏…
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ---------- 牌桌 ---------- */
  const players = s.players;
  const meIdx = Math.max(
    0,
    players.findIndex((p) => p.id === playerId),
  );
  const n = players.length;
  const posFor = (i: number, rx: number, ry: number) => {
    const rel = (((i - meIdx) % n) + n) % n;
    const angle = ((90 + rel * (360 / Math.max(n, 1))) * Math.PI) / 180;
    return { x: 50 + rx * Math.cos(angle), y: 50 + ry * Math.sin(angle) };
  };

  const winners = s.players.filter((p) => p.isWinner && (p.winAmount ?? 0) > 0);
  const turnPlayer = players.find((p) => p.seat === s.turnSeat);

  return (
    <div className="h-screen flex flex-col bg-[#01120e] text-white overflow-hidden">
      <Header
        code={s.code}
        wsReady={wsReady}
        copied={copied}
        copy={copy}
        onLeave={() => {
          poker.leave();
          nav("/");
        }}
        logSlot={<SidePanels state={s} meId={playerId!} isHost={isHost} />}
        extra={
          <>
            <span className="text-xs text-neutral-400 hidden sm:inline">
              第 {s.handNumber} 手 · {PHASE_LABEL[s.phase]} · 盲注 {s.sb}/{s.bb}
            </span>
            {isHost && (
              <DecisionTimeSetting
                value={decisionSetting}
                onChange={setDecisionSetting}
                onSave={saveDecisionTime}
                compact
              />
            )}
          </>
        }
      />

      {/* 桌面区域 */}
      <div className="flex-1 relative min-h-0">
        {/* 桌布 */}
        <div className="absolute inset-x-[6%] top-[8%] bottom-[14%] rounded-[50%] bg-[radial-gradient(ellipse_at_center,#0d9488_0%,#0f766e_45%,#115e59_75%,#134e4a_100%)] border-[10px] border-[#3f2d1e] shadow-[inset_0_0_60px_rgba(0,0,0,0.5),0_20px_60px_rgba(0,0,0,0.6)]" />

        {/* 中央区域：底池 + 公共牌 */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-3 z-10">
          <div className="px-4 py-1.5 rounded-full bg-black/50 border border-amber-400/40 text-amber-300 font-bold text-lg shadow">
            底池 {s.pot.toLocaleString()}
          </div>
          {s.pots.length > 1 && s.phase === "showdown" && (
            <div className="text-[11px] text-neutral-300 text-center">
              {s.pots.map((p, i) => (
                <span key={i} className="mx-1">
                  {i === 0 ? "主池" : `边池${i}`} {p.amount.toLocaleString()}
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-1.5 md:gap-2">
            {s.community.map((c, i) => (
              <PlayingCard key={i} card={c} size="lg" delay={i * 100} />
            ))}
            {Array.from({ length: 5 - s.community.length }).map((_, i) => (
              <div
                key={`e${i}`}
                className="w-14 h-20 rounded-lg border-2 border-dashed border-white/15"
              />
            ))}
          </div>
          {s.phase === "showdown" && winners.length > 0 && (
            <div className="px-5 py-2 rounded-xl bg-black/70 border border-yellow-400/50 text-center animate-card-in">
              {winners.map((w) => (
                <div key={w.id} className="text-yellow-300 font-bold">
                  🎉 {w.name} 赢得 {w.winAmount!.toLocaleString()}
                  {w.handName ? `（${w.handName}）` : ""}
                </div>
              ))}
              {countdown != null && (
                <div className="text-neutral-300 text-sm mt-1">
                  下一手 {countdown}s
                </div>
              )}
              {isHost && (
                <Button
                  size="sm"
                  className="mt-2 bg-amber-500 text-black font-bold"
                  onClick={() => poker.send({ t: "start" })}
                >
                  立即开始下一手
                </Button>
              )}
            </div>
          )}
        </div>

        {/* 座位 */}
        {players.map((p, i) => {
          const pos = posFor(i, isMobile ? 42 : 46, isMobile ? 32 : 44);
          return (
            <div
              key={p.id}
              className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            >
              <Seat
                player={p}
                isMe={p.id === playerId}
                isTurn={s.turnSeat === p.seat}
                phase={s.phase}
                equity={p.id === playerId ? s.equity : undefined}
                emotes={emotes.filter((event) => event.playerId === p.id)}
              />
            </div>
          );
        })}

        {/* 下注筹码标记 */}
        {players.map((p, i) => {
          if (p.bet <= 0) return null;
          const pos = posFor(i, isMobile ? 27 : 30, isMobile ? 21 : 26);
          return (
            <div
              key={`bet-${p.id}`}
              className="absolute z-10 -translate-x-1/2 -translate-y-1/2 animate-card-in"
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            >
              <div className="px-2.5 py-1 rounded-full bg-amber-500/90 text-black text-xs font-black shadow-lg border border-amber-300">
                {p.bet.toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>

      {/* 底部操作区 */}
      <div className="relative z-30 px-4 pb-4 pt-2 bg-gradient-to-t from-black/80 to-transparent">
        {isHost && <RebuyApprovals state={s} />}
        <div className="w-full max-w-xl mx-auto flex flex-col items-center gap-2">
          {me && (
            <BuyInRequestPanel
              state={s}
              playerId={playerId!}
              pending={myRebuyRequest}
              approved={myApprovedBuyIn}
            />
          )}
          {myTurn ? (
            <ActionBar
              state={s}
              me={me!}
              secondsRemaining={decisionCountdown ?? undefined}
            />
          ) : s.phase === "showdown" ? (
            <div className="flex items-center gap-4 flex-wrap justify-center min-h-12">
              <span className="text-neutral-400 text-sm">
                {countdown != null ? `下一手 ${countdown}s…` : "等待下一手…"}
              </span>
              {canShowCards && <ShowCardToggle me={me!} />}
            </div>
          ) : (
            <div className="flex items-center justify-center gap-3 h-12">
              {turnPlayer ? (
                <span className="text-neutral-400 text-sm">
                  等待 <b className="text-emerald-300">{turnPlayer.name}</b>{" "}
                  行动…
                  {decisionCountdown != null && `（${decisionCountdown}s）`}
                </span>
              ) : (
                <span className="text-neutral-400 text-sm">观战中…</span>
              )}
            </div>
          )}
          <QuickEmotes />
        </div>
      </div>
    </div>
  );
}

/* ---------- 顶栏 ---------- */
function Header({
  code,
  wsReady,
  copied,
  copy,
  onLeave,
  logSlot,
  extra,
}: {
  code: string;
  wsReady: boolean;
  copied: "code" | "link" | null;
  copy: (w: "code" | "link") => void;
  onLeave: () => void;
  logSlot: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-black/50 border-b border-white/10 z-40">
      <div className="flex items-center gap-2">
        <Spade className="w-5 h-5 text-amber-400" />
        <span className="font-mono font-bold tracking-widest text-amber-200">
          {code}
        </span>
      </div>
      <button
        onClick={() => copy("link")}
        className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-white/15 text-neutral-300 hover:bg-white/10"
      >
        {copied === "link" ? (
          <Check className="w-3.5 h-3.5 text-emerald-400" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
        复制邀请链接
      </button>
      {extra}
      <div className="flex-1" />
      {wsReady ? (
        <Wifi className="w-4 h-4 text-emerald-400" />
      ) : (
        <WifiOff className="w-4 h-4 text-red-400 animate-pulse" />
      )}
      {logSlot}
      <button
        onClick={onLeave}
        className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-red-500/40 text-red-400 hover:bg-red-500/10"
      >
        <DoorOpen className="w-3.5 h-3.5" /> 离开
      </button>
    </div>
  );
}

/* ---------- 侧栏（日志 / 玩家） ---------- */
function SidePanels({
  state,
  meId,
  isHost,
}: {
  state: RoomState;
  meId: string;
  isHost: boolean;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-white/15 text-neutral-300 hover:bg-white/10">
          <ListOrdered className="w-3.5 h-3.5" /> 日志
        </button>
      </SheetTrigger>
      <SheetContent className="bg-neutral-950 border-white/10 text-white w-[380px]">
        <SheetHeader>
          <SheetTitle className="text-white">牌局信息</SheetTitle>
        </SheetHeader>
        <Tabs
          defaultValue="log"
          className="mt-2 h-[calc(100%-3rem)] flex flex-col"
        >
          <TabsList className="bg-white/5">
            <TabsTrigger value="log">日志</TabsTrigger>
            <TabsTrigger value="score">
              <TrendingUp className="w-3.5 h-3.5 mr-1" />
              记分板
            </TabsTrigger>
            <TabsTrigger value="players">
              玩家（{state.players.length}）
            </TabsTrigger>
          </TabsList>
          <TabsContent value="log" className="flex-1 min-h-0 mt-2">
            <LogPanel log={state.log} />
          </TabsContent>
          <TabsContent
            value="score"
            className="flex-1 min-h-0 mt-2 overflow-y-auto"
          >
            <Scoreboard state={state} meId={meId} />
          </TabsContent>
          <TabsContent value="players" className="mt-2 space-y-2">
            {state.players.map((p: PublicPlayer) => (
              <div
                key={p.id}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5"
              >
                {p.isHost && <Crown className="w-4 h-4 text-yellow-400" />}
                <span className="flex-1 truncate">
                  {p.name}
                  {p.id === meId && (
                    <span className="text-emerald-400 text-xs ml-1">(你)</span>
                  )}
                </span>
                {!p.connected && <WifiOff className="w-4 h-4 text-red-400" />}
                <span className="text-amber-300 text-sm font-semibold">
                  {p.chips.toLocaleString()}
                </span>
                {isHost && p.id !== meId && (
                  <button
                    className="text-neutral-500 hover:text-red-400"
                    onClick={() => poker.send({ t: "kick", playerId: p.id })}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

/* ---------- 记分板 ---------- */
function Scoreboard({ state, meId }: { state: RoomState; meId: string }) {
  const rows = state.scoreboard;
  if (!rows.length)
    return <div className="text-neutral-500 text-sm">暂无数据</div>;
  return (
    <div className="rounded-lg border border-white/10 overflow-hidden text-sm">
      <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_0.7fr] gap-x-2 px-3 py-2 bg-white/5 text-[11px] text-neutral-400">
        <span>玩家</span>
        <span className="text-right">筹码</span>
        <span className="text-right">盈亏</span>
        <span className="text-right">获胜率</span>
        <span className="text-right">买入</span>
      </div>
      {rows.map((e, i) => {
        const rate = e.hands > 0 ? Math.round((e.wins / e.hands) * 100) : 0;
        return (
          <div
            key={e.playerId}
            className="grid grid-cols-[1.4fr_1fr_1fr_1fr_0.7fr] gap-x-2 items-center px-3 py-2 border-t border-white/5"
          >
            <span className="flex items-center gap-1 truncate">
              {i === 0 && e.profit > 0 && (
                <Crown className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
              )}
              {e.isHost && i !== 0 && (
                <Crown className="w-3.5 h-3.5 text-yellow-600 shrink-0" />
              )}
              <span className="truncate">
                {e.name}
                {e.playerId === meId && (
                  <span className="text-emerald-400 text-xs ml-1">(你)</span>
                )}
              </span>
              {!e.connected && (
                <WifiOff className="w-3 h-3 text-red-400 shrink-0" />
              )}
            </span>
            <span className="text-right text-amber-300 font-semibold">
              {e.chips.toLocaleString()}
            </span>
            <span
              className={
                "text-right font-bold " +
                (e.profit > 0
                  ? "text-emerald-400"
                  : e.profit < 0
                    ? "text-red-400"
                    : "text-neutral-400")
              }
            >
              {e.profit > 0 ? "+" : ""}
              {e.profit.toLocaleString()}
            </span>
            <span className="text-right text-neutral-200">
              {rate}%
              <span className="block text-[10px] text-neutral-500">
                {e.wins}/{e.hands} 手
              </span>
            </span>
            <span className="text-right text-neutral-400">×{e.buyIns}</span>
          </div>
        );
      })}
      <div className="px-3 py-2 border-t border-white/10 text-[10px] text-neutral-500">
        盈亏 = 当前筹码 − 累计买入 · 买入列为次数（含初始）
      </div>
    </div>
  );
}

/* ---------- 房主决策时间 ---------- */
function DecisionTimeSetting({
  value,
  onChange,
  onSave,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact
          ? "flex items-center gap-1 text-xs text-neutral-400"
          : "flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
      }
    >
      <span>{compact ? "决策" : "每次决策时间"}</span>
      <Input
        type="number"
        min={5}
        max={300}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onSave}
        onKeyDown={(event) => {
          if (event.key === "Enter") onSave();
        }}
        className={
          compact
            ? "h-7 w-14 border-white/15 bg-white/5 px-1 text-center text-xs text-white"
            : "h-8 w-20 border-white/15 bg-white/5 px-2 text-center text-white"
        }
      />
      <span>秒</span>
    </div>
  );
}

/* ---------- 买入申请 ---------- */
const BUY_IN_MODE_LABEL: Record<BuyInMode, string> = {
  custom: "自定义",
  oneHand: "买入一手",
  average: "均码",
  leader: "对齐领先",
};

function BuyInRequestPanel({
  state,
  playerId,
  pending,
  approved,
}: {
  state: RoomState;
  playerId: string;
  pending?: RebuyRequest;
  approved?: RebuyRequest;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<BuyInMode>("oneHand");
  const [customAmount, setCustomAmount] = useState(String(state.buyInAmount));

  if (pending) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-amber-300 text-sm animate-pulse">
          买入申请已发送（{pending.amount.toLocaleString()}），等待房主审批…
        </span>
        <Button
          variant="outline"
          size="sm"
          className="border-white/20 text-neutral-300 hover:bg-white/10"
          onClick={() => poker.send({ t: "rebuyCancel" })}
        >
          取消申请
        </Button>
      </div>
    );
  }
  if (approved) {
    return (
      <span className="text-emerald-300 text-sm animate-pulse">
        买入已批准，将在下一手到账（{approved.amount.toLocaleString()} 筹码）
      </span>
    );
  }

  const me = state.players.find((player) => player.id === playerId);
  if (!me) return null;
  const stacks = state.players
    .filter((player) => player.connected && player.chips > 0)
    .map((player) => player.chips);
  const averageStack = stacks.length
    ? Math.floor(stacks.reduce((sum, chips) => sum + chips, 0) / stacks.length)
    : state.buyInAmount;
  const leaderStack = state.players.reduce(
    (max, player) => Math.max(max, player.chips),
    me.chips,
  );
  const amounts: Record<BuyInMode, number> = {
    custom: Number(customAmount),
    oneHand: state.buyInAmount,
    average: averageStack - me.chips,
    leader: leaderStack - me.chips,
  };
  const selectedAmount = amounts[mode];
  const validAmount = Number.isInteger(selectedAmount) && selectedAmount >= 100;

  const submit = () => {
    if (!validAmount) return;
    poker.send({
      t: "rebuy",
      mode,
      amount: mode === "custom" ? selectedAmount : undefined,
    });
    setOpen(false);
  };

  if (!open) {
    return (
      <Button
        size="sm"
        className="bg-emerald-600 hover:bg-emerald-700 font-bold px-4"
        onClick={() => setOpen(true)}
      >
        <Coins className="w-4 h-4 mr-1.5" />
        申请买入
      </Button>
    );
  }

  return (
    <div className="w-full max-w-xl rounded-xl border border-emerald-400/30 bg-black/55 px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-neutral-300">选择买入方式</span>
        <span className="text-[11px] text-neutral-500">通过后下一手到账</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {(Object.keys(BUY_IN_MODE_LABEL) as BuyInMode[]).map((option) => (
          <button
            key={option}
            type="button"
            className={
              "rounded-lg border px-2 py-1.5 text-left transition-colors " +
              (mode === option
                ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
                : "border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10")
            }
            onClick={() => setMode(option)}
          >
            <div className="text-xs font-bold">{BUY_IN_MODE_LABEL[option]}</div>
            <div className="text-[10px] text-neutral-400">
              {option === "custom"
                ? "输入金额"
                : selectedAmountForMode(amounts[option])}
            </div>
          </button>
        ))}
      </div>
      {mode === "custom" && (
        <Input
          type="number"
          min={100}
          value={customAmount}
          onChange={(event) => setCustomAmount(event.target.value)}
          placeholder="输入买入金额"
          className="mt-2 h-9 border-white/15 bg-white/5 text-white"
        />
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-neutral-400">
          本次买入：
          <b className={validAmount ? "text-emerald-300" : "text-red-300"}>
            {Number.isFinite(selectedAmount)
              ? selectedAmount.toLocaleString()
              : "无效金额"}
          </b>
        </span>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-white/15 text-neutral-300 hover:bg-white/10"
            onClick={() => setOpen(false)}
          >
            取消
          </Button>
          <Button
            size="sm"
            disabled={!validAmount}
            className="h-8 bg-emerald-600 font-bold hover:bg-emerald-700"
            onClick={submit}
          >
            提交申请
          </Button>
        </div>
      </div>
    </div>
  );
}

function selectedAmountForMode(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return "当前无需补充";
  return `+${amount.toLocaleString()}`;
}

/* ---------- 快捷表情 ---------- */
function QuickEmotes() {
  const choices = ["💩", "😂", "👍", "🔥", "😈", "🤡"];
  return (
    <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/35 px-2 py-1">
      <span className="mr-1 text-[10px] text-neutral-500">丢表情</span>
      {choices.map((emoji) => (
        <button
          key={emoji}
          type="button"
          title={`发送 ${emoji}`}
          className="rounded-full px-1.5 py-0.5 text-lg leading-none transition-transform hover:scale-125 active:scale-95"
          onClick={() => poker.send({ t: "emote", emoji })}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

/* ---------- 摊牌后亮牌 ---------- */
function ShowCardToggle({ me }: { me: PublicPlayer }) {
  const hole = me.hole ?? [];
  const shown = me.shown ?? [];
  const allShown = hole.length === 2 && shown[0] && shown[1];
  if (allShown) {
    return <span className="text-emerald-300 text-sm">本手已自动亮牌</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-neutral-400 text-xs">亮牌</span>
      {hole.map(
        (c, i) =>
          c && (
            <button
              key={i}
              disabled={!!shown[i]}
              onClick={() => poker.send({ t: "show", indices: [i] })}
              className={
                "relative rounded-lg transition-all " +
                (shown[i]
                  ? "ring-2 ring-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.5)]"
                  : "hover:scale-110 hover:ring-2 hover:ring-white/50 cursor-pointer")
              }
              title={shown[i] ? "已亮出" : "点击亮出这张牌"}
            >
              <PlayingCard card={c} size="sm" />
              {shown[i] && (
                <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[9px] px-1 rounded bg-amber-500 text-black font-bold whitespace-nowrap">
                  已亮
                </span>
              )}
            </button>
          ),
      )}
      {!allShown && (
        <Button
          size="sm"
          variant="outline"
          className="border-amber-400/50 text-amber-300 hover:bg-amber-500/10 h-8 ml-1"
          onClick={() => poker.send({ t: "show", indices: [0, 1] })}
        >
          全亮
        </Button>
      )}
    </div>
  );
}

/* ---------- 房主买入审批条 ---------- */
function RebuyApprovals({ state }: { state: RoomState }) {
  if (!state.rebuyRequests.length) return null;
  return (
    <div className="w-full max-w-xl mx-auto mb-2 space-y-1.5">
      {state.rebuyRequests.map((request) => (
        <RebuyApprovalRow key={request.playerId} request={request} />
      ))}
    </div>
  );
}

function RebuyApprovalRow({ request }: { request: RebuyRequest }) {
  const [value, setValue] = useState(String(request.amount));
  const amount = Number(value);
  const valid =
    Number.isInteger(amount) && amount >= 100 && amount <= 1_000_000;

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-400/40 animate-card-in">
      <Coins className="w-4 h-4 text-amber-300 shrink-0" />
      <span className="flex-1 text-sm truncate">
        <b className="text-amber-200">{request.name}</b>
        <span className="text-neutral-300">
          {" "}
          申请{BUY_IN_MODE_LABEL[request.mode]}{" "}
          {request.amount.toLocaleString()} 筹码
        </span>
      </span>
      <Input
        type="number"
        min={100}
        max={1_000_000}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="h-7 w-24 border-white/15 bg-white/5 px-2 text-center text-xs text-white"
        title="房主可以修改最终买入金额"
      />
      <Button
        size="sm"
        disabled={!valid}
        className="bg-emerald-600 hover:bg-emerald-700 h-7 px-3 font-bold"
        onClick={() =>
          poker.send({
            t: "rebuyApprove",
            playerId: request.playerId,
            amount,
          })
        }
      >
        同意
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="border-red-500/50 text-red-400 hover:bg-red-500/10 h-7 px-3"
        onClick={() =>
          poker.send({ t: "rebuyReject", playerId: request.playerId })
        }
      >
        拒绝
      </Button>
    </div>
  );
}
