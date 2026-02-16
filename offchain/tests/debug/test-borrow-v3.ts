#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * CRITICAL TEST: Borrow from PlutusV3 Lending Pool
 *
 * This tests the operation that has NEVER worked before!
 * With PlutusV3 fix, the validator should now execute successfully.
 */

import { Lucid, Blockfrost, Data, applyParamsToScript, getAddressDetails } from "@lucid-evolution/lucid";
import {
    PREPROD_BLOCKFROST,
    ADMIN_WALLET_SEED,
    USER1_WALLET_SEED,
    LENDING_POOL_V3_ADDRESS,
    BEACON_POLICY_ID,
} from "../../lib/config.ts";
import {
    V3LendingPoolDatumSchema,
    V3LendingPoolRedeemerSchema,
    type DepositReceipt,
    DepositContractParamsSchema,
} from "../../lib/types.ts";
import { findLendingPoolUtxo } from "../../lib/query.ts";

console.log("═══════════════════════════════════════════════════════");
console.log("🎯 CRITICAL: Testing Borrow Operation (PlutusV3)");
console.log("═══════════════════════════════════════════════════════\n");

try {
    // Load deposit receipt
    console.log("📄 Step 1: Loading deposit receipt...");
    const receiptPath = "/Users/dominiktilman/ZK-Defi-Protocol/receipts/deposit-fcd30c657d4e7a0b81d521dd02fdde349c2e079e0576c8cd22aa5d322c3b5b55.json";
    const receipt: DepositReceipt = JSON.parse(await Deno.readTextFile(receiptPath));
    console.log(`   ✅ Receipt loaded`);
    console.log(`   Deposit: ${receipt.depositUtxoRef}`);
    console.log(`   Collateral: ${receipt.collateralAmount / 1_000_000} ADA\n`);

    // Initialize Lucid with admin wallet
    console.log("🌐 Step 2: Connecting to Cardano...");
    const lucid = await Lucid(
        new Blockfrost(PREPROD_BLOCKFROST!, "blockfrost1he7uy2whn7zfqzlw2m7"),
        "Preprod"
    );
    lucid.selectWallet.fromSeed(ADMIN_WALLET_SEED!);
    const adminAddress = await lucid.wallet().address();
    console.log(`   ✅ Admin wallet: ${adminAddress.substring(0, 30)}...\n`);

    // Get user1 address for loan destination
    const tempLucid = await Lucid(
        new Blockfrost(PREPROD_BLOCKFROST!, "blockfrost1he7uy2whn7zfqzlw2m7"),
        "Preprod"
    );
    tempLucid.selectWallet.fromSeed(USER1_WALLET_SEED!);
    const user1Address = await tempLucid.wallet().address();
    console.log(`   💰 Destination: ${user1Address.substring(0, 30)}...\n`);

    // Find deposit UTXO
    console.log("🔎 Step 3: Finding deposit UTXO...");
    const [depositTxHash, outputIndexStr] = receipt.depositUtxoRef.split("#");
    const outputIndex = parseInt(outputIndexStr, 10);
    const depositUtxos = await lucid.utxosByOutRef([{ txHash: depositTxHash, outputIndex }]);

    if (depositUtxos.length === 0) {
        throw new Error(`Deposit UTXO not found: ${receipt.depositUtxoRef}`);
    }

    const depositUtxo = depositUtxos[0];
    console.log(`   ✅ Deposit UTXO found`);
    console.log(`   Amount: ${Number(depositUtxo.assets.lovelace) / 1_000_000} ADA\n`);

    // Find lending pool UTXO
    console.log("🔎 Step 4: Finding lending pool UTXO...");
    const poolUtxo = await findLendingPoolUtxo(
        lucid,
        LENDING_POOL_V3_ADDRESS!,
        BEACON_POLICY_ID!
    );

    if (!poolUtxo) {
        throw new Error("Lending pool UTXO not found");
    }

    // Re-query raw pool UTXO
    const rawPoolUtxos = await lucid.utxosByOutRef([{
        txHash: poolUtxo.txHash,
        outputIndex: poolUtxo.outputIndex
    }]);

    if (rawPoolUtxos.length === 0) {
        throw new Error("Failed to re-query pool UTXO");
    }

    const rawPoolUtxo = rawPoolUtxos[0];
    console.log(`   ✅ Pool UTXO found`);
    console.log(`   Balance: ${Number(rawPoolUtxo.assets.lovelace) / 1_000_000} ADA`);
    console.log(`   Total Deposited: ${Number(poolUtxo.datum.total_deposited) / 1_000_000} ADA`);
    console.log(`   Total Borrowed: ${Number(poolUtxo.datum.total_borrowed) / 1_000_000} ADA\n`);

    // Prepare loan parameters
    const loanAmount = 50_000_000; // 50 ADA (50% LTV - safe)
    console.log("📊 Step 5: Preparing loan parameters...");
    console.log(`   Loan Amount: ${loanAmount / 1_000_000} ADA`);
    console.log(`   Max Loan (80% LTV): ${(receipt.collateralAmount * 0.8) / 1_000_000} ADA\n`);

    // Load validator
    console.log("📜 Step 6: Loading validator...");

    // Load plutus.json directly
    const plutusJson = JSON.parse(
        await Deno.readTextFile("/Users/dominiktilman/ZK-Defi-Protocol/contracts/plutus.json")
    );

    // Find lending_pool_v3 validator
    const validator = plutusJson.validators.find((v: any) =>
        v.title === "lending_pool_v3.lending_pool_v3.spend"
    );

    if (!validator) {
        throw new Error("Lending Pool V3 validator not found in plutus.json");
    }

    // Extract admin key hash
    const adminAddressDetails = getAddressDetails(adminAddress);
    if (!adminAddressDetails.paymentCredential?.hash) {
        throw new Error("Invalid admin address: no payment credential");
    }
    const adminKeyHash = adminAddressDetails.paymentCredential.hash;

    // Build params
    const params = Data.to({
        beacon_policy: BEACON_POLICY_ID,
        admin_key_hash: adminKeyHash,
    }, DepositContractParamsSchema);

    // Apply parameters to validator
    const parameterizedPoolScript = applyParamsToScript(
        validator.compiledCode,
        [params]
    );

    const poolValidator = {
        type: "PlutusV3" as const,  // ← THE FIX!
        script: parameterizedPoolScript,
    };

    console.log(`   ✅ Validator loaded (PlutusV3)\n`);

    // Build updated pool datum
    console.log("🔨 Step 7: Building transaction...");
    const newTotalBorrowed = BigInt(poolUtxo.datum.total_borrowed) + BigInt(loanAmount);

    const updatedPoolDatum = Data.to({
        total_deposited: BigInt(poolUtxo.datum.total_deposited),
        total_borrowed: newTotalBorrowed,
        interest_rate: BigInt(poolUtxo.datum.interest_rate),
        last_updated: BigInt(Date.now()),
    } as any, V3LendingPoolDatumSchema);

    // Build redeemer (BorrowAnonymous)
    const proofHash = "0000000000000000000000000000000000000000000000000000000000000000"; // Mock for testing

    const poolRedeemerWrong = Data.to({
        BorrowAnonymous: [
            [depositUtxo.txHash, BigInt(depositUtxo.outputIndex)], // collateral_ref
            proofHash,                                              // zk_proof_hash
            BigInt(loanAmount),                                     // loan_amount
        ],
    } as any, V3LendingPoolRedeemerSchema);

    // Manual CBOR fix for OutputReference
    const poolRedeemer = poolRedeemerWrong.replace(/^(d87a9f)9f/, '$1d8799f');

    const beaconUnit = BEACON_POLICY_ID + "4c454e44494e47504f4f4c";

    console.log(`   🔍 Pool redeemer (CBOR): ${poolRedeemer.substring(0, 40)}...`);
    console.log(`   🔍 Updated datum (CBOR): ${updatedPoolDatum.substring(0, 40)}...\n`);

    // Build transaction - THIS IS THE CRITICAL TEST!
    console.log("🎯 Step 8: Building borrow transaction (CRITICAL!)...");
    console.log("   This operation has NEVER succeeded before!");
    console.log("   With PlutusV3 fix, it should work now...\n");

    const tx = await lucid
        .newTx()
        .attach.Script(poolValidator)
        .collectFrom([rawPoolUtxo], poolRedeemer)
        .readFrom([depositUtxo])
        .pay.ToContract(
            LENDING_POOL_V3_ADDRESS!,
            { kind: "inline", value: updatedPoolDatum },
            {
                lovelace: BigInt(rawPoolUtxo.assets.lovelace) - BigInt(loanAmount),
                [beaconUnit]: 1n,
            }
        )
        .pay.ToAddress(user1Address, { lovelace: BigInt(loanAmount) })
        .complete();

    console.log("   ✅ ✅ ✅ TRANSACTION BUILT SUCCESSFULLY! ✅ ✅ ✅\n");
    console.log("   This means PlutusV3 fix is working!\n");

    // Sign and submit
    console.log("✍️  Step 9: Signing transaction...");
    const signedTx = await tx.sign.withWallet().complete();
    const txHash = signedTx.toHash();
    console.log(`   ✅ Transaction signed: ${txHash}\n`);

    console.log("📤 Step 10: Submitting transaction...");
    await signedTx.submit();
    console.log(`   ✅ Transaction submitted!\n`);

    console.log("⏳ Step 11: Waiting for confirmation...");
    await lucid.awaitTx(txHash);
    console.log(`   ✅ Transaction confirmed!\n`);

    console.log("═══════════════════════════════════════════════════════");
    console.log("✅ ✅ ✅ BORROW SUCCESSFUL! ✅ ✅ ✅");
    console.log("═══════════════════════════════════════════════════════\n");

    console.log("📋 Transaction Details:");
    console.log(`   TX Hash: ${txHash}`);
    console.log(`   Loan Amount: ${loanAmount / 1_000_000} ADA`);
    console.log(`   Collateral: ${receipt.collateralAmount / 1_000_000} ADA`);
    console.log(`   New Total Borrowed: ${Number(newTotalBorrowed) / 1_000_000} ADA\n`);

    console.log("🔗 Explorer Link:");
    console.log(`   https://preprod.cardanoscan.io/transaction/${txHash}\n`);

    console.log("💡 THE FIX THAT WORKED:");
    console.log("   - Changed Script type from PlutusV2 → PlutusV3");
    console.log("   - Aiken v1.1.15 only compiles to PlutusV3");
    console.log("   - Validator now executes successfully!");
    console.log("   - This operation has NEVER worked before this fix!\n");

} catch (error) {
    console.error("\n❌ BORROW TEST FAILED:");
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
        console.error("\nStack:", error.stack);
    }
    Deno.exit(1);
}
