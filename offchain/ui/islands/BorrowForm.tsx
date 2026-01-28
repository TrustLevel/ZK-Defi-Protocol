import { useSignal } from "@preact/signals";

export default function BorrowForm() {
  const isConnected = useSignal(false);
  const secret = useSignal("");
  const selectedUtxo = useSignal("");
  const collateralAmount = useSignal("1050000000"); // Example: 1050 ADA in lovelace
  const loanAmount = useSignal("");
  const loanTerm = useSignal("45"); // days
  const destination = useSignal("");
  const commitment = useSignal("");
  const isProcessing = useSignal(false);

  // Check wallet connection on mount
  if (typeof window !== "undefined") {
    const savedWallet = localStorage.getItem("connectedWallet");
    if (savedWallet) {
      isConnected.value = true;
    }
  }

  /**
   * Calculate Poseidon commitment (simplified)
   * In production, this would use circomlibjs
   */
  const calculateCommitment = () => {
    if (!secret.value || !collateralAmount.value) {
      return "";
    }

    // Placeholder: In production, this would use actual Poseidon hash
    // For demo, we'll create a fake hash
    const fakeHash = `poseidon_${secret.value.substring(0, 8)}_${collateralAmount.value}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(fakeHash);

    // Simple hash for demo (NOT cryptographically secure!)
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash) + data[i];
      hash = hash & hash;
    }

    return Math.abs(hash).toString(16).padStart(64, "0");
  };

  /**
   * Handle secret file upload
   */
  const handleSecretUpload = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      secret.value = data.secret || "";

      if (secret.value) {
        commitment.value = calculateCommitment();
      }
    } catch (err) {
      alert("Failed to read secrets file. Make sure it's a valid JSON file.");
    }
  };

  /**
   * Validate form and create borrow request
   */
  const createBorrowRequest = async () => {
    // Validation
    if (!secret.value) {
      alert("Please upload or paste your secret");
      return;
    }
    if (!selectedUtxo.value) {
      alert("Please select a collateral UTXO");
      return;
    }
    if (!loanAmount.value || parseFloat(loanAmount.value) <= 0) {
      alert("Please enter a valid loan amount");
      return;
    }
    if (!destination.value) {
      alert("Please enter a destination address");
      return;
    }

    isProcessing.value = true;

    try {
      // Convert ADA to lovelace
      const loanLovelace = (parseFloat(loanAmount.value) * 1_000_000).toString();
      const loanTermMs = (parseFloat(loanTerm.value) * 24 * 60 * 60 * 1000).toString();

      // Calculate commitment
      const calc_commitment = calculateCommitment();

      // Check collateral ratio (150%)
      const collateralValue = BigInt(collateralAmount.value);
      const loanValue = BigInt(loanLovelace);
      const requiredCollateral = (loanValue * 150n) / 100n;

      if (collateralValue < requiredCollateral) {
        alert(
          `Insufficient collateral! You need at least ${
            Number(requiredCollateral) / 1_000_000
          } ADA for this loan.`
        );
        isProcessing.value = false;
        return;
      }

      // Create borrow request
      const borrowRequest = {
        secret: secret.value,
        collateral_utxo: selectedUtxo.value,
        loan_amount: loanLovelace,
        loan_term: loanTermMs,
        destination: destination.value,
        _metadata: {
          collateral_amount: collateralAmount.value,
          commitment: calc_commitment,
          created_at: new Date().toISOString(),
          network: "Preprod",
        },
      };

      // Download as JSON
      const blob = new Blob([JSON.stringify(borrowRequest, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "borrow-request.json";
      a.click();
      URL.revokeObjectURL(url);

      alert("Borrow request created! File downloaded: borrow-request.json");
    } catch (err) {
      alert(`Error creating borrow request: ${err}`);
    } finally {
      isProcessing.value = false;
    }
  };

  const formatAda = (lovelace: string): string => {
    return (parseFloat(lovelace) / 1_000_000).toFixed(2);
  };

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
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            <p>Connect your wallet to create borrow request</p>
          </div>
        )
        : (
          <div class="space-y-4">
            {/* Secret Input */}
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-2">
                Secret
              </label>
              <div class="space-y-2">
                <input
                  type="file"
                  accept=".json"
                  onChange={handleSecretUpload}
                  class="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-purple-600 file:text-white hover:file:bg-purple-700 cursor-pointer"
                />
                <div class="relative">
                  <input
                    type="text"
                    placeholder="Or paste your secret here..."
                    value={secret.value}
                    onInput={(e) => {
                      secret.value = (e.target as HTMLInputElement).value;
                      if (secret.value && collateralAmount.value) {
                        commitment.value = calculateCommitment();
                      }
                    }}
                    class="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 font-mono text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Collateral UTXO Selection */}
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-2">
                Collateral UTXO
              </label>
              <select
                value={selectedUtxo.value}
                onChange={(e) => {
                  selectedUtxo.value = (e.target as HTMLSelectElement).value;
                  // In production, fetch actual collateral amount for selected UTXO
                }}
                class="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-purple-500"
              >
                <option value="">Select a UTXO...</option>
                <option value="abc123def456...#0">
                  abc123def456...#0 (1050 ADA)
                </option>
                <option value="xyz789ghi012...#1">
                  xyz789ghi012...#1 (850 ADA)
                </option>
              </select>
            </div>

            {/* Loan Amount */}
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-2">
                Loan Amount (ADA)
              </label>
              <input
                type="number"
                placeholder="700"
                value={loanAmount.value}
                onInput={(e) =>
                  (loanAmount.value = (e.target as HTMLInputElement).value)}
                class="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                step="0.01"
                min="0"
              />
              {loanAmount.value && collateralAmount.value && (
                <div class="mt-2 text-xs text-gray-400">
                  Required collateral (150%): {" "}
                  {formatAda((BigInt(loanAmount.value) * 1_500_000n).toString())}{" "}
                  ADA
                  <br />
                  Your collateral: {formatAda(collateralAmount.value)} ADA
                  {BigInt(collateralAmount.value) >=
                      (BigInt(loanAmount.value) * 1_500_000n)
                    ? (
                      <span class="text-green-400"> ✓ Sufficient</span>
                    )
                    : (
                      <span class="text-red-400"> ✗ Insufficient</span>
                    )}
                </div>
              )}
            </div>

            {/* Loan Term */}
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-2">
                Loan Term (Days)
              </label>
              <select
                value={loanTerm.value}
                onChange={(e) =>
                  (loanTerm.value = (e.target as HTMLSelectElement).value)}
                class="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-purple-500"
              >
                <option value="30">30 days</option>
                <option value="45">45 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
              </select>
            </div>

            {/* Destination Address */}
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-2">
                Destination Address
              </label>
              <input
                type="text"
                placeholder="addr_test1qz..."
                value={destination.value}
                onInput={(e) =>
                  (destination.value = (e.target as HTMLInputElement).value)}
                class="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 font-mono text-sm"
              />
              <div class="mt-1 text-xs text-gray-400">
                Where you'll receive the loan
              </div>
            </div>

            {/* Commitment Preview */}
            {commitment.value && (
              <div class="bg-purple-900/20 border border-purple-500/30 rounded-lg p-3">
                <div class="text-xs text-purple-300 mb-1">
                  Calculated Commitment:
                </div>
                <div class="font-mono text-xs text-white break-all">
                  {commitment.value}
                </div>
              </div>
            )}

            {/* Create Button */}
            <button
              onClick={createBorrowRequest}
              disabled={isProcessing.value}
              class={`w-full ${
                isProcessing.value
                  ? "bg-gray-600 cursor-not-allowed"
                  : "bg-purple-600 hover:bg-purple-700"
              } text-white font-semibold py-3 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2`}
            >
              {isProcessing.value
                ? (
                  <>
                    <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    Processing...
                  </>
                )
                : (
                  <>
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
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    Create Borrow Request
                  </>
                )}
            </button>

            {/* Instructions */}
            <div class="bg-slate-800/30 border border-white/5 rounded-lg p-4 text-sm text-gray-400">
              <div class="font-semibold text-white mb-2">Next Steps:</div>
              <ol class="list-decimal list-inside space-y-1">
                <li>Review the downloaded borrow-request.json file</li>
                <li>Submit it to the backend proving service</li>
                <li>Wait for ZK proof generation (~1 second)</li>
                <li>Loan will be issued to your destination address</li>
              </ol>
            </div>
          </div>
        )}
    </div>
  );
}
