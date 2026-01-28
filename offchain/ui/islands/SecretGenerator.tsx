import { useSignal } from "@preact/signals";

export default function SecretGenerator() {
  const secret = useSignal("");
  const isGenerated = useSignal(false);
  const copied = useSignal(false);

  /**
   * Generate a cryptographically secure 253-bit secret
   */
  const generateSecret = () => {
    // Generate 32 random bytes
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);

    // Clear top 3 bits to ensure < 253 bits (for BN254 field)
    bytes[0] = bytes[0] & 0x1F; // 0x1F = 0b00011111

    // Convert to BigInt then to decimal string
    let secretBigInt = 0n;
    for (let i = 0; i < bytes.length; i++) {
      secretBigInt = (secretBigInt << 8n) | BigInt(bytes[i]);
    }

    secret.value = secretBigInt.toString();
    isGenerated.value = true;
    copied.value = false;
  };

  /**
   * Copy secret to clipboard
   */
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(secret.value);
      copied.value = true;
      setTimeout(() => (copied.value = false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  /**
   * Download secret as JSON file
   */
  const downloadSecret = () => {
    const secretData = {
      secret: secret.value,
      created_at: new Date().toISOString(),
      bits: 253,
      warning: "DO NOT SHARE THIS FILE OR COMMIT TO VERSION CONTROL",
    };

    const blob = new Blob([JSON.stringify(secretData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "secrets.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {!isGenerated.value
        ? (
          // Generate Button
          <button
            onClick={generateSecret}
            class="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2"
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
                d="M12 6v6m0 0v6m0-6h6m-6 0H6"
              />
            </svg>
            Generate Secret
          </button>
        )
        : (
          // Secret Display
          <div class="space-y-3">
            {/* Secret Display */}
            <div class="bg-slate-800/50 rounded-lg p-3 border border-purple-500/20">
              <div class="text-xs text-gray-400 mb-1">Your Secret:</div>
              <div class="font-mono text-sm text-white break-all">
                {secret.value}
              </div>
            </div>

            {/* Action Buttons */}
            <div class="flex gap-2">
              <button
                onClick={copyToClipboard}
                class={`flex-1 ${
                  copied.value ? "bg-green-600" : "bg-slate-700"
                } hover:bg-slate-600 text-white font-medium py-2 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2 text-sm`}
              >
                {copied.value
                  ? (
                    <>
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
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      Copied!
                    </>
                  )
                  : (
                    <>
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
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                      Copy
                    </>
                  )}
              </button>

              <button
                onClick={downloadSecret}
                class="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-medium py-2 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2 text-sm"
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
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Download
              </button>

              <button
                onClick={() => {
                  secret.value = "";
                  isGenerated.value = false;
                }}
                class="bg-slate-700 hover:bg-slate-600 text-white font-medium py-2 px-3 rounded-lg transition-colors duration-200"
                title="Generate new secret"
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
              </button>
            </div>

            {/* Warning */}
            <div class="bg-amber-900/20 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-200">
              <div class="font-semibold mb-1">⚠️ Security Warning</div>
              <div>
                This secret proves ownership of your collateral. Store it
                securely and never share it!
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
