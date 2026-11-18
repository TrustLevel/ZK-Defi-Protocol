"use client";

import { useState } from "react";
import PoolView from "../components/PoolView";

const TABS = ["Pool", "Borrow", "Lend"];

export default function Home() {
  const [tab, setTab] = useState("Pool");
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">ZK Lending</h1>
          <p className="text-sm text-muted">Private loans on Cardano Preprod. Every proof is generated in your browser.</p>
        </div>
      </header>
      <nav className="mb-6 flex gap-1 rounded-lg border border-line bg-surface p-1 text-sm">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-2 ${tab === t ? "bg-accent text-white" : "text-muted hover:bg-canvas"}`}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === "Pool" && <PoolView />}
      {tab !== "Pool" && <p className="text-muted">Coming next.</p>}
    </main>
  );
}
