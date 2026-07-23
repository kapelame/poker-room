import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";

/** 牌局日志 */
export function LogPanel({ log }: { log: string[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log.length]);
  return (
    <ScrollArea className="h-full">
      <div className="space-y-1.5 p-3 text-[13px] leading-5">
        {log.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/10 px-3 py-8 text-center text-neutral-500">
            开局后的动作和总结会记录在这里
          </div>
        )}
        {log.map((line, i) => (
          <div
            key={i}
            className={
              line.startsWith("——")
                ? "mt-2 rounded-lg border border-amber-300/15 bg-amber-300/[0.06] px-2.5 py-1.5 font-semibold text-amber-200"
                : line.startsWith("本手盈亏：") ||
                    line.startsWith("牌桌总结：")
                  ? "rounded-lg border border-emerald-300/10 bg-emerald-300/[0.06] px-2.5 py-1.5 text-emerald-100"
                  : "rounded-md px-2 py-0.5 text-neutral-300 odd:bg-white/[0.025]"
            }
          >
            {line}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}
