#!/usr/bin/env -S deno run --allow-all --env --unstable-detect-cjs
/**
 * STEP 2: Deposit 50 ADA to simple pool
 */

import { Lucid, Blockfrost, Data, validatorToAddress, getAddressDetails } from "@lucid-evolution/lucid";

const PREPROD_BLOCKFROST = Deno.env.get("PREPROD_BLOCKFROST")!;
const ADMIN_WALLET_SEED = Deno.env.get("ADMIN_WALLET_SEED")!;

console.log("═══════════════════════════════════════════════════════");
console.log("💵 STEP 2: Deposit 50 ADA");
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

    // Find pool UTXO
    console.log("🔎 Finding pool UTXO...");
    const utxos = await lucid.utxosAt(address);
    if (utxos.length === 0) throw new Error("No pool UTXO found");

    const poolUtxo = utxos[0];
    console.log(`   Found: ${Number(poolUtxo.assets.lovelace) / 1_000_000} ADA\n`);

    // Deposit redeemer - Constructor with tag 0 (Deposit is first variant)
    const SimplePoolRedeemerSchema = Data.Enum([
        Data.Literal("Deposit"),
        Data.Object({ Withdraw: Data.Object({ amount: Data.Integer() }) }),
    ]);
    const depositRedeemer = Data.to("Deposit", SimplePoolRedeemerSchema);

    const newDatum = Data.to({
        admin_key_hash: adminKeyHash,
        total_deposited: 150_000_000n,  // 100 + 50
    }, SimplePoolDatumSchema);

    console.log("🔨 Building deposit transaction...");
    const depositTx = await lucid
        .newTx()
        .attach.Script(script)
        .collectFrom([poolUtxo], depositRedeemer)
        .pay.ToContract(
            address,
            { kind: "inline", value: newDatum },
            { lovelace: 150_000_000n }  // 100 + 50
        )
        .complete();

    console.log("   ✅ Transaction built!\n");

    const depositSigned = await depositTx.sign.withWallet().complete();
    const depositHash = await depositSigned.submit();

    console.log(`   ✅ TX: ${depositHash}\n`);

    console.log("═══════════════════════════════════════════════════════");
    console.log("✅ DEPOSIT SUCCESS!");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log(`🔗 https://preprod.cardanoscan.io/transaction/${depositHash}\n`);

} catch (error) {
    console.error("\n❌ FAILED:");
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
}
