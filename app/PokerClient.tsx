"use client";

import { useSyncExternalStore } from "react";
import { BrowserRouter } from "react-router";
import Link from "next/link";
import App from "../src/App";

const subscribeToHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export default function PokerClient() {
  const mounted = useSyncExternalStore(
    subscribeToHydration,
    clientSnapshot,
    serverSnapshot,
  );

  if (!mounted) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#01120e] px-5 text-center text-emerald-100">
        <p className="text-sm text-emerald-200/70">正在准备牌桌…</p>
        <div
          role="alert"
          className="client-startup-warning max-w-sm rounded-xl border border-amber-300/35 bg-amber-300/10 p-4 text-sm text-amber-100"
        >
          <p>页面脚本未成功加载，请刷新后重试。</p>
          <Link
            href="/"
            className="mt-3 inline-flex rounded-lg bg-amber-300 px-4 py-2 font-bold text-neutral-950"
          >
            重新加载
          </Link>
        </div>
      </main>
    );
  }

  return (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}
