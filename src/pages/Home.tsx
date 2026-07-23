import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { poker, usePoker } from "@/hooks/usePoker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertCircle,
  ChevronDown,
  GraduationCap,
  LoaderCircle,
  LogIn,
  Plus,
  Settings2,
  Spade,
  Users,
} from "lucide-react";

export default function Home() {
  const nav = useNavigate();
  const { joined, roomCode, kicked, lastError, requesting } = usePoker();
  const createNameInput = useRef<HTMLInputElement>(null);
  const joinNameInput = useRef<HTMLInputElement>(null);
  const roomCodeInput = useRef<HTMLInputElement>(null);
  const [createName, setCreateName] = useState(() => poker.savedName);
  const [joinName, setJoinName] = useState(() => poker.savedName);
  const [code, setCode] = useState("");
  const [showAdv, setShowAdv] = useState(false);
  const [startingChips, setStartingChips] = useState("1000");
  const [buyInAmount, setBuyInAmount] = useState("1000");
  const [sb, setSb] = useState("5");
  const [bb, setBb] = useState("10");
  const [decisionTimeSec, setDecisionTimeSec] = useState("30");
  const [timeBankSec, setTimeBankSec] = useState("30");
  const [createError, setCreateError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    poker.connect();
  }, []);

  useEffect(() => {
    if (joined && roomCode) nav(`/room/${roomCode}`);
  }, [joined, roomCode, nav]);

  const validCreateName = createName.trim().length > 0;
  const validJoinName = joinName.trim().length > 0;
  const inputClass =
    "h-11 border-white/15 bg-white/[0.06] text-white placeholder:text-neutral-500 [color-scheme:dark] focus-visible:border-amber-400/70 focus-visible:ring-amber-400/20";

  const create = () => {
    if (requesting) return;
    if (!validCreateName) {
      setCreateError("请先输入昵称，再创建房间");
      createNameInput.current?.focus();
      return;
    }
    const chips = Number(startingChips);
    const oneHandBuyIn = Number(buyInAmount);
    const smallBlind = Number(sb);
    const bigBlind = Number(bb);
    const decisionTime = Number(decisionTimeSec);
    const timeBank = Number(timeBankSec);
    if (
      !Number.isInteger(chips) ||
      !Number.isInteger(oneHandBuyIn) ||
      !Number.isInteger(smallBlind) ||
      !Number.isInteger(bigBlind) ||
      !Number.isInteger(decisionTime) ||
      !Number.isInteger(timeBank) ||
      chips < 100 ||
      oneHandBuyIn < 100 ||
      smallBlind < 1 ||
      bigBlind <= smallBlind ||
      chips < bigBlind * 10 ||
      oneHandBuyIn < bigBlind * 10 ||
      decisionTime < 5 ||
      timeBank < 0 ||
      timeBank > 300
    ) {
      setCreateError(
        "请检查筹码、盲注、决策时间和时间银行：时间银行需为 0-300 秒",
      );
      return;
    }
    setCreateError(null);
    poker.clearError();
    poker.savedName = createName.trim();
    poker.leaveLocal();
    poker.send({
      t: "create",
      name: createName.trim(),
      startingChips: chips,
      buyInAmount: oneHandBuyIn,
      sb: smallBlind,
      bb: bigBlind,
      decisionTimeSec: decisionTime,
      timeBankSec: timeBank,
    });
  };

  const join = () => {
    if (requesting) return;
    if (!validJoinName) {
      setJoinError("请先输入昵称");
      joinNameInput.current?.focus();
      return;
    }
    if (code.trim().length < 4) {
      setJoinError("请输入朋友分享的房间码");
      roomCodeInput.current?.focus();
      return;
    }
    setJoinError(null);
    poker.clearError();
    poker.savedName = joinName.trim();
    poker.leaveLocal();
    poker.send({
      t: "join",
      code: code.trim().toUpperCase(),
      name: joinName.trim(),
    });
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-[radial-gradient(ellipse_at_top,#065f46_0%,#022c22_42%,#01120e_100%)] px-4 py-8 text-white sm:py-12 lg:flex lg:flex-col lg:items-center lg:justify-center">
      <div className="mx-auto flex max-w-full items-center justify-center gap-2.5 sm:gap-3">
        <Spade className="h-8 w-8 shrink-0 text-amber-400 sm:h-10 sm:w-10" />
        <h1 className="text-center text-3xl font-black tracking-wide sm:text-4xl md:text-5xl">
          德州扑克之夜
        </h1>
      </div>
      <p className="mx-auto mb-7 mt-2 max-w-xl text-center text-sm leading-6 text-emerald-100/70 sm:mb-9 sm:text-base">
        创建房间，把链接发给朋友，马上开局 —— 无需注册
      </p>

      {kicked && (
        <div className="mx-auto mb-4 w-full max-w-5xl rounded-xl border border-red-400/35 bg-red-500/15 px-4 py-3 text-sm text-red-100">
          你已被房主移出上一个房间
          <button
            className="ml-2 underline"
            onClick={() => poker.clearKicked()}
          >
            知道了
          </button>
        </div>
      )}

      {lastError && (
        <div
          role="alert"
          className="mx-auto mb-4 flex w-full max-w-5xl items-start gap-2.5 rounded-xl border border-red-400/40 bg-red-950/70 px-4 py-3 text-sm text-red-100 shadow-lg"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
          <span className="flex-1">{lastError}</span>
          <button
            type="button"
            className="rounded-md px-2 py-0.5 text-red-200 hover:bg-red-400/10 hover:text-white"
            onClick={() => poker.clearError()}
          >
            关闭
          </button>
        </div>
      )}

      <div className="mx-auto grid w-full max-w-5xl gap-5 lg:grid-cols-[1.08fr_0.92fr]">
        {/* 创建房间 */}
        <Card className="gap-5 rounded-2xl border-white/10 bg-black/45 py-5 text-white shadow-[0_24px_70px_rgba(0,0,0,0.3)] backdrop-blur-xl sm:py-6">
          <CardHeader className="gap-2 px-5 sm:px-6">
            <CardTitle className="flex items-center gap-2 text-lg text-amber-300">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-400/10">
                <Plus className="h-5 w-5" />
              </span>
              创建房间
            </CardTitle>
            <CardDescription className="text-neutral-400">
              你是房主，生成房间码邀请朋友
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-5 sm:px-6">
            <div className="space-y-1.5">
              <Label htmlFor="create-name" className="text-neutral-200">
                你的昵称
              </Label>
              <Input
                ref={createNameInput}
                id="create-name"
                autoComplete="nickname"
                value={createName}
                onChange={(e) => {
                  setCreateName(e.target.value);
                  setCreateError(null);
                  poker.clearError();
                }}
                placeholder="例如：赌神"
                maxLength={16}
                className={inputClass}
              />
            </div>
            <button
              type="button"
              aria-expanded={showAdv}
              className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-left text-sm text-neutral-200 transition-colors hover:border-white/20 hover:bg-white/[0.08]"
              onClick={() => setShowAdv(!showAdv)}
            >
              <Settings2 className="h-4 w-4 text-amber-300" />
              <span className="flex-1">牌局设置</span>
              <span className="text-xs text-neutral-500">
                筹码 · 盲注 · 计时
              </span>
              <ChevronDown
                className={`h-4 w-4 text-neutral-400 transition-transform ${showAdv ? "rotate-180" : ""}`}
              />
            </button>
            {showAdv && (
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-white/10 bg-black/25 p-3 sm:p-4">
                <div className="space-y-1">
                  <Label htmlFor="starting-chips" className="text-xs text-neutral-300">
                    初始筹码
                  </Label>
                  <Input
                    id="starting-chips"
                    type="number"
                    value={startingChips}
                    min={100}
                    onChange={(e) => {
                      setStartingChips(e.target.value);
                      setCreateError(null);
                    }}
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="buy-in-amount" className="text-xs text-neutral-300">
                    一手买入
                  </Label>
                  <Input
                    id="buy-in-amount"
                    type="number"
                    value={buyInAmount}
                    min={100}
                    onChange={(e) => {
                      setBuyInAmount(e.target.value);
                      setCreateError(null);
                    }}
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="small-blind" className="text-xs text-neutral-300">
                    小盲
                  </Label>
                  <Input
                    id="small-blind"
                    type="number"
                    value={sb}
                    min={1}
                    onChange={(e) => {
                      setSb(e.target.value);
                      setCreateError(null);
                    }}
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="big-blind" className="text-xs text-neutral-300">
                    大盲
                  </Label>
                  <Input
                    id="big-blind"
                    type="number"
                    value={bb}
                    min={2}
                    onChange={(e) => {
                      setBb(e.target.value);
                      setCreateError(null);
                    }}
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="decision-seconds" className="text-xs text-neutral-300">
                    决策秒数
                  </Label>
                  <Input
                    id="decision-seconds"
                    type="number"
                    value={decisionTimeSec}
                    min={5}
                    max={300}
                    onChange={(e) => {
                      setDecisionTimeSec(e.target.value);
                      setCreateError(null);
                    }}
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="time-bank" className="text-xs text-neutral-300">
                    时间银行
                  </Label>
                  <Input
                    id="time-bank"
                    type="number"
                    value={timeBankSec}
                    min={0}
                    max={300}
                    onChange={(e) => {
                      setTimeBankSec(e.target.value);
                      setCreateError(null);
                    }}
                    className={inputClass}
                  />
                </div>
              </div>
            )}
            {createError && (
              <p className="text-sm text-red-400">{createError}</p>
            )}
            <Button
              type="button"
              onClick={create}
              disabled={requesting !== null}
              className="h-12 w-full rounded-xl !bg-amber-400 !text-neutral-950 font-black shadow-[0_10px_28px_rgba(251,191,36,0.24)] hover:!bg-amber-300 disabled:!bg-amber-300/70 disabled:!text-neutral-900 disabled:opacity-100"
              style={{ backgroundColor: "#fbbf24", color: "#171717" }}
            >
              {requesting === "create" ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  正在创建…
                </>
              ) : (
                "创建房间"
              )}
            </Button>
          </CardContent>
        </Card>

        {/* 加入房间 */}
        <Card className="gap-5 rounded-2xl border-white/10 bg-black/45 py-5 text-white shadow-[0_24px_70px_rgba(0,0,0,0.3)] backdrop-blur-xl sm:py-6">
          <CardHeader className="gap-2 px-5 sm:px-6">
            <CardTitle className="flex items-center gap-2 text-lg text-emerald-300">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-400/10">
                <Users className="h-5 w-5" />
              </span>
              加入房间
            </CardTitle>
            <CardDescription className="text-neutral-400">
              输入朋友分享的 6 位房间码
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-5 sm:px-6">
            <div className="space-y-1.5">
              <Label htmlFor="join-name" className="text-neutral-200">
                你的昵称
              </Label>
              <Input
                ref={joinNameInput}
                id="join-name"
                autoComplete="nickname"
                value={joinName}
                onChange={(e) => {
                  setJoinName(e.target.value);
                  setJoinError(null);
                  poker.clearError();
                }}
                placeholder="例如：小白"
                maxLength={16}
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="room-code" className="text-neutral-200">
                房间码
              </Label>
              <Input
                ref={roomCodeInput}
                id="room-code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setJoinError(null);
                  poker.clearError();
                }}
                placeholder="例如：K7P2XQ"
                maxLength={6}
                className={`${inputClass} h-14 text-center font-mono text-xl uppercase tracking-[0.28em] sm:text-2xl sm:tracking-[0.4em]`}
              />
            </div>
            {joinError && (
              <p className="text-sm text-red-300">{joinError}</p>
            )}
            <Button
              type="button"
              onClick={join}
              disabled={requesting !== null}
              className="h-12 w-full rounded-xl !bg-emerald-500 !text-white font-bold shadow-[0_10px_28px_rgba(16,185,129,0.2)] hover:!bg-emerald-400 disabled:!bg-emerald-400/70 disabled:!text-neutral-900 disabled:opacity-100"
              style={{ backgroundColor: "#10b981", color: "#ffffff" }}
            >
              {requesting === "join" ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  正在加入…
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" /> 加入房间
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* GTO 练习模式入口 */}
      <div className="mx-auto mt-6 flex w-full max-w-5xl justify-center">
        <Button
          type="button"
          variant="outline"
          onClick={() => nav("/practice")}
          className="h-auto min-h-11 w-full max-w-md whitespace-normal !border-indigo-300/40 !bg-indigo-500/20 px-4 py-2 text-center font-bold !text-indigo-100 hover:!bg-indigo-500/30 hover:!text-white"
        >
          <GraduationCap className="w-4 h-4 mr-2" />
          GTO 练习模式 · 随机场景积分挑战
        </Button>
      </div>

      <p className="mx-auto mt-8 max-w-xl text-center text-xs leading-5 text-emerald-100/40 sm:mt-10">
        标准无限注德州扑克规则 · 最多 9 人同桌 · 仅供娱乐，无真实货币
      </p>
    </main>
  );
}
