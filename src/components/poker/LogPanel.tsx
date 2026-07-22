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
      <div className="p-3 space-y-1 text-[13px]">
        {log.map((line, i) => (
          <div
            key={i}
            className={
              line.startsWith("——")
                ? "text-amber-300 font-semibold pt-1"
                : "text-neutral-300"
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
