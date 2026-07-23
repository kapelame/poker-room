import type { EmoteEvent, PublicPlayer } from "@contracts/game";
import { cn } from "@/lib/utils";
import { PlayingCard } from "./PlayingCard";
import { Crown, WifiOff } from "lucide-react";

interface Props {
  player: PublicPlayer;
  isMe: boolean;
  isTurn: boolean;
  phase: string;
  /** 仅我自己的实时胜率（0-100） */
  equity?: number;
  emotes?: EmoteEvent[];
}

/** 胜率颜色：低红 / 中琥珀 / 高绿 */
function equityColor(v: number) {
  if (v >= 60) return "text-emerald-300";
  if (v >= 35) return "text-amber-300";
  return "text-red-400";
}

function equityBar(v: number) {
  if (v >= 60) return "bg-emerald-400";
  if (v >= 35) return "bg-amber-400";
  return "bg-red-400";
}

/** 牌桌座位 */
export function Seat({
  player,
  isMe,
  isTurn,
  phase,
  equity,
  emotes = [],
}: Props) {
  const p = player;
  const inPlay = phase !== "waiting";
  const showCards = inPlay && p.inHand;
  const dimmed = p.folded || !p.connected;
  const showEquity = isMe && equity != null && inPlay && p.inHand && !p.folded;

  return (
    <div
      className={cn(
        "relative flex flex-col items-center gap-1 overflow-visible transition-all duration-300",
        dimmed && "opacity-50",
      )}
    >
      {emotes.length > 0 && (
        <div className="pointer-events-none absolute -top-16 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-0.5">
          {emotes.slice(-3).map((event, index) => (
            <span
              key={event.id}
              className="animate-emote rounded-full border border-white/20 bg-black/70 px-2 py-1 text-2xl shadow-lg"
              style={{ animationDelay: `${index * 60}ms` }}
            >
              {event.emoji}
            </span>
          ))}
        </div>
      )}
      {/* 手牌 */}
      <div className="flex min-h-14 items-end gap-1 overflow-visible">
        {showCards &&
          (p.hole
            ? p.hole.map((c, i) =>
                c ? (
                  <PlayingCard
                    key={i}
                    card={c}
                    size={isMe ? "md" : "sm"}
                    delay={i * 120}
                  />
                ) : (
                  <PlayingCard key={i} hidden size="sm" />
                ),
              )
            : !p.folded && (
                <>
                  <PlayingCard hidden size="sm" />
                  <PlayingCard hidden size="sm" delay={120} />
                </>
              ))}
      </div>

      {/* 信息牌 */}
      <div
        className={cn(
          "relative px-3 py-1.5 rounded-xl border backdrop-blur-sm min-w-[92px] text-center transition-all duration-200",
          isMe
            ? "bg-amber-500/20 border-amber-400/60"
            : "bg-black/45 border-white/15",
          isTurn &&
            "ring-2 ring-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.7)] scale-105",
          p.isWinner &&
            "ring-2 ring-yellow-400 shadow-[0_0_22px_rgba(250,204,21,0.8)]",
        )}
      >
        {p.isDealer && (
          <span className="absolute -top-2 -left-2 w-5 h-5 rounded-full bg-white text-black text-[10px] font-bold flex items-center justify-center shadow">
            D
          </span>
        )}
        {p.isHost && (
          <Crown className="absolute -top-2.5 -right-2 w-4 h-4 text-yellow-400" />
        )}
        <div className="text-[13px] font-medium text-white leading-tight max-w-[110px] truncate">
          {p.name}
          {!p.connected && (
            <WifiOff className="inline w-3 h-3 ml-1 text-red-400" />
          )}
        </div>
        <div className="text-[12px] text-amber-300 font-semibold leading-tight">
          {p.chips.toLocaleString()}
        </div>
        {showEquity && (
          <div className="mt-0.5" title="基于当前手牌与公共牌的实时胜率估算">
            <div
              className={cn(
                "text-[11px] font-bold leading-tight",
                equityColor(equity!),
              )}
            >
              胜率 {equity!.toFixed(1)}%
            </div>
            <div className="mt-0.5 h-1 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  equityBar(equity!),
                )}
                style={{ width: `${Math.min(100, Math.max(2, equity!))}%` }}
              />
            </div>
          </div>
        )}
        {p.lastAction && inPlay && (
          <div className="text-[11px] text-emerald-300 leading-tight">
            {p.lastAction}
          </div>
        )}
        {p.handName && (
          <div className="text-[11px] text-yellow-300 font-bold leading-tight">
            {p.handName}
          </div>
        )}
        {p.winAmount != null && p.winAmount > 0 && (
          <div className="text-[12px] text-yellow-300 font-bold leading-tight">
            +{p.winAmount.toLocaleString()}
          </div>
        )}
      </div>
    </div>
  );
}
