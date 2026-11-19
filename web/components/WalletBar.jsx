"use client";

import { useEffect, useState } from "react";
import { availableWallets, connectWallet, shortAddress } from "../lib/wallet";
import { track, walletName } from "../lib/analytics";

// Connect a CIP-30 wallet. One connection is one account: to use another
// account, switch it in the wallet and press "Reconnect".
export default function WalletBar({ account, setAccount }) {
  const [wallets, setWallets] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    availableWallets().then(setWallets).catch(() => setWallets([]));
  }, []);

  async function connect(name) {
    setBusy(true);
    setError(null);
    try {
      setAccount(await connectWallet(name));
      track([{ step: "wallet", event: "connect", wallet: walletName(name) }]);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  if (account) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-md bg-accent-soft px-2 py-1 font-mono text-accent" title={account.address}>
          {account.name} · {shortAddress(account.address)}
        </span>
        <button className="rounded-md border border-line px-2 py-1 hover:bg-canvas" disabled={busy} onClick={() => connect(account.name)}>
          Reconnect
        </button>
        <button className="rounded-md px-2 py-1 text-muted hover:bg-canvas" onClick={() => setAccount(null)}>Disconnect</button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {wallets.length === 0 && <span className="text-muted">No Cardano wallet found in this browser.</span>}
      {wallets.map((w) => (
        <button key={w.id} disabled={busy} onClick={() => connect(w.id)}
          className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 hover:bg-canvas">
          {w.icon && <img src={w.icon} alt="" className="h-4 w-4" />} Connect {w.name}
        </button>
      ))}
      {error && <span className="text-warn">{error}</span>}
    </div>
  );
}
