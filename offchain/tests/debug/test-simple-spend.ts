#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * SIMPLEST POSSIBLE TEST
 *
 * Goal: Spend Pool UTXO and send 10 ADA somewhere
 * No ZK proof, no collateral, no complex logic
 * Just test if validator execution works at all
 */

import { Lucid, Blockfrost, Data, applyParamsToScript, getAddressDetails } from "@lucid-evolution/lucid";

const PREPROD_BLOCKFROST = Deno.env.get("PREPROD_BLOCKFROST")!;
const ADMIN_WALLET_SEED = Deno.env.get("ADMIN_WALLET_SEED")!;
const BEACON_POLICY_ID = Deno.env.get("BEACON_POLICY_ID")!;

// User1 fresh address for receiving
const DESTINATION = "addr_test1qp390j3nd3ft4r7lr349tlakgnrlfmx45yz49g3edy2z4njdwfc7eln8wq4d4dmatfclluzexr53mjejgwfs5hkmxkxs7ekjak";

console.log("═══════════════════════════════════════════════════════");
console.log("🧪 SIMPLE SPEND TEST");
console.log("═══════════════════════════════════════════════════════\n");

try {
    // Initialize Lucid
    console.log("🌐 Step 1: Connecting to Cardano...");
    const lucid = await Lucid(
        new Blockfrost(PREPROD_BLOCKFROST, "blockfrost1he7uy2whn7zfqzlw2m7"),
        "Preprod"
    );
    lucid.selectWallet.fromSeed(ADMIN_WALLET_SEED);
    const adminAddress = await lucid.wallet().address();
    console.log(`   ✅ Admin: ${adminAddress.substring(0, 40)}...\n`);

    // Load simple validator
    console.log("📜 Step 2: Loading simple validator...");
    const plutusJson = JSON.parse(
        await Deno.readTextFile("/Users/dominiktilman/ZK-Defi-Protocol/contracts/plutus.json")
    );

    const validator = plutusJson.validators.find((v: any) =>
        v.title === "test_simple_spend.test_simple_spend.spend"
    );

    if (!validator) {
        throw new Error("Simple spend validator not found in plutus.json");
    }

    // Extract admin key hash
    const adminAddressDetails = getAddressDetails(adminAddress);
    if (!adminAddressDetails.paymentCredential?.hash) {
        throw new Error("Invalid admin address");
    }
    const adminKeyHash = adminAddressDetails.paymentCredential.hash;

    // Build params (same as other validators)
    const DepositContractParamsSchema = Data.Object({
        beacon_policy: Data.Bytes(),
        admin_key_hash: Data.Bytes(),
    });

    const params = Data.to({
        beacon_policy: BEACON_POLICY_ID,
        admin_key_hash: adminKeyHash,
    }, DepositContractParamsSchema);

    // Apply parameters
    const parameterizedScript = applyParamsToScript(
        validator.compiledCode,
        [params]
    );

    console.log(`   ✅ Simple validator loaded (not needed for this test)\n`);

    // Find pool UTXO at CURRENT pool address
    console.log("🔎 Step 3: Finding pool UTXO...");

    // Pool is at the OLD pool address, not test address
    const CURRENT_POOL_ADDRESS = Deno.env.get("LENDING_POOL_V3_ADDRESS")!;
    console.log(`   Looking at: ${CURRENT_POOL_ADDRESS}`);

    const poolUtxos = await lucid.utxosAt(CURRENT_POOL_ADDRESS);
    const beaconUnit = BEACON_POLICY_ID + "4c454e44494e47504f4f4c";
    const poolUtxo = poolUtxos.find(utxo => utxo.assets[beaconUnit] === 1n);

    if (!poolUtxo) {
        throw new Error("Pool UTXO not found");
    }

    console.log(`   ✅ Pool UTXO: ${poolUtxo.txHash.substring(0, 20)}...#${poolUtxo.outputIndex}`);
    console.log(`   ✅ Balance: ${Number(poolUtxo.assets.lovelace) / 1_000_000} ADA\n`);

    // Load CURRENT pool validator (not test validator!)
    console.log("📜 Step 4: Loading CURRENT pool validator...");
    const poolValidator = plutusJson.validators.find((v: any) =>
        v.title === "lending_pool_v3.lending_pool_v3.spend"
    );

    if (!poolValidator) {
        throw new Error("Pool validator not found");
    }

    const parameterizedPoolScript = applyParamsToScript(
        poolValidator.compiledCode,
        [params]
    );

    const currentPoolValidator = {
        type: "PlutusV3" as const,
        script: parameterizedPoolScript,
    };
    console.log(`   ✅ Pool validator loaded\n`);

    // Build simple redeemer: Deposit (Constructor 0 with no fields)
    console.log("🔨 Step 5: Building transaction...");

    const V3LendingPoolRedeemerSchema = Data.Enum([
        Data.Object({ Deposit: Data.Tuple([]) }), // Constructor 0
        Data.Object({ BorrowAnonymous: Data.Tuple([]) }), // Dummy
        Data.Object({ RepayAnonymous: Data.Tuple([]) }), // Dummy
    ]);

    const simpleRedeemer = Data.to({
        Deposit: [],
    }, V3LendingPoolRedeemerSchema);

    console.log(`   Redeemer: Deposit (Constructor 0)`);
    console.log(`   Redeemer CBOR: ${simpleRedeemer}`);

    // Build pool datum (same structure)
    const V3LendingPoolDatumSchema = Data.Object({
        total_deposited: Data.Integer(),
        total_borrowed: Data.Integer(),
        interest_rate: Data.Integer(),
        last_updated: Data.Integer(),
    });

    // Parse current datum
    let currentDatum;
    if (poolUtxo.datum) {
        console.log(`   Current Pool Datum CBOR: ${poolUtxo.datum}`);
        currentDatum = Data.from(poolUtxo.datum, V3LendingPoolDatumSchema);
        console.log(`   Parsed: total_deposited=${currentDatum.total_deposited}, total_borrowed=${currentDatum.total_borrowed}`);
    } else {
        throw new Error("Pool UTXO has no datum");
    }

    // New datum (unchanged)
    const newDatum = Data.to({
        total_deposited: currentDatum.total_deposited,
        total_borrowed: currentDatum.total_borrowed,
        interest_rate: currentDatum.interest_rate,
        last_updated: BigInt(Date.now()),
    }, V3LendingPoolDatumSchema);

    const SEND_AMOUNT = 10_000_000; // 10 ADA

    // Build TX
    const tx = await lucid
        .newTx()
        .attach.Script(currentPoolValidator)
        .collectFrom([poolUtxo], simpleRedeemer)
        .addSigner(adminAddress)  // ADD ADMIN SIGNATURE!
        .pay.ToContract(
            CURRENT_POOL_ADDRESS,
            { kind: "inline", value: newDatum },
            {
                lovelace: BigInt(poolUtxo.assets.lovelace) - BigInt(SEND_AMOUNT),
                [beaconUnit]: 1n,
            }
        )
        .pay.ToAddress(DESTINATION, { lovelace: BigInt(SEND_AMOUNT) })
        .complete();

    console.log(`   ✅ Transaction built!\n`);

    // Sign and submit
    console.log("✍️  Step 6: Signing...");
    const signedTx = await tx.sign.withWallet().complete();
    const txHash = signedTx.toHash();
    console.log(`   ✅ TX Hash: ${txHash}\n`);

    console.log("📤 Step 7: Submitting...");
    await signedTx.submit();
    console.log(`   ✅ Submitted!\n`);

    console.log("═══════════════════════════════════════════════════════");
    console.log("✅ ✅ ✅ SIMPLE SPEND SUCCESSFUL! ✅ ✅ ✅");
    console.log("═══════════════════════════════════════════════════════\n");

    console.log(`🔗 https://preprod.cardanoscan.io/transaction/${txHash}\n`);

} catch (error) {
    console.error("\n❌ TEST FAILED:");
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
        console.error("\nStack:", error.stack);
    }
    Deno.exit(1);
}
