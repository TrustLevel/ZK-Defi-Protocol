#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * TEST WITH DATUM ONLY
 * Uses V3LendingPoolDatum but NO parameters
 */

import { Lucid, Blockfrost, Data, validatorToAddress } from "@lucid-evolution/lucid";

const PREPROD_BLOCKFROST = Deno.env.get("PREPROD_BLOCKFROST")!;
const ADMIN_WALLET_SEED = Deno.env.get("ADMIN_WALLET_SEED")!;
const USER1 = "addr_test1qp390j3nd3ft4r7lr349tlakgnrlfmx45yz49g3edy2z4njdwfc7eln8wq4d4dmatfclluzexr53mjejgwfs5hkmxkxs7ekjak";

console.log("═══════════════════════════════════════════════════════");
console.log("🧪 TEST WITH DATUM ONLY");
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
        script: validator.compiledCode,  // NO parameters
    };

    const address = validatorToAddress("Preprod", script);
    console.log(`   ✅ Address: ${address}\n`);

    // V3LendingPoolDatum schema
    const V3LendingPoolDatumSchema = Data.Object({
        total_deposited: Data.Integer(),
        total_borrowed: Data.Integer(),
        interest_rate: Data.Integer(),
        last_updated: Data.Integer(),
    });

    // STEP 1: Lock
    console.log("💰 Step 1: Lock 50 ADA...");
    const datum = Data.to({
        total_deposited: 0n,
        total_borrowed: 0n,
        interest_rate: 500n,
        last_updated: BigInt(Date.now()),
    }, V3LendingPoolDatumSchema);

    const lockTx = await lucid
        .newTx()
        .pay.ToContract(
            address,
            { kind: "inline", value: datum },
            { lovelace: 50_000_000n }
        )
        .complete();

    const lockSigned = await lockTx.sign.withWallet().complete();
    const lockHash = await lockSigned.submit();
    console.log(`   ✅ TX: ${lockHash}`);
    console.log(`   ⏳ Waiting...\n`);
    await lucid.awaitTx(lockHash);
    console.log(`   ✅ Confirmed!\n`);

    // STEP 2: Spend
    console.log("🔓 Step 2: Spend 10 ADA...");
    const utxos = await lucid.utxosAt(address);
    if (utxos.length === 0) throw new Error("No UTXO");

    const utxo = utxos[0];
    console.log(`   Found: ${Number(utxo.assets.lovelace) / 1_000_000} ADA`);

    const spendTx = await lucid
        .newTx()
        .attach.Script(script)
        .collectFrom([utxo], Data.to(1n))  // Simple redeemer = 1
        .pay.ToAddress(USER1, { lovelace: 10_000_000n })
        .complete();

    console.log(`   ✅ Transaction built!`);

    const spendSigned = await spendTx.sign.withWallet().complete();
    const spendHash = await spendSigned.submit();

    console.log(`   ✅ TX: ${spendHash}\n`);

    console.log("═══════════════════════════════════════════════════════");
    console.log("✅ ✅ ✅ IT WORKS! ✅ ✅ ✅");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log(`Lock:  https://preprod.cardanoscan.io/transaction/${lockHash}`);
    console.log(`Spend: https://preprod.cardanoscan.io/transaction/${spendHash}\n`);

} catch (error) {
    console.error("\n❌ FAILED:");
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
}
