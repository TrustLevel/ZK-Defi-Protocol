"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import PoolView from "../components/PoolView";
import Term from "../components/Term";

// Wallet and protocol code use browser-only APIs (CIP-30, WebAssembly, Workers).
const WalletBar = dynamic(() => import("../components/WalletBar"), { ssr: false });
const BorrowView = dynamic(() => import("../components/BorrowView"), { ssr: false });
const LendView = dynamic(() => import("../components/LendView"), { ssr: false });
const UsageFooter = dynamic(() => import("../components/UsageFooter"), { ssr: false });

const TABS = ["Pool", "Borrow", "Lend"];

export default function Home() {
  const [tab, setTab] = useState("Pool");
  const [account, setAccount] = useState(null);
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">ZK Lending</h1>
          <p className="text-sm text-muted">Private loans on Cardano Preprod. Every <Term id="proof">proof</Term> is generated in your browser.</p>
        </div>
        <WalletBar account={account} setAccount={setAccount} />
      </header>
      <nav className="mb-6 flex gap-1 rounded-lg border border-line bg-surface p-1 text-sm">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-2 ${tab === t ? "bg-accent text-white" : "text-muted hover:bg-canvas"}`}>
            {t}
          </button>
        ))}
      </nav>
      {tab === "Pool" && <PoolView />}
      {tab === "Borrow" && <BorrowView account={account} />}
      {tab === "Lend" && <LendView account={account} />}
      <UsageFooter />
    </main>
  );
}
