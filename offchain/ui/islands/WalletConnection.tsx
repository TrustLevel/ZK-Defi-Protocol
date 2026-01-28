import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

declare global {
  interface Window {
    cardano?: {
      nami?: { enable: () => Promise<any>; isEnabled: () => Promise<boolean> };
      eternl?: { enable: () => Promise<any>; isEnabled: () => Promise<boolean> };
      lace?: { enable: () => Promise<any>; isEnabled: () => Promise<boolean> };
      [key: string]: any;
    };
  }
}

export default function WalletConnection() {
  const isConnected = useSignal(false);
  const address = useSignal("");
  const walletName = useSignal("");
  const showDropdown = useSignal(false);

  useEffect(() => {
    // Check if already connected on mount
    const savedWallet = localStorage.getItem("connectedWallet");
    const savedAddress = localStorage.getItem("walletAddress");

    if (savedWallet && savedAddress) {
      walletName.value = savedWallet;
      address.value = savedAddress;
      isConnected.value = true;
    }
  }, []);

  const detectWallets = () => {
    const wallets = [];
    if (globalThis.window?.cardano?.nami) wallets.push("nami");
    if (globalThis.window?.cardano?.eternl) wallets.push("eternl");
    if (globalThis.window?.cardano?.lace) wallets.push("lace");
    return wallets;
  };

  const connectWallet = async (wallet: string) => {
    try {
      const cardanoWallet = globalThis.window?.cardano?.[wallet];
      if (!cardanoWallet) {
        alert(`${wallet} wallet not found. Please install it first.`);
        return;
      }

      const api = await cardanoWallet.enable();
      const usedAddresses = await api.getUsedAddresses();
      const addr = usedAddresses[0] || await api.getChangeAddress();

      // Convert hex address to bech32 if needed (simplified)
      const decodedAddress = addr; // In production, properly decode to bech32

      address.value = decodedAddress.substring(0, 20) + "...";
      walletName.value = wallet;
      isConnected.value = true;
      showDropdown.value = false;

      // Save to localStorage
      localStorage.setItem("connectedWallet", wallet);
      localStorage.setItem("walletAddress", decodedAddress);

      // Dispatch custom event for other components
      globalThis.window?.dispatchEvent(
        new CustomEvent("wallet-connected", {
          detail: { wallet, address: decodedAddress },
        })
      );
    } catch (error) {
      console.error("Failed to connect wallet:", error);
      alert("Failed to connect wallet. Please try again.");
    }
  };

  const disconnectWallet = () => {
    isConnected.value = false;
    address.value = "";
    walletName.value = "";
    showDropdown.value = false;

    // Clear localStorage
    localStorage.removeItem("connectedWallet");
    localStorage.removeItem("walletAddress");

    // Dispatch custom event
    globalThis.window?.dispatchEvent(new CustomEvent("wallet-disconnected"));
  };

  return (
    <div class="relative">
      {!isConnected.value
        ? (
          <button
            onClick={() => (showDropdown.value = !showDropdown.value)}
            class="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 px-6 rounded-lg transition-colors duration-200 flex items-center gap-2"
          >
            <svg
              class="w-5 h-5"
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
            Connect Wallet
          </button>
        )
        : (
          <button
            onClick={() => (showDropdown.value = !showDropdown.value)}
            class="bg-slate-700 hover:bg-slate-600 text-white font-semibold py-2 px-6 rounded-lg transition-colors duration-200 flex items-center gap-2"
          >
            <div class="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span class="font-mono text-sm">{address.value}</span>
            <span class="text-xs text-gray-400 capitalize">({walletName.value})</span>
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
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        )}

      {/* Dropdown Menu */}
      {showDropdown.value && (
        <div class="absolute right-0 mt-2 w-56 bg-slate-800 border border-white/10 rounded-lg shadow-xl z-50">
          {!isConnected.value
            ? (
              <div class="p-2">
                <div class="px-3 py-2 text-xs text-gray-400 font-semibold">
                  Select Wallet
                </div>
                {detectWallets().length === 0
                  ? (
                    <div class="px-3 py-2 text-sm text-gray-400">
                      No wallets detected. Please install Nami, Eternl, or Lace.
                    </div>
                  )
                  : (
                    detectWallets().map((wallet) => (
                      <button
                        key={wallet}
                        onClick={() => connectWallet(wallet)}
                        class="w-full text-left px-3 py-2 text-white hover:bg-purple-600/20 rounded capitalize flex items-center gap-2"
                      >
                        <div class="w-6 h-6 bg-purple-600 rounded-full flex items-center justify-center text-xs font-bold">
                          {wallet[0].toUpperCase()}
                        </div>
                        {wallet}
                      </button>
                    ))
                  )}
              </div>
            )
            : (
              <div class="p-2">
                <div class="px-3 py-2 border-b border-white/10">
                  <div class="text-xs text-gray-400 mb-1">Connected Wallet</div>
                  <div class="text-sm text-white font-mono break-all">
                    {address.value}
                  </div>
                </div>
                <button
                  onClick={disconnectWallet}
                  class="w-full text-left px-3 py-2 text-red-400 hover:bg-red-600/20 rounded flex items-center gap-2 mt-1"
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
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                    />
                  </svg>
                  Disconnect
                </button>
              </div>
            )}
        </div>
      )}

      {/* Click outside to close */}
      {showDropdown.value && (
        <div
          class="fixed inset-0 z-40"
          onClick={() => (showDropdown.value = false)}
        />
      )}
    </div>
  );
}
