"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Poker Room client error", error);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#01120e] px-5 text-center text-white">
      <div className="w-full max-w-md rounded-2xl border border-red-300/30 bg-red-950/60 p-6 shadow-2xl">
        <h1 className="text-xl font-black text-red-100">页面加载失败</h1>
        <p className="mt-2 text-sm leading-6 text-red-100/75">
          请重新加载页面；如果仍然失败，可以再试一次。
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 font-bold text-white hover:bg-white/15"
          >
            再试一次
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-xl bg-amber-400 px-4 py-3 font-black text-neutral-950 hover:bg-amber-300"
          >
            重新加载
          </button>
        </div>
      </div>
    </main>
  );
}
