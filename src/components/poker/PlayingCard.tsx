import type { Card } from "@contracts/game";
import { cn } from "@/lib/utils";

const RANKS = "23456789TJQKA";
const SUITS: Record<Card["s"], string> = {
  s: "♠",
  h: "♥",
  d: "♦",
  c: "♣",
};

interface Props {
  card?: Card | null;
  hidden?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
  delay?: number;
}

/** 扑克牌组件：hidden 显示牌背 */
export function PlayingCard({ card, hidden, size = "md", className, delay = 0 }: Props) {
  const sizeCls =
    size === "sm"
      ? "w-8 h-11 text-sm rounded-[5px]"
      : size === "lg"
        ? "w-14 h-20 text-2xl rounded-lg"
        : "w-10 h-14 text-base rounded-md";

  if (hidden || !card) {
    return (
      <div
        className={cn(
          "relative shrink-0 border border-white/25 shadow-md animate-card-in",
          sizeCls,
          className,
        )}
        style={{
          animationDelay: `${delay}ms`,
          background:
            "repeating-linear-gradient(45deg,#7f1d1d 0 4px,#991b1b 4px 8px)",
        }}
      >
        <div className="absolute inset-[3px] rounded-[4px] border border-white/30" />
      </div>
    );
  }

  const red = card.s === "h" || card.s === "d";
  return (
    <div
      className={cn(
        "relative shrink-0 bg-white shadow-md border border-black/10 select-none animate-card-in",
        sizeCls,
        className,
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div
        className={cn(
          "absolute top-[2px] left-[4px] font-bold leading-none",
          red ? "text-red-600" : "text-neutral-900",
        )}
      >
        {RANKS[card.r - 2]}
      </div>
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center pt-1",
          red ? "text-red-600" : "text-neutral-900",
          size === "sm" ? "text-lg" : size === "lg" ? "text-3xl" : "text-xl",
        )}
      >
        {SUITS[card.s]}
      </div>
    </div>
  );
}
