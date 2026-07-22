import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { PlayingCard } from "@/components/poker/PlayingCard";
import {
  applyResult,
  genScenario,
  grade,
  loadStats,
  saveStats,
  type GradeResult,
  type Scenario,
} from "@/lib/gto/scenario";
import { POS_SHORT } from "@/lib/gto/ranges";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  CheckCircle2,
  Flame,
  GraduationCap,
  RotateCcw,
  Target,
  Trophy,
  XCircle,
} from "lucide-react";

const KIND_LABEL: Record<string, string> = {
  rfi: "翻牌前 · 率先开局",
  vsRaise: "翻牌前 · 面对加注",
  postflop: "翻牌后 · 面对下注",
  cbet: "翻牌后 · 持续下注",
  vsAllIn: "翻牌前 · 面对全下",
};

const VILLAIN_LABEL: Record<string, string> = {
  vsRaise: "加注者",
  postflop: "下注者",
  cbet: "跟注者",
  vsAllIn: "全下者",
};

export default function Practice() {
  const nav = useNavigate();
  const [stats, setStats] = useState(loadStats);
  const [scenario, setScenario] = useState<Scenario>(() => genScenario());
  const [picked, setPicked] = useState<string | null>(null);
  const [result, setResult] = useState<GradeResult | null>(null);

  const accuracy = useMemo(
    () =>
      stats.answered > 0
        ? Math.round((stats.correct / stats.answered) * 100)
        : 0,
    [stats],
  );

  const answer = (optionId: string) => {
    if (result) return; // 已作答
    const g = grade(scenario, optionId);
    const next = applyResult(stats, g);
    setStats(next);
    saveStats(next);
    setPicked(optionId);
    setResult(g);
  };

  const nextQuestion = () => {
    // 避免与上一题同类型同位置，保证无限题目的新鲜感
    setScenario(
      genScenario({ kind: scenario.kind, heroPos: scenario.heroPos }),
    );
    setPicked(null);
    setResult(null);
  };

  const resetStats = () => {
    const fresh = { score: 0, answered: 0, correct: 0, streak: 0, bestStreak: 0 };
    setStats(fresh);
    saveStats(fresh);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,#1e1b4b_0%,#0f172a_45%,#020617_100%)] text-white flex flex-col">
      {/* 顶栏 */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-black/50 border-b border-white/10">
        <button
          onClick={() => nav("/")}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-white/15 text-neutral-300 hover:bg-white/10"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> 返回
        </button>
        <div className="flex items-center gap-2">
          <GraduationCap className="w-5 h-5 text-indigo-400" />
          <span className="font-bold">GTO 练习模式</span>
        </div>
        <div className="flex-1" />
        <button
          onClick={resetStats}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-white/15 text-neutral-400 hover:bg-white/10"
          title="清空积分"
        >
          <RotateCcw className="w-3.5 h-3.5" /> 重置
        </button>
      </div>

      {/* 积分面板 */}
      <div className="flex items-center justify-center gap-6 md:gap-10 py-4 text-center">
        <Stat icon={<Trophy className="w-4 h-4 text-amber-400" />} label="积分" value={stats.score} />
        <Stat
          icon={<Flame className="w-4 h-4 text-orange-400" />}
          label="连击"
          value={stats.streak}
          highlight={stats.streak >= 3}
        />
        <Stat icon={<Target className="w-4 h-4 text-emerald-400" />} label="正确率" value={`${accuracy}%`} />
        <Stat icon={<CheckCircle2 className="w-4 h-4 text-sky-400" />} label="已答题" value={stats.answered} />
      </div>

      {/* 场景卡片 */}
      <div className="flex-1 flex flex-col items-center px-4 pb-10">
        <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-black/40 backdrop-blur p-6 space-y-5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-400/40 text-indigo-300 font-semibold">
              {KIND_LABEL[scenario.kind]}
            </span>
          </div>

          <div>
            <div className="text-lg font-bold">{scenario.title}</div>
            <div className="text-sm text-neutral-400 mt-0.5">{scenario.detail}</div>
          </div>

          {/* 牌桌信息：你的位置 / 后手 / 对手数量与位置 / 身后未行动 */}
          <div className="flex flex-wrap gap-1.5">
            <InfoChip highlight>你 · {POS_SHORT[scenario.heroPos]}</InfoChip>
            <InfoChip accent2>后手 · {scenario.stackBb}bb</InfoChip>
            <InfoChip>
              对手 × {scenario.opponents}
            </InfoChip>
            {scenario.villainPos && (
              <InfoChip accent>
                {VILLAIN_LABEL[scenario.kind] ?? "对手"} ·{" "}
                {POS_SHORT[scenario.villainPos]}
              </InfoChip>
            )}
            {scenario.playersBehind > 0 && (
              <InfoChip>身后 {scenario.playersBehind} 人未行动</InfoChip>
            )}
          </div>

          {/* 手牌与公共牌 */}
          <div className="space-y-3">
            <div>
              <div className="text-xs text-neutral-500 mb-1.5">你的手牌</div>
              <div className="flex gap-2">
                {scenario.hole.map((c, i) => (
                  <PlayingCard key={i} card={c} size="lg" delay={i * 120} />
                ))}
              </div>
            </div>
            {scenario.board.length > 0 && (
              <div>
                <div className="text-xs text-neutral-500 mb-1.5">公共牌</div>
                <div className="flex gap-1.5">
                  {scenario.board.map((c, i) => (
                    <PlayingCard key={i} card={c} size="md" delay={i * 80} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 选项 */}
          <div className="space-y-2">
            <div className="text-xs text-neutral-500">你的行动？</div>
            <div className="grid gap-2">
              {scenario.options.map((opt) => {
                const isCorrectOpt = result && opt.id === scenario.correctId;
                const isPicked = picked === opt.id;
                const isPartialOpt =
                  result && scenario.partialId === opt.id && !isCorrectOpt;
                return (
                  <button
                    key={opt.id}
                    disabled={!!result}
                    onClick={() => answer(opt.id)}
                    className={cn(
                      "w-full px-4 py-3 rounded-xl border font-bold text-left transition-all",
                      !result &&
                        "bg-white/5 border-white/15 hover:bg-indigo-500/20 hover:border-indigo-400/50 cursor-pointer",
                      result && isCorrectOpt &&
                        "bg-emerald-500/20 border-emerald-400/60 text-emerald-300",
                      result && isPicked && !isCorrectOpt && !isPartialOpt &&
                        "bg-red-500/15 border-red-400/50 text-red-300",
                      result && isPartialOpt &&
                        "bg-amber-500/15 border-amber-400/50 text-amber-300",
                      result && !isCorrectOpt && !isPicked && !isPartialOpt &&
                        "bg-white/5 border-white/10 text-neutral-500",
                    )}
                  >
                    <span className="flex items-center justify-between">
                      {opt.label}
                      {result && isCorrectOpt && (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      )}
                      {result && isPicked && !isCorrectOpt && !isPartialOpt && (
                        <XCircle className="w-5 h-5 text-red-400" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 反馈 */}
          {result && (
            <div
              className={cn(
                "rounded-xl border p-4 animate-card-in",
                result.isCorrect
                  ? "bg-emerald-500/10 border-emerald-400/40"
                  : result.isPartial
                    ? "bg-amber-500/10 border-amber-400/40"
                    : "bg-red-500/10 border-red-400/40",
              )}
            >
              <div
                className={cn(
                  "font-black text-lg mb-1",
                  result.isCorrect
                    ? "text-emerald-300"
                    : result.isPartial
                      ? "text-amber-300"
                      : "text-red-300",
                )}
              >
                {result.isCorrect
                  ? `✓ 正确 +${result.score} 分`
                  : result.isPartial
                    ? `◐ 边缘决策 +${result.score} 分`
                    : "✗ 错误"}
                {stats.streak >= 3 && result.isCorrect && (
                  <span className="ml-2 text-orange-400 text-sm">
                    🔥 {stats.streak} 连击
                  </span>
                )}
              </div>
              <p className="text-sm text-neutral-300 leading-relaxed">
                {scenario.explanation}
              </p>
              <Button
                className="w-full mt-4 bg-indigo-500 hover:bg-indigo-600 font-bold"
                onClick={nextQuestion}
                autoFocus
              >
                下一题
              </Button>
            </div>
          )}
        </div>

        <p className="mt-6 text-xs text-neutral-500 text-center max-w-lg">
          评分依据：翻牌前采用公开求解器范围表（6-max 100bb，取主频率动作）；
          翻牌后按对手位置范围做胜率蒙特卡洛模拟，结合底池赔率判定 EV ·
          答对 +10，边缘决策 +5，每 3 连击额外 +5
        </p>
      </div>
    </div>
  );
}

function InfoChip({
  children,
  highlight,
  accent,
  accent2,
}: {
  children: React.ReactNode;
  highlight?: boolean;
  accent?: boolean;
  accent2?: boolean;
}) {
  return (
    <span
      className={cn(
        "text-[11px] px-2 py-1 rounded-full border font-semibold",
        highlight
          ? "bg-emerald-500/15 border-emerald-400/50 text-emerald-300"
          : accent
            ? "bg-amber-500/15 border-amber-400/50 text-amber-300"
            : accent2
              ? "bg-sky-500/15 border-sky-400/50 text-sky-300"
              : "bg-white/5 border-white/15 text-neutral-300",
      )}
    >
      {children}
    </span>
  );
}

function Stat({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex items-center gap-1 text-[11px] text-neutral-400">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "text-xl font-black",
          highlight ? "text-orange-400" : "text-white",
        )}
      >
        {value}
      </div>
    </div>
  );
}
