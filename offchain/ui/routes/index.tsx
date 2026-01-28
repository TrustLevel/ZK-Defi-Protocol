import SecretGenerator from "../islands/SecretGenerator.tsx";
import WalletConnection from "../islands/WalletConnection.tsx";
import CollateralList from "../islands/CollateralList.tsx";
import BorrowForm from "../islands/BorrowForm.tsx";

export default function Home() {
  return (
    <div class="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <header class="bg-black/30 backdrop-blur-md border-b border-white/10">
        <div class="max-w-7xl mx-auto px-4 py-6">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <svg
                class="w-10 h-10 text-purple-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
              <div>
                <h1 class="text-2xl font-bold text-white">
                  ZK-DeFi Protocol
                </h1>
                <p class="text-sm text-purple-300">Anonymous Borrowing</p>
              </div>
            </div>
            <WalletConnection />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main class="max-w-7xl mx-auto px-4 py-8">
        {/* Introduction */}
        <div class="bg-black/30 backdrop-blur-md border border-white/10 rounded-xl p-6 mb-8">
          <h2 class="text-xl font-semibold text-white mb-3">
            Welcome to Anonymous Borrowing
          </h2>
          <p class="text-gray-300 mb-4">
            Borrow ADA without revealing your identity using Zero-Knowledge
            Proofs. Your collateral remains private while proving you have
            sufficient assets.
          </p>
          <div class="grid md:grid-cols-3 gap-4 mt-4">
            <div class="bg-purple-900/30 rounded-lg p-4 border border-purple-500/20">
              <div class="text-3xl mb-2">🔐</div>
              <h3 class="font-semibold text-white mb-1">Private</h3>
              <p class="text-sm text-gray-400">
                No identity required
              </p>
            </div>
            <div class="bg-purple-900/30 rounded-lg p-4 border border-purple-500/20">
              <div class="text-3xl mb-2">⚡</div>
              <h3 class="font-semibold text-white mb-1">Fast</h3>
              <p class="text-sm text-gray-400">
                Proof generation in ~1 second
              </p>
            </div>
            <div class="bg-purple-900/30 rounded-lg p-4 border border-purple-500/20">
              <div class="text-3xl mb-2">🔒</div>
              <h3 class="font-semibold text-white mb-1">Secure</h3>
              <p class="text-sm text-gray-400">
                Groth16 ZK-SNARK proofs
              </p>
            </div>
          </div>
        </div>

        {/* Step-by-Step Process */}
        <div class="grid lg:grid-cols-2 gap-6">
          {/* Left Column */}
          <div class="space-y-6">
            {/* Step 1: Secret Generation */}
            <div class="bg-black/30 backdrop-blur-md border border-white/10 rounded-xl p-6">
              <div class="flex items-center gap-3 mb-4">
                <div class="bg-purple-500 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold">
                  1
                </div>
                <h3 class="text-xl font-semibold text-white">
                  Generate Secret
                </h3>
              </div>
              <p class="text-gray-400 mb-4 text-sm">
                Create a cryptographic secret that proves ownership of your
                collateral without revealing it.
              </p>
              <SecretGenerator />
            </div>

            {/* Step 2: View Collateral */}
            <div class="bg-black/30 backdrop-blur-md border border-white/10 rounded-xl p-6">
              <div class="flex items-center gap-3 mb-4">
                <div class="bg-purple-500 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold">
                  2
                </div>
                <h3 class="text-xl font-semibold text-white">
                  View Collateral
                </h3>
              </div>
              <p class="text-gray-400 mb-4 text-sm">
                Connect your wallet to view available collateral UTXOs for
                borrowing.
              </p>
              <CollateralList />
            </div>
          </div>

          {/* Right Column */}
          <div>
            {/* Step 3: Create Borrow Request */}
            <div class="bg-black/30 backdrop-blur-md border border-white/10 rounded-xl p-6">
              <div class="flex items-center gap-3 mb-4">
                <div class="bg-purple-500 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold">
                  3
                </div>
                <h3 class="text-xl font-semibold text-white">
                  Create Borrow Request
                </h3>
              </div>
              <p class="text-gray-400 mb-4 text-sm">
                Fill in the loan details and create your anonymous borrow
                request.
              </p>
              <BorrowForm />
            </div>
          </div>
        </div>

        {/* Security Notice */}
        <div class="mt-8 bg-amber-900/20 backdrop-blur-md border border-amber-500/30 rounded-xl p-6">
          <div class="flex gap-3">
            <svg
              class="w-6 h-6 text-amber-400 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <h4 class="font-semibold text-amber-300 mb-2">
                Security Reminders
              </h4>
              <ul class="text-sm text-amber-200/80 space-y-1">
                <li>
                  • Never share your secret with anyone - it proves ownership of
                  your collateral
                </li>
                <li>
                  • Store your secret securely (password manager, hardware
                  wallet, etc.)
                </li>
                <li>
                  • The borrow request file contains your secret - handle with
                  care
                </li>
                <li>
                  • Backup your secret in multiple secure locations
                </li>
              </ul>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer class="mt-16 bg-black/30 backdrop-blur-md border-t border-white/10">
        <div class="max-w-7xl mx-auto px-4 py-6 text-center text-gray-400 text-sm">
          <p>
            Powered by Cardano, Aiken, Circom, and Zero-Knowledge Proofs
          </p>
          <p class="mt-2">
            Built with Fresh 🍋 - Milestone 3+4 Implementation
          </p>
        </div>
      </footer>
    </div>
  );
}
