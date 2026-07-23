import { useMemo, useState } from "react";
import type { PublicPlayer, RoomState } from "@contracts/game";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { poker } from "@/hooks/usePoker";
import { cn } from "@/lib/utils";

interface Props {
  state: RoomState;
  me: PublicPlayer;
  secondsRemaining?: number;
}

/** 底部操作栏：弃牌 / 看牌 / 跟注 / 加注 / 全下 */
export function ActionBar({ state, me, secondsRemaining }: Props) {
  const [raising, setRaising] = useState(false);
  const [target, setTarget] = useState(0);

  const toCall = state.currentBet - me.bet;
  const maxBet = me.bet + me.chips;
  const minTarget = Math.min(state.currentBet + state.minRaise, maxBet);
  const canRaise = maxBet > state.currentBet && me.chips > toCall;

  const presets = useMemo(() => {
    const list: { label: string; value: number }[] = [];
    list.push({ label: "最小", value: minTarget });
    const potAfterCall = state.pot + toCall;
    const half = me.bet + toCall + Math.round(potAfterCall / 2);
    const full = me.bet + toCall + potAfterCall;
    if (half > minTarget && half < maxBet)
      list.push({ label: "1/2 池", value: Math.min(half, maxBet) });
    if (full > minTarget && full < maxBet)
      list.push({ label: "满池", value: Math.min(full, maxBet) });
    list.push({ label: "全下", value: maxBet });
    // 去重
    return list.filter(
      (v, i, a) => a.findIndex((x) => x.value === v.value) === i,
    );
  }, [minTarget, maxBet, state.pot, toCall, me.bet]);

  const openRaise = () => {
    setTarget(minTarget);
    setRaising(true);
  };

  const confirmRaise = () => {
    poker.send({
      t: "action",
      action: target >= maxBet ? "allin" : "raise",
      amount: target,
    });
    setRaising(false);
  };

  if (raising) {
    return (
      <div className="w-full max-w-xl mx-auto rounded-2xl border border-white/15 bg-neutral-900/95 backdrop-blur p-4 shadow-2xl">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm text-neutral-400">
            {toCall > 0 ? "加注到" : "下注"}
          </span>
          <div className="flex items-center gap-3">
            {secondsRemaining != null && (
              <span className="text-sm font-bold text-red-300">
                {secondsRemaining}s
              </span>
            )}
            {me.timeBankRemaining > 0 && (
              <span className="text-xs text-amber-300">
                银行 {me.timeBankRemaining}s
              </span>
            )}
            <span className="text-2xl font-bold text-amber-400">
              {target.toLocaleString()}
            </span>
          </div>
        </div>
        <Slider
          value={[target]}
          min={minTarget}
          max={maxBet}
          step={Math.max(1, Math.floor(state.sb))}
          onValueChange={([v]) => setTarget(v)}
          className="my-4"
        />
        <div className="flex flex-wrap gap-2 mb-3">
          {presets.map((p) => (
            <button
              key={p.label}
              onClick={() => setTarget(p.value)}
              className={cn(
                "px-3 py-1 rounded-full text-xs border transition-colors",
                target === p.value
                  ? "bg-amber-500/30 border-amber-400 text-amber-200"
                  : "border-white/15 text-neutral-300 hover:bg-white/10",
              )}
            >
              {p.label} {p.value.toLocaleString()}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 border-white/20 text-neutral-300"
            onClick={() => setRaising(false)}
          >
            返回
          </Button>
          <Button
            className="flex-1 bg-amber-500 hover:bg-amber-600 text-black font-bold"
            onClick={confirmRaise}
          >
            {target >= maxBet ? "全下" : toCall > 0 ? "加注" : "下注"}{" "}
            {target.toLocaleString()}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl mx-auto flex gap-2">
      {(secondsRemaining != null || me.timeBankRemaining > 0) && (
        <div className="absolute -mt-7 right-4 flex gap-2 text-xs font-bold">
          {secondsRemaining != null && (
            <span className="text-red-300">剩余 {secondsRemaining} 秒</span>
          )}
          {me.timeBankRemaining > 0 && (
            <span className="text-amber-300">
              银行 {me.timeBankRemaining} 秒
            </span>
          )}
        </div>
      )}
      <Button
        variant="outline"
        className="flex-1 h-12 border-red-500/50 text-red-400 hover:bg-red-500/15 hover:text-red-300 font-bold"
        onClick={() => poker.send({ t: "action", action: "fold" })}
      >
        弃牌
      </Button>
      <Button
        variant="outline"
        className="flex-1 h-12 border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/15 hover:text-emerald-300 font-bold"
        onClick={() =>
          poker.send({ t: "action", action: toCall > 0 ? "call" : "check" })
        }
      >
        {toCall > 0
          ? me.chips <= toCall
            ? `全下跟注 ${me.chips.toLocaleString()}`
            : `跟注 ${toCall.toLocaleString()}`
          : "看牌"}
      </Button>
      {canRaise && (
        <Button
          className="flex-1 h-12 bg-amber-500 hover:bg-amber-600 text-black font-bold"
          onClick={openRaise}
        >
          {toCall > 0 ? "加注" : "下注"}
        </Button>
      )}
    </div>
  );
}
