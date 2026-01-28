import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

interface CollateralUTXO {
  utxoRef: string;
  amount: bigint;
  status: "unlocked" | "locked";
  commitment?: string;
}

export default function CollateralList() {
  const isConnected = useSignal(false);
  const isLoading = useSignal(false);
  const utxos = useSignal<CollateralUTXO[]>([]);
  const error = useSignal("");
  const showUnlockedOnly = useSignal(true);

  useEffect(() => {
    // Listen for wallet connection events
    const handleWalletConnected = () => {
      isConnected.value = true;
      loadCollateral();
    };

    const handleWalletDisconnected = () => {
      isConnected.value = false;
      utxos.value = [];
    };

    globalThis.window?.addEventListener(
      "wallet-connected",
      handleWalletConnected
    );
    globalThis.window?.addEventListener(
      "wallet-disconnected",
      handleWalletDisconnected
    );

    // Check if already connected
    const savedWallet = localStorage.getItem("connectedWallet");
    if (savedWallet) {
      isConnected.value = true;
    }

    return () => {
      globalThis.window?.removeEventListener(
        "wallet-connected",
        handleWalletConnected
      );
      globalThis.window?.removeEventListener(
        "wallet-disconnected",
        handleWalletDisconnected
      );
    };
  }, []);

  const loadCollateral = async () => {
    isLoading.value = true;
    error.value = "";

    try {
      // TODO: In production, this would call the backend API or use Lucid
      // For now, we'll show a placeholder message

      // Simulated data for demo
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Placeholder UTXOs
      utxos.value = [
        {
          utxoRef: "abc123def456...#0",
          amount: 1050000000n,
          status: "unlocked",
        },
        {
          utxoRef: "fed654cba321...#1",
          amount: 750000000n,
          status: "locked",
          commitment: "1234567890abcdef...",
        },
      ];
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to load collateral";
    } finally {
      isLoading.value = false;
    }
  };

  const formatAda = (lovelace: bigint): string => {
    return (Number(lovelace) / 1_000_000).toFixed(2) + " ADA";
  };

  const filteredUtxos = showUnlockedOnly.value
    ? utxos.value.filter((u) => u.status === "unlocked")
    : utxos.value;

  return (
    <div>
      {!isConnected.value
        ? (
          <div class="text-center py-8 text-gray-400">
            <svg
              class="w-12 h-12 mx-auto mb-3 text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            <p>Connect your wallet to view collateral</p>
          </div>
        )
        : isLoading.value
        ? (
          <div class="text-center py-8">
            <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-500 mx-auto"></div>
            <p class="text-gray-400 mt-3">Loading collateral...</p>
          </div>
        )
        : error.value
        ? (
          <div class="bg-red-900/20 border border-red-500/30 rounded-lg p-4 text-red-300">
            <div class="font-semibold mb-1">Error</div>
            <div class="text-sm">{error.value}</div>
            <button
              onClick={loadCollateral}
              class="mt-3 text-sm underline hover:no-underline"
            >
              Try again
            </button>
          </div>
        )
        : (
          <div>
            {/* Filter Toggle */}
            <div class="flex items-center justify-between mb-4">
              <label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showUnlockedOnly.value}
                  onChange={(e) =>
                    (showUnlockedOnly.value = (e.target as HTMLInputElement).checked)}
                  class="w-4 h-4 rounded bg-slate-700 border-slate-600 text-purple-600 focus:ring-purple-500"
                />
                Show unlocked only
              </label>
              <button
                onClick={loadCollateral}
                class="text-sm text-purple-400 hover:text-purple-300 flex items-center gap-1"
              >
                <svg
                  class="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Refresh
              </button>
            </div>

            {/* UTXO List */}
            {filteredUtxos.length === 0
              ? (
                <div class="text-center py-6 text-gray-400">
                  <p>No {showUnlockedOnly.value ? "unlocked " : ""}collateral UTXOs found</p>
                </div>
              )
              : (
                <div class="space-y-3">
                  {filteredUtxos.map((utxo, idx) => (
                    <div
                      key={utxo.utxoRef}
                      class="bg-slate-800/50 border border-white/10 rounded-lg p-4 hover:border-purple-500/30 transition-colors"
                    >
                      <div class="flex items-start justify-between mb-2">
                        <div class="flex-1">
                          <div class="text-xs text-gray-400 mb-1">UTXO #{idx + 1}</div>
                          <div class="font-mono text-sm text-white break-all">
                            {utxo.utxoRef}
                          </div>
                        </div>
                        <div class="ml-3">
                          {utxo.status === "unlocked"
                            ? (
                              <span class="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-green-900/30 text-green-400 border border-green-500/30">
                                <span class="mr-1">🔓</span> Unlocked
                              </span>
                            )
                            : (
                              <span class="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-900/30 text-red-400 border border-red-500/30">
                                <span class="mr-1">🔒</span> Locked
                              </span>
                            )}
                        </div>
                      </div>

                      <div class="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
                        <div>
                          <div class="text-xs text-gray-400">Amount</div>
                          <div class="text-lg font-semibold text-white">
                            {formatAda(utxo.amount)}
                          </div>
                        </div>

                        {utxo.commitment && (
                          <div class="text-right">
                            <div class="text-xs text-gray-400">Commitment</div>
                            <div class="text-xs font-mono text-purple-400">
                              {utxo.commitment.substring(0, 12)}...
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </div>
        )}
    </div>
  );
}
