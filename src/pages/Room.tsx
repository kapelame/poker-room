import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useNavigate, useParams } from "react-router";
import { poker, usePoker } from "@/hooks/usePoker";
import type {
  BuyInMode,
  ChatMessage,
  EmoteEvent,
  PublicPlayer,
  RebuyRequest,
  RoomSettings,
  RoomState,
} from "@contracts/game";
import { Seat } from "@/components/poker/Seat";
import { PlayingCard } from "@/components/poker/PlayingCard";
import { ActionBar } from "@/components/poker/ActionBar";
import { LogPanel } from "@/components/poker/LogPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
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
  Armchair,
  Coins,
  Crown,
  DoorOpen,
  ListOrdered,
  RotateCcw,
  SmilePlus,
  Spade,
  Settings2,
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
    chatMessages,
  } = usePoker();
  const [name, setName] = useState(poker.savedName);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [now, setNow] = useState(0);
  const [decisionSetting, setDecisionSetting] = useState("30");
  const [timeBankSetting, setTimeBankSetting] = useState("30");
  const [sbSetting, setSbSetting] = useState("5");
  const [bbSetting, setBbSetting] = useState("10");
  const [buyInSetting, setBuyInSetting] = useState("1000");
  const [emotePickerOpen, setEmotePickerOpen] = useState(false);
  const [emoteTargetId, setEmoteTargetId] = useState<string | null>(null);
  const [seatPickerOpen, setSeatPickerOpen] = useState(false);
  const joinTriedRef = useRef(false);
  const lastTurnSoundRef = useRef("");
  const isMobile = useIsMobile();
  const displayedSettings = state?.pendingSettings ?? state;
  const displayedSb = displayedSettings?.sb;
  const displayedBb = displayedSettings?.bb;
  const displayedBuyIn = displayedSettings?.buyInAmount;
  const displayedDecision = displayedSettings?.decisionTimeSec;
  const displayedTimeBank = displayedSettings?.timeBankSec;

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
        sessionToken: saved,
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
    if (
      displayedSb != null &&
      displayedBb != null &&
      displayedBuyIn != null &&
      displayedDecision != null &&
      displayedTimeBank != null
    ) {
      // Room settings are externally owned and can change from another client.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDecisionSetting(String(displayedDecision));
      setTimeBankSetting(String(displayedTimeBank));
      setSbSetting(String(displayedSb));
      setBbSetting(String(displayedBb));
      setBuyInSetting(String(displayedBuyIn));
    }
  }, [
    displayedBb,
    displayedBuyIn,
    displayedDecision,
    displayedSb,
    displayedTimeBank,
  ]);

  const me = state?.players.find((p) => p.id === playerId);

  const myTurn =
    me != null &&
    state?.turnSeat === me.seat &&
    !state.paused &&
    ["preflop", "flop", "turn", "river"].includes(state.phase);

  const decisionCountdown = useMemo(() => {
    if (!state?.turnDeadline || now === 0) return null;
    return Math.max(0, Math.ceil((state.turnDeadline - now) / 1000));
  }, [state?.turnDeadline, now]);

  const nextHandCountdown =
    state?.nextHandAt && now !== 0
      ? Math.max(0, Math.ceil((state.nextHandAt - now) / 1000))
      : null;

  useEffect(() => {
    if (!myTurn || !state) return;
    const key = `${state.handNumber}:${state.phase}:${state.turnSeat}`;
    if (lastTurnSoundRef.current === key) return;
    lastTurnSoundRef.current = key;
    playTurnSound();
  }, [myTurn, state]);

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
            进入房间
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
      p.seat >= 0 &&
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

  const saveRoomSettings = () => {
    const settings: RoomSettings = {
      sb: Number(sbSetting),
      bb: Number(bbSetting),
      buyInAmount: Number(buyInSetting),
      decisionTimeSec: Number(decisionSetting),
      timeBankSec: Number(timeBankSetting),
    };
    if (Object.values(settings).some((value) => !Number.isInteger(value))) {
      toast.error("牌桌设置必须填写整数");
      return false;
    }
    if (settings.sb < 1 || settings.bb <= settings.sb) {
      toast.error("大盲必须大于小盲");
      return false;
    }
    if (settings.sb > 10_000 || settings.bb > 20_000) {
      toast.error("小盲不能超过 10,000，大盲不能超过 20,000");
      return false;
    }
    if (
      settings.buyInAmount < settings.bb * 10 ||
      settings.buyInAmount > 1_000_000
    ) {
      toast.error("一手买入至少为大盲的 10 倍，且不能超过 1,000,000");
      return false;
    }
    if (
      settings.decisionTimeSec < 5 ||
      settings.decisionTimeSec > 300 ||
      settings.timeBankSec < 0 ||
      settings.timeBankSec > 300
    ) {
      toast.error("决策时间需为 5-300 秒，时间银行需为 0-300 秒");
      return false;
    }
    poker.send({ t: "setRoomSettings", settings });
    toast.success(
      ["preflop", "flop", "turn", "river"].includes(s.phase)
        ? "设置已保存，将从下一手生效"
        : "牌桌设置已更新",
    );
    return true;
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

          <SeatPicker
            players={s.players}
            meId={playerId!}
            onChoose={(seat) => poker.send({ t: "setSeat", seat })}
          />

          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-black/40 backdrop-blur p-5">
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
                  <span className="rounded-md bg-white/5 px-2 py-1 text-[10px] text-neutral-400">
                    {p.seat >= 0 ? `${p.seat + 1} 号位` : "未选座"}
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

          {(me!.chips <= 0 || myRebuyRequest || myApprovedBuyIn) && (
            <div className="flex flex-col items-center gap-2 text-center">
              {!myRebuyRequest && !myApprovedBuyIn && (
                <span className="text-sm text-emerald-200">
                  先选择买入方案，房主批准后即可参加牌局。
                </span>
              )}
              <BuyInRequestPanel
                state={s}
                playerId={playerId!}
                pending={myRebuyRequest}
                approved={myApprovedBuyIn}
                isMobile={isMobile}
              />
            </div>
          )}

          {isHost && (
            <RebuyApprovals state={s} isMobile={isMobile} />
          )}

          {isHost && (
            <RoomSettingsControl
              state={s}
              sb={sbSetting}
              onSbChange={setSbSetting}
              bb={bbSetting}
              onBbChange={setBbSetting}
              buyIn={buyInSetting}
              onBuyInChange={setBuyInSetting}
              decision={decisionSetting}
              onDecisionChange={setDecisionSetting}
              timeBank={timeBankSetting}
              onTimeBankChange={setTimeBankSetting}
              onSave={saveRoomSettings}
              isMobile={isMobile}
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
                {me!.seat < 0
                  ? "请先选择座位"
                  : s.handNumber > 0
                    ? "继续游戏"
                    : "开始游戏"}
                {me!.seat >= 0 && activeCount < 2 && "（至少 2 人已入座）"}
              </Button>
            ) : (
              <div className="text-center text-sm text-neutral-300">
                选好座位并完成买入后，等待房主首次开局
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ---------- 牌桌 ---------- */
  const players = s.players;
  const seatedPlayers = players.filter((player) => player.seat >= 0);
  const anchorSeat = me!.seat >= 0 ? me!.seat : 0;
  const posForSeat = (seat: number, rx: number, ry: number) => {
    const rel = (seat - anchorSeat + 9) % 9;
    const angle = ((90 + rel * 40) * Math.PI) / 180;
    return { x: 50 + rx * Math.cos(angle), y: 50 + ry * Math.sin(angle) };
  };

  const winners = s.players.filter((p) => p.isWinner && (p.winAmount ?? 0) > 0);
  const turnPlayer = players.find((p) => p.seat === s.turnSeat);

  return (
    <div className="h-dvh flex flex-col bg-[#01120e] text-white overflow-hidden">
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
              <RoomSettingsControl
                state={s}
                sb={sbSetting}
                onSbChange={setSbSetting}
                bb={bbSetting}
                onBbChange={setBbSetting}
                buyIn={buyInSetting}
                onBuyInChange={setBuyInSetting}
                decision={decisionSetting}
                onDecisionChange={setDecisionSetting}
                timeBank={timeBankSetting}
                onTimeBankChange={setTimeBankSetting}
                onSave={saveRoomSettings}
                isMobile={isMobile}
                compact
              />
            )}
            {isHost && <PauseControl paused={s.paused} />}
            {isHost && <ReturnToLobbyControl phase={s.phase} />}
            {!isHost && s.paused && (
              <span className="rounded-md bg-amber-500/15 px-2 py-1 text-xs text-amber-200">
                牌局已暂停
              </span>
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
              <div className="mt-1 text-xs text-emerald-200/80">
                {nextHandCountdown != null
                  ? `${nextHandCountdown} 秒后自动开始下一手`
                  : "等待至少 2 名已入座玩家"}
              </div>
            </div>
          )}
        </div>

        {/* 座位 */}
        {seatedPlayers.map((p) => {
          const pos = posForSeat(
            p.seat,
            isMobile ? 42 : 46,
            isMobile ? 29 : 38,
          );
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
                onEmoteTarget={
                  p.id !== playerId && p.connected
                    ? () => {
                        setEmoteTargetId(p.id);
                        setEmotePickerOpen(true);
                      }
                    : undefined
                }
                emoteTargetSelected={
                  emotePickerOpen && emoteTargetId === p.id
                }
              />
            </div>
          );
        })}

        <EmoteProjectiles
          events={emotes}
          players={seatedPlayers}
          positionForSeat={(seat) =>
            posForSeat(
              seat,
              isMobile ? 42 : 46,
              isMobile ? 29 : 38,
            )
          }
        />

        {/* 下注筹码标记 */}
        {seatedPlayers.map((p) => {
          if (p.bet <= 0) return null;
          const pos = posForSeat(
            p.seat,
            isMobile ? 27 : 30,
            isMobile ? 19 : 24,
          );
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
      <div className="relative z-30 bg-gradient-to-t from-black/80 to-transparent px-2 pt-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
        <div className="w-full max-w-xl mx-auto flex flex-col items-center gap-2">
          {me!.seat < 0 ? (
            <SeatPickerControl
              open={seatPickerOpen}
              onOpenChange={setSeatPickerOpen}
              players={s.players}
              meId={playerId!}
              onChoose={(seat) => {
                poker.send({ t: "setSeat", seat });
                setSeatPickerOpen(false);
              }}
              isMobile={isMobile}
            />
          ) : me!.chips <= 0 && !myRebuyRequest && !myApprovedBuyIn ? (
            <div className="flex min-h-12 items-center justify-center text-center text-sm text-emerald-200">
              请选择买入方案；房主批准后，下一手即可参与牌局。
            </div>
          ) : myTurn ? (
            <ActionBar
              state={s}
              me={me!}
              secondsRemaining={decisionCountdown ?? undefined}
            />
          ) : s.paused ? (
            <div className="flex min-h-12 items-center justify-center text-sm text-amber-200">
              牌局已暂停，等待房主继续…
            </div>
          ) : s.phase === "showdown" ? (
            <div className="flex items-center gap-4 flex-wrap justify-center min-h-12">
              <span className="text-emerald-200 text-sm">
                {nextHandCountdown != null
                  ? `下一手将在 ${nextHandCountdown} 秒后自动开始`
                  : "等待至少 2 名已入座玩家"}
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
          <div className="flex w-full flex-wrap items-center justify-center gap-2">
            {isHost && (
              <RebuyApprovals state={s} isMobile={isMobile} />
            )}
            <QuickEmotes
              players={s.players}
              meId={playerId!}
              isMobile={isMobile}
              open={emotePickerOpen}
              onOpenChange={setEmotePickerOpen}
              selectedTargetId={emoteTargetId}
              onTargetChange={setEmoteTargetId}
            />
            {me && (
              <BuyInRequestPanel
                state={s}
                playerId={playerId!}
                pending={myRebuyRequest}
                approved={myApprovedBuyIn}
                isMobile={isMobile}
              />
            )}
            <QuickChat messages={chatMessages} />
          </div>
        </div>
      </div>
    </div>
  );
}

const SEAT_PICKER_POSITIONS = [
  { left: 50, top: 91 },
  { left: 22, top: 84 },
  { left: 8, top: 58 },
  { left: 14, top: 27 },
  { left: 35, top: 9 },
  { left: 65, top: 9 },
  { left: 86, top: 27 },
  { left: 92, top: 58 },
  { left: 78, top: 84 },
] as const;

function SeatPicker({
  players,
  meId,
  onChoose,
}: {
  players: PublicPlayer[];
  meId: string;
  onChoose: (seat: number) => void;
}) {
  const me = players.find((player) => player.id === meId);
  return (
    <section className="w-full max-w-2xl rounded-2xl border border-white/10 bg-black/40 p-4 backdrop-blur sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-bold text-white">
            <Armchair className="h-4 w-4 text-amber-300" />
            选择座位
          </div>
          <p className="mt-1 text-xs text-neutral-400">
            {me?.seat != null && me.seat >= 0
              ? `你在 ${me.seat + 1} 号位，可点击其他空位换座`
              : "无需等待其他玩家，先选一个喜欢的位置坐下"}
          </p>
        </div>
        {me?.seat != null && me.seat >= 0 && (
          <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-bold text-emerald-200">
            已入座
          </span>
        )}
      </div>
      <div className="relative mx-auto h-[300px] w-full max-w-xl sm:h-[340px]">
        <div className="absolute inset-x-[13%] bottom-[17%] top-[15%] rounded-[50%] border-[7px] border-[#3f2d1e] bg-[radial-gradient(ellipse_at_center,#0d9488_0%,#0f766e_50%,#115e59_100%)] shadow-[inset_0_0_45px_rgba(0,0,0,0.45)]">
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <Spade className="mx-auto h-7 w-7 text-amber-300/80" />
              <div className="mt-1 text-xs font-bold text-emerald-100/70">
                9 人牌桌
              </div>
            </div>
          </div>
        </div>
        {SEAT_PICKER_POSITIONS.map((position, seat) => {
          const occupant = players.find((player) => player.seat === seat);
          const isMe = occupant?.id === meId;
          const disabled = !!occupant && !isMe;
          return (
            <button
              key={seat}
              type="button"
              disabled={disabled}
              aria-label={
                occupant
                  ? `${seat + 1} 号位，${occupant.name}${isMe ? "，你的位置" : ""}`
                  : `选择 ${seat + 1} 号位`
              }
              onClick={() => onChoose(seat)}
              className={
                "absolute flex min-h-14 w-[72px] -translate-x-1/2 -translate-y-1/2 touch-manipulation flex-col items-center justify-center rounded-xl border px-1.5 py-1 text-center shadow-lg transition-all sm:w-[88px] " +
                (isMe
                  ? "border-amber-300 bg-amber-400 text-neutral-950 ring-2 ring-amber-200/50"
                  : occupant
                    ? "cursor-not-allowed border-white/10 bg-neutral-900/95 text-neutral-400"
                    : "border-emerald-300/45 bg-emerald-950/95 text-emerald-100 hover:-translate-y-[54%] hover:border-emerald-200 hover:bg-emerald-500/30")
              }
              style={{
                left: `${position.left}%`,
                top: `${position.top}%`,
              }}
            >
              {occupant ? (
                <>
                  <span className="max-w-full truncate text-xs font-black">
                    {occupant.name}
                  </span>
                  <span className="text-[10px] opacity-75">
                    {seat + 1} 号位
                  </span>
                </>
              ) : (
                <>
                  <Armchair className="h-4 w-4" />
                  <span className="mt-0.5 text-[10px] font-bold">
                    {seat + 1} · 空位
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SeatPickerControl({
  open,
  onOpenChange,
  players,
  meId,
  onChoose,
  isMobile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  players: PublicPlayer[];
  meId: string;
  onChoose: (seat: number) => void;
  isMobile: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button className="min-h-11 rounded-full !bg-amber-400 px-6 font-black !text-neutral-950 hover:!bg-amber-300">
          <Armchair className="h-4 w-4" />
          选择座位，下一手入座
        </Button>
      </SheetTrigger>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className="max-h-[90dvh] overflow-y-auto border-white/10 bg-neutral-950 pb-[max(1rem,env(safe-area-inset-bottom))] text-white sm:max-w-2xl"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-white">选择牌桌座位</SheetTitle>
          <SheetDescription className="text-neutral-400">
            选座后会从下一手开始参与牌局。
          </SheetDescription>
        </SheetHeader>
        <div className="px-4">
          <SeatPicker players={players} meId={meId} onChoose={onChoose} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function EmoteProjectiles({
  events,
  players,
  positionForSeat,
}: {
  events: EmoteEvent[];
  players: PublicPlayer[];
  positionForSeat: (seat: number) => { x: number; y: number };
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
      {events.slice(-8).map((event) => {
        if (!event.targetPlayerId) return null;
        const sender = players.find(
          (player) => player.id === event.playerId,
        );
        const target = players.find(
          (player) => player.id === event.targetPlayerId,
        );
        if (!sender || !target) return null;
        const from = positionForSeat(sender.seat);
        const to = positionForSeat(target.seat);
        const middle = {
          x: (from.x + to.x) / 2,
          y: Math.max(5, (from.y + to.y) / 2 - 15),
        };
        const style = {
          "--from-x": `${from.x}%`,
          "--from-y": `${from.y}%`,
          "--mid-x": `${middle.x}%`,
          "--mid-y": `${middle.y}%`,
          "--to-x": `${to.x}%`,
          "--to-y": `${to.y}%`,
        } as CSSProperties;
        return (
          <span
            key={event.id}
            className="emote-projectile"
            style={style}
            aria-hidden="true"
          >
            {event.emoji}
          </span>
        );
      })}
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
        <button className="flex items-center gap-1.5 rounded-md border border-emerald-300/25 bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-100 transition-colors hover:border-emerald-300/40 hover:bg-emerald-400/15">
          <ListOrdered className="h-3.5 w-3.5" /> 日志
        </button>
      </SheetTrigger>
      <SheetContent className="w-[min(94vw,440px)] gap-0 border-emerald-200/10 bg-[linear-gradient(180deg,#111816_0%,#080b0a_100%)] p-0 text-white sm:max-w-md [&_[data-slot=sheet-close]]:right-5 [&_[data-slot=sheet-close]]:top-5 [&_[data-slot=sheet-close]]:rounded-lg [&_[data-slot=sheet-close]]:p-1.5 [&_[data-slot=sheet-close]]:text-neutral-300 [&_[data-slot=sheet-close]]:hover:bg-white/10 [&_[data-slot=sheet-close]]:hover:text-white">
        <SheetHeader className="border-b border-white/10 bg-emerald-400/[0.04] px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-white">
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-emerald-300/20 bg-emerald-400/10">
              <ListOrdered className="h-4 w-4 text-emerald-300" />
            </span>
            牌局信息
          </SheetTitle>
          <SheetDescription className="text-neutral-400">
            查看牌局记录、筹码总结和当前玩家
          </SheetDescription>
        </SheetHeader>
        <Tabs
          defaultValue="log"
          className="h-[calc(100%-5.25rem)] gap-3 px-4 pb-4 pt-3"
        >
          <TabsList className="grid h-11 w-full grid-cols-3 rounded-xl border border-white/10 bg-black/35 p-1">
            <TabsTrigger
              value="log"
              className="rounded-lg text-neutral-300 hover:bg-white/[0.07] hover:text-white data-[state=active]:border-emerald-300/25 data-[state=active]:bg-emerald-400/15 data-[state=active]:text-emerald-100 data-[state=active]:shadow-none"
            >
              <ListOrdered className="h-3.5 w-3.5" />
              日志
            </TabsTrigger>
            <TabsTrigger
              value="score"
              className="rounded-lg text-neutral-300 hover:bg-white/[0.07] hover:text-white data-[state=active]:border-emerald-300/25 data-[state=active]:bg-emerald-400/15 data-[state=active]:text-emerald-100 data-[state=active]:shadow-none"
            >
              <TrendingUp className="h-3.5 w-3.5" />
              总结
            </TabsTrigger>
            <TabsTrigger
              value="players"
              className="rounded-lg text-neutral-300 hover:bg-white/[0.07] hover:text-white data-[state=active]:border-emerald-300/25 data-[state=active]:bg-emerald-400/15 data-[state=active]:text-emerald-100 data-[state=active]:shadow-none"
            >
              <Users className="h-3.5 w-3.5" />
              玩家 {state.players.length}
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="log"
            className="min-h-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-black/25"
          >
            <LogPanel log={state.log} />
          </TabsContent>
          <TabsContent
            value="score"
            className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-white/10 bg-black/25"
          >
            <Scoreboard state={state} meId={meId} />
          </TabsContent>
          <TabsContent
            value="players"
            className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-black/25 p-2"
          >
            {state.players.map((p: PublicPlayer) => (
              <div
                key={p.id}
                className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.055] px-3 py-2.5 transition-colors hover:bg-white/[0.08]"
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
                    aria-label={`移出 ${p.name}`}
                    title={`移出 ${p.name}`}
                    className="rounded-md border border-transparent p-1 text-neutral-400 transition-colors hover:border-red-400/20 hover:bg-red-400/10 hover:text-red-300"
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
      <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1.1fr] gap-x-2 px-3 py-2 bg-white/5 text-[11px] text-neutral-400">
        <span>玩家</span>
        <span className="text-right">筹码</span>
        <span className="text-right">盈亏</span>
        <span className="text-right">获胜率</span>
        <span className="text-right">累计买入</span>
      </div>
      {rows.map((e, i) => {
        const rate = e.hands > 0 ? Math.round((e.wins / e.hands) * 100) : 0;
        return (
          <div
            key={e.playerId}
            className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1.1fr] gap-x-2 items-center px-3 py-2 border-t border-white/5"
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
            <span className="text-right text-neutral-300">
              {e.totalBuyIn.toLocaleString()}
              <span className="block text-[10px] text-neutral-500">
                {e.buyIns} 次
              </span>
            </span>
          </div>
        );
      })}
      <div className="px-3 py-2 border-t border-white/10 text-[10px] text-neutral-500">
        盈亏 = 当前筹码 − 累计买入；初始买入也计入累计。
      </div>
    </div>
  );
}

/* ---------- 房主牌桌设置 ---------- */
function RoomSettingsControl({
  state,
  sb,
  onSbChange,
  bb,
  onBbChange,
  buyIn,
  onBuyInChange,
  decision,
  onDecisionChange,
  timeBank,
  onTimeBankChange,
  onSave,
  isMobile,
  compact = false,
}: {
  state: RoomState;
  sb: string;
  onSbChange: (value: string) => void;
  bb: string;
  onBbChange: (value: string) => void;
  buyIn: string;
  onBuyInChange: (value: string) => void;
  decision: string;
  onDecisionChange: (value: string) => void;
  timeBank: string;
  onTimeBankChange: (value: string) => void;
  onSave: () => boolean;
  isMobile: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const active = ["preflop", "flop", "turn", "river"].includes(state.phase);
  const fields = [
    {
      label: "小盲",
      value: sb,
      onChange: onSbChange,
      min: 1,
      max: 10_000,
    },
    {
      label: "大盲",
      value: bb,
      onChange: onBbChange,
      min: 2,
      max: 20_000,
    },
    {
      label: "一手买入",
      value: buyIn,
      onChange: onBuyInChange,
      min: 100,
      max: 1_000_000,
    },
    {
      label: "每次决策（秒）",
      value: decision,
      onChange: onDecisionChange,
      min: 5,
      max: 300,
    },
    {
      label: "时间银行（秒）",
      value: timeBank,
      onChange: onTimeBankChange,
      min: 0,
      max: 300,
    },
  ];
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className={
            compact
              ? "h-7 border-white/15 bg-white/5 px-2 text-xs text-neutral-200 hover:bg-white/10 hover:text-white"
              : "h-10 border-white/15 bg-white/5 px-4 text-neutral-200 hover:bg-white/10 hover:text-white"
          }
        >
          <Settings2 className="h-3.5 w-3.5" />
          {compact ? "设置" : "调整牌桌设置"}
          {state.pendingSettings && (
            <span className="rounded-full bg-amber-400/20 px-1.5 text-[10px] text-amber-200">
              待生效
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className="max-h-[88dvh] overflow-y-auto border-white/10 bg-neutral-950 pb-[max(1rem,env(safe-area-inset-bottom))] text-white sm:max-w-md"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2 text-white">
            <Settings2 className="h-5 w-5 text-amber-300" />
            牌桌设置
          </SheetTitle>
          <SheetDescription className="leading-6 text-neutral-400">
            {active
              ? "可以随时保存；为保证本手公平，修改会从下一手统一生效。"
              : "修改会立即保存，并用于下一手牌。"}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4">
          <div className="grid grid-cols-2 gap-3">
            {fields.map((field) => (
              <label
                key={field.label}
                className={
                  field.label === "一手买入"
                    ? "col-span-2 space-y-1.5"
                    : "space-y-1.5"
                }
              >
                <span className="text-xs font-medium text-neutral-300">
                  {field.label}
                </span>
                <Input
                  type="number"
                  min={field.min}
                  max={field.max}
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.value)}
                  className="h-11 border-white/15 bg-white/5 text-white"
                />
              </label>
            ))}
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs leading-5 text-neutral-400">
            当前初始筹码为 {state.startingChips.toLocaleString()}；已有玩家筹码和累计盈亏不会因设置修改而重置。
          </div>
          <Button
            className="h-11 w-full !bg-amber-400 font-black !text-neutral-950 hover:!bg-amber-300"
            onClick={() => {
              if (onSave()) setOpen(false);
            }}
          >
            保存设置
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PauseControl({ paused }: { paused: boolean }) {
  return (
    <Button
      size="sm"
      variant="outline"
      className={
        paused
          ? "h-7 border-emerald-400/50 text-emerald-300 hover:bg-emerald-500/10"
          : "h-7 border-amber-400/50 text-amber-300 hover:bg-amber-500/10"
      }
      onClick={() => poker.send({ t: "setPaused", paused: !paused })}
    >
      {paused ? "继续" : "暂停"}
    </Button>
  );
}

function ReturnToLobbyControl({ phase }: { phase: RoomState["phase"] }) {
  const [open, setOpen] = useState(false);
  const ready = phase === "showdown";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={!ready}
          title={
            ready ? "保留玩家、筹码和总结并返回大厅" : "本手结算后可返回大厅"
          }
          className="h-7 border-sky-300/35 bg-sky-400/10 px-2 text-sky-100 hover:bg-sky-400/15 disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-neutral-500 disabled:opacity-100"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          大厅
        </Button>
      </DialogTrigger>
      <DialogContent className="border-white/10 bg-neutral-950 text-white sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <RotateCcw className="h-5 w-5 text-sky-300" />
            返回房间大厅？
          </DialogTitle>
          <DialogDescription className="leading-6 text-neutral-400">
            所有玩家会回到同一个房间大厅，当前筹码、累计买入和牌局总结都会保留。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button
              variant="outline"
              className="border-white/15 bg-white/[0.04] text-neutral-200 hover:bg-white/10 hover:text-white"
            >
              取消
            </Button>
          </DialogClose>
          <Button
            className="bg-sky-500 font-bold text-white hover:bg-sky-400"
            onClick={() => {
              poker.send({ t: "returnToLobby" });
              setOpen(false);
            }}
          >
            确认返回
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  isMobile,
}: {
  state: RoomState;
  playerId: string;
  pending?: RebuyRequest;
  approved?: RebuyRequest;
  isMobile: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<BuyInMode>("oneHand");
  const [customAmount, setCustomAmount] = useState(String(state.buyInAmount));

  if (pending) {
    const pendingTarget =
      pending.targetChips != null
        ? `目标 ${pending.targetChips.toLocaleString()}，`
        : "";
    return (
      <div
        className="flex max-w-full flex-wrap items-center justify-center gap-1.5"
        title={`买入申请已发送（${pendingTarget}补充 ${pending.amount.toLocaleString()}），等待房主审批`}
      >
        <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
          等待审批 · 补 {pending.amount.toLocaleString()}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-8 rounded-full border-white/15 bg-black/35 px-3 text-xs text-neutral-300 hover:bg-white/10"
          onClick={() => poker.send({ t: "rebuyCancel" })}
        >
          取消
        </Button>
      </div>
    );
  }
  if (approved) {
    const approvedAmount = approved.approvedAmount ?? approved.amount;
    const approvedTarget =
      approved.targetChips != null
        ? `目标 ${approved.targetChips.toLocaleString()}，`
        : "";
    return (
      <span
        className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200"
        title={`买入已批准（${approvedTarget}预计补充 ${approvedAmount.toLocaleString()}），将在下一手结算`}
      >
        已批准 ·{" "}
        {approved.approvedAmount != null
          ? `补 ${approvedAmount.toLocaleString()}`
          : approved.targetChips != null
          ? `目标 ${approved.targetChips.toLocaleString()}`
          : `补 ${approvedAmount.toLocaleString()}`}
      </span>
    );
  }

  const me = state.players.find((player) => player.id === playerId);
  if (!me) return null;
  const stacks = state.players.map((player) => player.chips);
  const averageStack =
    state.buyInTargets?.average ??
    (stacks.length
      ? Math.floor(stacks.reduce((sum, chips) => sum + chips, 0) / stacks.length)
      : state.buyInAmount);
  const leaderStack =
    state.buyInTargets?.leader ??
    state.players.reduce(
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
  const selectedTarget =
    mode === "average"
      ? averageStack
      : mode === "leader"
        ? leaderStack
        : undefined;
  const minimumAmount =
    mode === "average" || mode === "leader" ? 1 : 100;
  const validAmount =
    Number.isInteger(selectedAmount) && selectedAmount >= minimumAmount;

  const submit = () => {
    if (!validAmount) return;
    poker.send({
      t: "rebuy",
      mode,
      amount: mode === "custom" ? selectedAmount : undefined,
    });
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-8 rounded-full border-emerald-400/30 bg-black/35 px-3 text-xs font-medium text-emerald-200 hover:bg-emerald-500/10 hover:text-emerald-100"
          aria-label="申请买入"
        >
          <Coins className="mr-1.5 h-3.5 w-3.5" />
          {me.chips <= 0 ? "选择买入" : "买入"}
        </Button>
      </SheetTrigger>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className="max-h-[80dvh] overflow-y-auto border-white/10 bg-neutral-950 pb-[max(1rem,env(safe-area-inset-bottom))] text-white sm:max-w-md"
      >
        <SheetHeader className="pb-0 text-left">
          <SheetTitle className="text-white">申请买入</SheetTitle>
          <SheetDescription className="text-neutral-400">
            选择补充方式；房主通过后，筹码将在下一手到账。
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4">
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(BUY_IN_MODE_LABEL) as BuyInMode[]).map((option) => (
              <button
                key={option}
                type="button"
                className={
                  "rounded-xl border px-3 py-2.5 text-left transition-colors " +
                  (mode === option
                    ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
                    : "border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10")
                }
                onClick={() => setMode(option)}
              >
                <div className="text-sm font-bold">
                  {BUY_IN_MODE_LABEL[option]}
                </div>
                <div className="mt-0.5 text-xs text-neutral-400">
                  {option === "custom"
                    ? "输入补充值"
                    : option === "average"
                      ? `目标 ${averageStack.toLocaleString()} · ${selectedAmountForMode(amounts[option])}`
                      : option === "leader"
                        ? `${state.buyInTargets?.leaderName ?? "领先玩家"} ${leaderStack.toLocaleString()} · ${selectedAmountForMode(amounts[option])}`
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
              className="h-10 border-white/15 bg-white/5 text-white"
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
            <span className="text-sm leading-6 text-neutral-400">
              {selectedTarget != null && (
                <>
                  当前 {me.chips.toLocaleString()} → 目标{" "}
                  <b className="text-white">{selectedTarget.toLocaleString()}</b>
                  <br />
                </>
              )}
              需补筹码：
              <b
                className={
                  validAmount ? "text-emerald-300" : "text-red-300"
                }
              >
                {Number.isFinite(selectedAmount)
                  ? selectedAmount.toLocaleString()
                  : "无效金额"}
              </b>
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-white/15 text-neutral-300 hover:bg-white/10"
                onClick={() => setOpen(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                disabled={!validAmount}
                className="bg-emerald-600 font-bold hover:bg-emerald-700"
                onClick={submit}
              >
                提交申请
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function selectedAmountForMode(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return "当前无需补充";
  return `+${amount.toLocaleString()}`;
}

/* ---------- 快捷表情 ---------- */
function QuickEmotes({
  players,
  meId,
  isMobile,
  open,
  onOpenChange,
  selectedTargetId,
  onTargetChange,
}: {
  players: PublicPlayer[];
  meId: string;
  isMobile: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedTargetId: string | null;
  onTargetChange: (playerId: string | null) => void;
}) {
  const choices = ["💩", "😂", "👍", "🔥", "😈", "🤡"];
  const targets = players.filter(
    (player) => player.id !== meId && player.connected,
  );
  const targetId = targets.some((player) => player.id === selectedTargetId)
    ? selectedTargetId!
    : (targets[0]?.id ?? "");
  const target = targets.find((player) => player.id === targetId);
  const targetLabel = target
    ? `${target.name}（座位 ${target.seat + 1}）`
    : "目标玩家";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={!targets.length}
          className="h-8 rounded-full border-white/15 bg-black/35 px-3 text-xs text-neutral-300 hover:bg-white/10 hover:text-white"
          title={targets.length ? "选择玩家并丢表情" : "暂无可选目标"}
        >
          <SmilePlus className="mr-1.5 h-3.5 w-3.5" />
          表情
        </Button>
      </SheetTrigger>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className="max-h-[80dvh] overflow-y-auto border-white/10 bg-neutral-950 pb-[max(1rem,env(safe-area-inset-bottom))] text-white sm:max-w-md"
      >
        <SheetHeader className="pb-0 text-left">
          <SheetTitle className="text-white">向玩家丢表情</SheetTitle>
          <SheetDescription className="text-neutral-400">
            所有人都能看到，表情会出现在目标玩家的座位上。
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4">
          <div>
            <div className="mb-2 text-xs font-medium text-neutral-400">
              选择目标
            </div>
            <div className="grid grid-cols-2 gap-2">
            {targets.map((player) => (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => onTargetChange(player.id)}
                  className={
                    "truncate rounded-xl border px-3 py-2.5 text-left text-sm transition-colors " +
                    (player.id === targetId
                      ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
                      : "border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10")
                  }
                >
                  <span className="block truncate">{player.name}</span>
                  <span className="mt-0.5 block text-[10px] text-neutral-500">
                    座位 {player.seat + 1}
                  </span>
                </button>
            ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-medium text-neutral-400">
              丢给 {targetLabel}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {choices.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  title={
                    target ? `向 ${targetLabel} 丢 ${emoji}` : "请先选择目标"
                  }
                  aria-label={
                    target ? `向 ${targetLabel} 丢 ${emoji}` : "请先选择目标"
                  }
                  disabled={!targetId}
                  className="rounded-xl border border-white/10 bg-white/5 py-3 text-3xl transition-all hover:scale-105 hover:border-emerald-400/40 hover:bg-emerald-500/10 active:scale-95 disabled:cursor-not-allowed disabled:opacity-35"
                  onClick={() => {
                    poker.send({
                      t: "emote",
                      emoji,
                      targetPlayerId: targetId,
                    });
                    onOpenChange(false);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ---------- 文字聊天 ---------- */
const QUICK_CHAT_PHRASES = ["跟注", "看牌", "我弃牌", "等一下", "Nice", "GG"];

function QuickChat({ messages }: { messages: ChatMessage[] }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const send = (text: string) => {
    const value = text.trim();
    if (!value) return;
    poker.send({ t: "chat", text: value });
    setDraft("");
  };

  if (!open) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-8 rounded-full border-white/15 bg-black/35 px-4 text-xs text-neutral-300 hover:bg-white/10"
        onClick={() => setOpen(true)}
      >
        聊天
      </Button>
    );
  }

  return (
    <div className="basis-full rounded-xl border border-white/10 bg-black/60 p-2">
      <div className="mb-2 flex max-h-28 flex-col gap-1 overflow-y-auto px-1 text-left text-xs">
        {messages.length ? (
          messages.slice(-8).map((message) => (
            <div key={message.id} className="truncate text-neutral-300">
              <b className="text-emerald-300">{message.name}</b>
              <span className="mx-1 text-neutral-600">:</span>
              {message.text}
            </div>
          ))
        ) : (
          <span className="text-neutral-500">还没有聊天消息</span>
        )}
      </div>
      <div className="mb-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {QUICK_CHAT_PHRASES.map((phrase) => (
          <button
            key={phrase}
            type="button"
            className="rounded-md border border-white/10 bg-white/5 px-1.5 py-1 text-[11px] text-neutral-300 hover:bg-white/10"
            onClick={() => send(phrase)}
          >
            {phrase}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5">
        <Input
          value={draft}
          maxLength={120}
          placeholder="输入消息…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") send(draft);
          }}
          className="h-8 border-white/15 bg-white/5 text-xs text-white"
        />
        <Button
          size="sm"
          className="h-8 bg-emerald-600 px-3 text-xs font-bold hover:bg-emerald-700"
          onClick={() => send(draft)}
        >
          发送
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-xs text-neutral-400 hover:bg-white/10 hover:text-white"
          onClick={() => setOpen(false)}
        >
          收起
        </Button>
      </div>
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
function RebuyApprovals({
  state,
  isMobile,
}: {
  state: RoomState;
  isMobile: boolean;
}) {
  if (!state.rebuyRequests.length) return null;
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-8 rounded-full border-amber-400/30 bg-amber-500/10 px-3 text-xs text-amber-200 hover:bg-amber-500/20 hover:text-amber-100"
        >
          <Coins className="mr-1.5 h-3.5 w-3.5" />
          审批 {state.rebuyRequests.length}
        </Button>
      </SheetTrigger>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className="max-h-[80dvh] overflow-y-auto border-white/10 bg-neutral-950 pb-[max(1rem,env(safe-area-inset-bottom))] text-white sm:max-w-md"
      >
        <SheetHeader className="pb-0 text-left">
          <SheetTitle className="text-white">买入审批</SheetTitle>
          <SheetDescription className="text-neutral-400">
            核对申请目标和补充值；如有需要，可修改最终补充值。
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-2 px-4">
          {state.rebuyRequests.map((request) => (
            <RebuyApprovalRow key={request.playerId} request={request} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function RebuyApprovalRow({ request }: { request: RebuyRequest }) {
  const [value, setValue] = useState(String(request.amount));
  const amount = Number(value);
  const minimumAmount =
    request.mode === "average" || request.mode === "leader" ? 1 : 100;
  const valid =
    Number.isInteger(amount) &&
    amount >= minimumAmount &&
    amount <= 1_000_000;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-500/15 px-3 py-2 animate-card-in">
      <Coins className="w-4 h-4 text-amber-300 shrink-0" />
      <span className="min-w-0 flex-1 text-sm">
        <b className="text-amber-200">{request.name}</b>
        <span className="ml-1 text-neutral-300">
          申请{BUY_IN_MODE_LABEL[request.mode]}
          {request.mode === "leader" &&
            request.basisName &&
            `（${request.basisName}）`}
          {request.targetChips != null &&
            `到 ${request.targetChips.toLocaleString()}`}{" "}
          · 补 {request.amount.toLocaleString()}
        </span>
      </span>
      <Input
        type="number"
        min={minimumAmount}
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
