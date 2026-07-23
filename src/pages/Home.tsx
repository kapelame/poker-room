import { useEffect, useState } from "react";
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
  ChevronDown,
  GraduationCap,
  LogIn,
  Plus,
  Spade,
  Users,
} from "lucide-react";

export default function Home() {
  const nav = useNavigate();
  const { joined, roomCode, kicked } = usePoker();
  const [createName, setCreateName] = useState(poker.savedName);
  const [joinName, setJoinName] = useState(poker.savedName);
  const [code, setCode] = useState("");
  const [showAdv, setShowAdv] = useState(false);
  const [startingChips, setStartingChips] = useState("1000");
  const [buyInAmount, setBuyInAmount] = useState("1000");
  const [sb, setSb] = useState("5");
  const [bb, setBb] = useState("10");
  const [decisionTimeSec, setDecisionTimeSec] = useState("30");
  const [timeBankSec, setTimeBankSec] = useState("30");
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    poker.connect();
  }, []);

  useEffect(() => {
    if (joined && roomCode) nav(`/room/${roomCode}`);
  }, [joined, roomCode, nav]);

  const validCreateName = createName.trim().length > 0;
  const validJoinName = joinName.trim().length > 0;

  const create = () => {
    if (!validCreateName) return;
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
    if (!validJoinName || code.trim().length < 4) return;
    poker.savedName = joinName.trim();
    poker.leaveLocal();
    poker.send({
      t: "join",
      code: code.trim().toUpperCase(),
      name: joinName.trim(),
    });
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,#064e3b_0%,#022c22_45%,#01120e_100%)] flex flex-col items-center justify-center p-4">
      <div className="flex items-center gap-3 mb-2">
        <Spade className="w-10 h-10 text-amber-400" />
        <h1 className="text-4xl md:text-5xl font-black text-white tracking-wide">
          德州扑克之夜
        </h1>
      </div>
      <p className="text-emerald-200/70 mb-8">
        创建房间，把链接发给朋友，马上开局 —— 无需注册
      </p>

      {kicked && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 text-sm">
          你已被房主移出上一个房间
          <button
            className="ml-2 underline"
            onClick={() => poker.clearKicked()}
          >
            知道了
          </button>
        </div>
      )}

      <div className="w-full max-w-3xl grid md:grid-cols-2 gap-5">
        {/* 创建房间 */}
        <Card className="bg-black/40 border-white/10 text-white backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-300">
              <Plus className="w-5 h-5" /> 创建房间
            </CardTitle>
            <CardDescription className="text-neutral-400">
              你是房主，生成房间码邀请朋友
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-neutral-300">你的昵称</Label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="例如：赌神"
                maxLength={16}
                className="bg-white/5 border-white/15 text-white"
              />
            </div>
            <button
              className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200"
              onClick={() => setShowAdv(!showAdv)}
            >
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${showAdv ? "rotate-180" : ""}`}
              />
              高级设置（筹码 / 盲注）
            </button>
            {showAdv && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-neutral-400">初始筹码</Label>
                  <Input
                    type="number"
                    value={startingChips}
                    min={100}
                    onChange={(e) => {
                      setStartingChips(e.target.value);
                      setCreateError(null);
                    }}
                    className="bg-white/5 border-white/15 text-white"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-neutral-400">一手买入</Label>
                  <Input
                    type="number"
                    value={buyInAmount}
                    min={100}
                    onChange={(e) => {
                      setBuyInAmount(e.target.value);
                      setCreateError(null);
                    }}
                    className="bg-white/5 border-white/15 text-white"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-neutral-400">小盲</Label>
                  <Input
                    type="number"
                    value={sb}
                    min={1}
                    onChange={(e) => {
                      setSb(e.target.value);
                      setCreateError(null);
                    }}
                    className="bg-white/5 border-white/15 text-white"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-neutral-400">大盲</Label>
                  <Input
                    type="number"
                    value={bb}
                    min={2}
                    onChange={(e) => {
                      setBb(e.target.value);
                      setCreateError(null);
                    }}
                    className="bg-white/5 border-white/15 text-white"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-neutral-400">决策秒数</Label>
                  <Input
                    type="number"
                    value={decisionTimeSec}
                    min={5}
                    max={300}
                    onChange={(e) => {
                      setDecisionTimeSec(e.target.value);
                      setCreateError(null);
                    }}
                    className="bg-white/5 border-white/15 text-white"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-neutral-400">时间银行</Label>
                  <Input
                    type="number"
                    value={timeBankSec}
                    min={0}
                    max={300}
                    onChange={(e) => {
                      setTimeBankSec(e.target.value);
                      setCreateError(null);
                    }}
                    className="bg-white/5 border-white/15 text-white"
                  />
                </div>
              </div>
            )}
            {createError && (
              <p className="text-sm text-red-400">{createError}</p>
            )}
            <Button
              onClick={create}
              disabled={!validCreateName}
              className="w-full bg-amber-500 hover:bg-amber-600 text-black font-bold h-11"
            >
              创建房间
            </Button>
          </CardContent>
        </Card>

        {/* 加入房间 */}
        <Card className="bg-black/40 border-white/10 text-white backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-300">
              <Users className="w-5 h-5" /> 加入房间
            </CardTitle>
            <CardDescription className="text-neutral-400">
              输入朋友分享的 6 位房间码
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-neutral-300">你的昵称</Label>
              <Input
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                placeholder="例如：小白"
                maxLength={16}
                className="bg-white/5 border-white/15 text-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-neutral-300">房间码</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="例如：K7P2XQ"
                maxLength={6}
                className="bg-white/5 border-white/15 text-white text-center text-2xl tracking-[0.4em] font-mono uppercase"
              />
            </div>
            <Button
              onClick={join}
              disabled={!validJoinName || code.trim().length < 4}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-11"
            >
              <LogIn className="w-4 h-4 mr-1" /> 加入房间
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* GTO 练习模式入口 */}
      <div className="mt-6">
        <Button
          variant="outline"
          onClick={() => nav("/practice")}
          className="border-indigo-400/40 text-indigo-300 hover:bg-indigo-500/10 hover:text-indigo-200 font-bold px-8 h-11"
        >
          <GraduationCap className="w-4 h-4 mr-2" />
          GTO 练习模式 · 随机场景积分挑战
        </Button>
      </div>

      <p className="mt-10 text-xs text-emerald-200/40">
        标准无限注德州扑克规则 · 最多 9 人同桌 · 仅供娱乐，无真实货币
      </p>
    </div>
  );
}
