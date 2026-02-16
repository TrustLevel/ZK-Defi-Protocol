#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * STEP 2 ONLY: Spend from validator with V3LendingPoolDatum
 */

import { Lucid, Blockfrost, Data, validatorToAddress } from "@lucid-evolution/lucid";

const PREPROD_BLOCKFROST = Deno.env.get("PREPROD_BLOCKFROST")!;
const ADMIN_WALLET_SEED = Deno.env.get("ADMIN_WALLET_SEED")!;
const USER1 = "addr_test1qp390j3nd3ft4r7lr349tlakgnrlfmx45yz49g3edy2z4njdwfc7eln8wq4d4dmatfclluzexr53mjejgwfs5hkmxkxs7ekjak";

console.log("═══════════════════════════════════════════════════════");
console.log("🔓 STEP 2: Spend from validator with V3LendingPoolDatum");
console.log("═══════════════════════════════════════════════════════\n");

try {
    const lucid = await Lucid(
        new Blockfrost(PREPROD_BLOCKFROST, "blockfrost1he7uy2whn7zfqzlw2m7"),
        "Preprod"
    );
    lucid.selectWallet.fromSeed(ADMIN_WALLET_SEED);

    console.log("📜 Loading validator...");
    const plutusJson = JSON.parse(
        await Deno.readTextFile("/Users/dominiktilman/ZK-Defi-Protocol/contracts/plutus.json")
    );

    const validator = plutusJson.validators.find((v: any) =>
        v.title === "test_with_datum.test_with_datum.spend"
    );

    if (!validator) throw new Error("Validator not found");

    const script = {
        type: "PlutusV3" as const,
        script: validator.compiledCode,
    };

    const address = validatorToAddress("Preprod", script);
    console.log(`   ✅ Address: ${address}\n`);

    // Find UTXO
    console.log("🔎 Finding UTXO...");
    const utxos = await lucid.utxosAt(address);
    if (utxos.length === 0) throw new Error("No UTXO");

    const utxo = utxos[0];
    console.log(`   Found: ${Number(utxo.assets.lovelace) / 1_000_000} ADA`);
    console.log(`   UTXO: ${utxo.txHash.substring(0, 20)}...#${utxo.outputIndex}\n`);

    console.log("🔓 Building spend transaction...");
    const spendTx = await lucid
        .newTx()
        .attach.Script(script)
        .collectFrom([utxo], Data.to(1n))  // Simple redeemer = 1
        .pay.ToAddress(USER1, { lovelace: 10_000_000n })
        .complete();

    console.log(`   ✅ Transaction built!\n`);

    const spendSigned = await spendTx.sign.withWallet().complete();
    const spendHash = await spendSigned.submit();

    console.log(`   ✅ TX: ${spendHash}\n`);

    console.log("═══════════════════════════════════════════════════════");
    console.log("✅ ✅ ✅ IT WORKS! ✅ ✅ ✅");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log(`🔗 https://preprod.cardanoscan.io/transaction/${spendHash}\n`);

} catch (error) {
    console.error("\n❌ FAILED:");
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
}
