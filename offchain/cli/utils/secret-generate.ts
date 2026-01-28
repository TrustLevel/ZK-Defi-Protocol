#!/usr/bin/env -S deno run --allow-write
/**
 * Secret Generation Script
 * Generates a random secret for anonymous borrowing
 *
 * The secret is a random 253-bit number (to fit in a field element)
 * stored as a decimal string for use in ZK circuits.
 */

/**
 * Generate a random secret (253-bit number as decimal string)
 * 253 bits ensures it fits in BN254 field (< 254 bits)
 */
function generateSecret(): string {
  // Generate 32 random bytes
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  // Clear top 3 bits to ensure < 253 bits
  bytes[0] = bytes[0] & 0x1F; // 0x1F = 0b00011111

  // Convert to BigInt
  let secret = 0n;
  for (let i = 0; i < bytes.length; i++) {
    secret = (secret << 8n) | BigInt(bytes[i]);
  }

  // Return as decimal string
  return secret.toString();
}

/**
 * Main function
 */
async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("🔐 Secret Generation for Anonymous Borrowing");
  console.log("═══════════════════════════════════════════════════════\n");

  const secret = generateSecret();
  console.log(`Generated Secret (253-bit number):`);
  console.log(`${secret}\n`);

  console.log("⚠️  CRITICAL SECURITY WARNINGS:");
  console.log("   1. This secret proves ownership of your collateral");
  console.log("   2. Anyone with this secret can access your collateral");
  console.log("   3. Store it securely (password manager, hardware wallet, etc.)");
  console.log("   4. Never share it with anyone");
  console.log("   5. Backup in multiple secure locations\n");

  // Save to file
  const secretData = {
    secret,
    created_at: new Date().toISOString(),
    bits: 253,
    warning: "DO NOT SHARE THIS FILE OR COMMIT TO VERSION CONTROL",
  };

  await Deno.writeTextFile(
    "./secrets.json",
    JSON.stringify(secretData, null, 2)
  );

  console.log("✅ Secret saved to: secrets.json");
  console.log("\n📋 Next Steps:");
  console.log("   1. Backup secrets.json to a secure location");
  console.log("   2. List your collateral: deno task list-collateral");
  console.log("   3. Create borrow request: deno task borrow-anonymous <utxo> <amount> <address>");
  console.log("\n═══════════════════════════════════════════════════════");
}

if (import.meta.main) {
  await main();
}
