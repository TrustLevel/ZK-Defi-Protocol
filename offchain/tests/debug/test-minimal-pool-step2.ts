#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * STEP 2 ONLY: Spend from minimal pool
 */

import { Lucid, Blockfrost, Data, applyParamsToScript, getAddressDetails, validatorToAddress } from "@lucid-evolution/lucid";

const PREPROD_BLOCKFROST = Deno.env.get("PREPROD_BLOCKFROST")!;
const ADMIN_WALLET_SEED = Deno.env.get("ADMIN_WALLET_SEED")!;
const BEACON_POLICY_ID = Deno.env.get("BEACON_POLICY_ID")!;
const USER1_DESTINATION = "addr_test1qp390j3nd3ft4r7lr349tlakgnrlfmx45yz49g3edy2z4njdwfc7eln8wq4d4dmatfclluzexr53mjejgwfs5hkmxkxs7ekjak";

console.log("═══════════════════════════════════════════════════════");
console.log("🔓 STEP 2: Spend from minimal pool");
console.log("═══════════════════════════════════════════════════════\n");

try {
    const lucid = await Lucid(
        new Blockfrost(PREPROD_BLOCKFROST, "blockfrost1he7uy2whn7zfqzlw2m7"),
        "Preprod"
    );
    lucid.selectWallet.fromSeed(ADMIN_WALLET_SEED);
    const adminAddress = await lucid.wallet().address();

    // Load validator
    const plutusJson = JSON.parse(
        await Deno.readTextFile("/Users/dominiktilman/ZK-Defi-Protocol/contracts/plutus.json")
    );

    const validator = plutusJson.validators.find((v: any) =>
        v.title === "test_pool_minimal.test_pool_minimal.spend"
    );

    const adminDetails = getAddressDetails(adminAddress);
    const adminKeyHash = adminDetails.paymentCredential!.hash;

    const DepositContractParamsSchema = Data.Object({
        beacon_policy: Data.Bytes(),
        admin_key_hash: Data.Bytes(),
    });

    const params = Data.to({
        beacon_policy: BEACON_POLICY_ID,
        admin_key_hash: adminKeyHash,
    }, DepositContractParamsSchema);

    const parameterizedScript = applyParamsToScript(validator.compiledCode, [params]);

    const poolValidator = {
        type: "PlutusV3" as const,
        script: parameterizedScript,
    };

    const poolAddress = validatorToAddress("Preprod", poolValidator);
    console.log(`Pool address: ${poolAddress}\n`);

    // Find pool UTXO
    console.log("🔎 Finding pool UTXO...");
    const utxos = await lucid.utxosAt(poolAddress);
    if (utxos.length === 0) {
        throw new Error("No UTXOs at pool");
    }

    const poolUtxo = utxos[0];
    console.log(`   ✅ Found: ${Number(poolUtxo.assets.lovelace) / 1_000_000} ADA`);
    console.log(`   UTXO: ${poolUtxo.txHash.substring(0, 20)}...#${poolUtxo.outputIndex}\n`);

    // Datum schema
    const V3LendingPoolDatumSchema = Data.Object({
        total_deposited: Data.Integer(),
        total_borrowed: Data.Integer(),
        interest_rate: Data.Integer(),
        last_updated: Data.Integer(),
    });

    // Simple redeemer
    const redeemer = Data.to(1n);
    console.log(`🔨 Building spend transaction...`);
    console.log(`   Redeemer: ${redeemer}`);

    // New datum
    const newDatum = Data.to({
        total_deposited: 0n,
        total_borrowed: 0n,
        interest_rate: 500n,
        last_updated: BigInt(Date.now()),
    }, V3LendingPoolDatumSchema);

    // Build TX
    const tx = await lucid
        .newTx()
        .attach.Script(poolValidator)
        .collectFrom([poolUtxo], redeemer)
        .addSigner(adminAddress)
        .pay.ToAddress(USER1_DESTINATION, { lovelace: 10_000_000n })
        .pay.ToContract(
            poolAddress,
            { kind: "inline", value: newDatum },
            { lovelace: 90_000_000n }
        )
        .complete();

    console.log(`   ✅ Transaction built!\n`);

    const signedTx = await tx.sign.withWallet().complete();
    const txHash = await signedTx.submit();

    console.log("📤 Submitted!");
    console.log(`   TX: ${txHash}\n`);

    console.log("═══════════════════════════════════════════════════════");
    console.log("✅ ✅ ✅ SPENDING WORKS! ✅ ✅ ✅");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log(`🔗 https://preprod.cardanoscan.io/transaction/${txHash}\n`);

} catch (error) {
    console.error("\n❌ SPENDING FAILED:");
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
}
