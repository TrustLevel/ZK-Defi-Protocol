#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * TEST SIMPLE POOL (NO PARAMETERS!)
 * Step 1: Initialize pool with 100 ADA
 * Step 2: Deposit 50 ADA
 * Step 3: Withdraw 20 ADA (admin only)
 */

import { Lucid, Blockfrost, Data, validatorToAddress, getAddressDetails } from "@lucid-evolution/lucid";

const PREPROD_BLOCKFROST = Deno.env.get("PREPROD_BLOCKFROST")!;
const ADMIN_WALLET_SEED = Deno.env.get("ADMIN_WALLET_SEED")!;
const USER1 = "addr_test1qp390j3nd3ft4r7lr349tlakgnrlfmx45yz49g3edy2z4njdwfc7eln8wq4d4dmatfclluzexr53mjejgwfs5hkmxkxs7ekjak";

console.log("═══════════════════════════════════════════════════════");
console.log("🧪 TEST SIMPLE POOL (NO PARAMETERS!)");
console.log("═══════════════════════════════════════════════════════\n");

try {
    const lucid = await Lucid(
        new Blockfrost(PREPROD_BLOCKFROST, "blockfrost1he7uy2whn7zfqzlw2m7"),
        "Preprod"
    );
    lucid.selectWallet.fromSeed(ADMIN_WALLET_SEED);
    const adminAddress = await lucid.wallet().address();

    console.log("📜 Loading validator...");
    const plutusJson = JSON.parse(
        await Deno.readTextFile("/Users/dominiktilman/ZK-Defi-Protocol/contracts/plutus.json")
    );

    const validator = plutusJson.validators.find((v: any) =>
        v.title === "pool_simple.pool_simple.spend"
    );

    if (!validator) throw new Error("Validator not found");

    // NO PARAMETERS!
    const script = {
        type: "PlutusV3" as const,
        script: validator.compiledCode,
    };

    const address = validatorToAddress("Preprod", script);
    console.log(`   ✅ Address: ${address}\n`);

    // Get admin key hash
    const adminDetails = getAddressDetails(adminAddress);
    const adminKeyHash = adminDetails.paymentCredential!.hash;

    // Datum schema
    const SimplePoolDatumSchema = Data.Object({
        admin_key_hash: Data.Bytes(),
        total_deposited: Data.Integer(),
    });

    // Redeemer schemas
    const DepositRedeemer = Data.Literal("Deposit");
    const WithdrawRedeemer = Data.Object({
        Withdraw: Data.Object({
            amount: Data.Integer(),
        }),
    });

    // STEP 1: Initialize pool with 100 ADA
    console.log("💰 Step 1: Initialize pool with 100 ADA...");
    const initialDatum = Data.to({
        admin_key_hash: adminKeyHash,
        total_deposited: 100_000_000n,
    }, SimplePoolDatumSchema);

    const initTx = await lucid
        .newTx()
        .pay.ToContract(
            address,
            { kind: "inline", value: initialDatum },
            { lovelace: 100_000_000n }
        )
        .complete();

    const initSigned = await initTx.sign.withWallet().complete();
    const initHash = await initSigned.submit();
    console.log(`   ✅ TX: ${initHash}`);
    console.log(`   ⏳ Waiting...\n`);
    await lucid.awaitTx(initHash);
    console.log(`   ✅ Confirmed!\n`);

    // STEP 2: Deposit 50 ADA
    console.log("💵 Step 2: Deposit 50 ADA...");
    const utxos1 = await lucid.utxosAt(address);
    const poolUtxo1 = utxos1[0];

    const depositRedeemer = Data.to("Deposit", DepositRedeemer);

    const newDatumAfterDeposit = Data.to({
        admin_key_hash: adminKeyHash,
        total_deposited: 150_000_000n,  // 100 + 50
    }, SimplePoolDatumSchema);

    const depositTx = await lucid
        .newTx()
        .attach.Script(script)
        .collectFrom([poolUtxo1], depositRedeemer)
        .pay.ToContract(
            address,
            { kind: "inline", value: newDatumAfterDeposit },
            { lovelace: 150_000_000n }  // 100 + 50
        )
        .complete();

    const depositSigned = await depositTx.sign.withWallet().complete();
    const depositHash = await depositSigned.submit();
    console.log(`   ✅ TX: ${depositHash}\n`);
    await lucid.awaitTx(depositHash);
    console.log(`   ✅ Confirmed!\n`);

    // STEP 3: Withdraw 20 ADA (admin only)
    console.log("💸 Step 3: Withdraw 20 ADA (admin)...");
    const utxos2 = await lucid.utxosAt(address);
    const poolUtxo2 = utxos2[0];

    const withdrawRedeemer = Data.to({
        Withdraw: { amount: 20_000_000n }
    }, WithdrawRedeemer);

    const newDatumAfterWithdraw = Data.to({
        admin_key_hash: adminKeyHash,
        total_deposited: 130_000_000n,  // 150 - 20
    }, SimplePoolDatumSchema);

    const withdrawTx = await lucid
        .newTx()
        .attach.Script(script)
        .collectFrom([poolUtxo2], withdrawRedeemer)
        .addSigner(adminAddress)  // Admin signature required
        .pay.ToContract(
            address,
            { kind: "inline", value: newDatumAfterWithdraw },
            { lovelace: 130_000_000n }  // 150 - 20
        )
        .pay.ToAddress(USER1, { lovelace: 20_000_000n })  // Send to user
        .complete();

    const withdrawSigned = await withdrawTx.sign.withWallet().complete();
    const withdrawHash = await withdrawSigned.submit();
    console.log(`   ✅ TX: ${withdrawHash}\n`);

    console.log("═══════════════════════════════════════════════════════");
    console.log("✅ ✅ ✅ SIMPLE POOL WORKS! ✅ ✅ ✅");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log(`Init:     https://preprod.cardanoscan.io/transaction/${initHash}`);
    console.log(`Deposit:  https://preprod.cardanoscan.io/transaction/${depositHash}`);
    console.log(`Withdraw: https://preprod.cardanoscan.io/transaction/${withdrawHash}\n`);

} catch (error) {
    console.error("\n❌ FAILED:");
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
}
