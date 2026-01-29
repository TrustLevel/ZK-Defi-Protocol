/**
 * V3 Backend: Anonymous Repay Handler
 *
 * Handles anonymous repayment requests:
 * 1. Receives repayment request from user (with ZK proof)
 * 2. Verifies proof offchain
 * 3. Verifies repayment amount (principal + interest)
 * 4. Builds and signs transaction with admin wallet
 * 5. Unlocks deposit (UnlockDeposit redeemer)
 * 6. Updates pool (decreases total_borrowed)
 * 7. Submits transaction to blockchain
 */

import { Lucid, Blockfrost, Data, UTxO } from "@lucid-evolution/lucid";
import {
    NETWORK,
    BLOCKFROST_PROJECT_ID,
    LUCID_NETWORK,
    ADMIN_WALLET_SEED,
    COLLATERAL_V3_ADDRESS,
    LENDING_POOL_V3_ADDRESS,
    BEACON_POLICY_ID,
    calculateInterest,
    calculateRepaymentAmount,
} from "../../lib/config.ts";
import {
    V3LendingPoolDatumSchema,
    V3LendingPoolRedeemerSchema,
    DepositRedeemerSchema,
    type ZKProof,
    type ProveCollateralPublicSignals,
} from "../../lib/types.ts";
// NOTE: verifyCollateralProof not imported - we use Node.js subprocess instead
// import { verifyCollateralProof } from "../../lib/proof.ts";
import { findLendingPoolUtxo, findDepositUtxo } from "../../lib/query.ts";
import { hashProof } from "../../lib/crypto.ts";

// ============================================
// TYPES
// ============================================

export interface RepayRequest {
    // User-provided data
    depositUtxoRef: string; // Format: "txHash#index"
    repaymentAmount: number; // In lovelace (principal + interest)

    // ZK Proof data
    proof: ZKProof;
    publicSignals: ProveCollateralPublicSignals;
}

export interface RepayResponse {
    success: boolean;
    txHash?: string;
    error?: string;
    details?: {
        collateralAmount: number;
        loanAmount: number;
        interest: number;
        repaymentAmount: number;
        depositUnlocked: boolean;
    };
}

// ============================================
// MAIN HANDLER
// ============================================

/**
 * Handle anonymous repay request
 *
 * @param request - Repay request from user
 * @returns Response with transaction hash or error
 */
export async function handleRepayRequest(
    request: RepayRequest,
): Promise<RepayResponse> {
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("🔐 Processing Anonymous Repay Request");
    console.log("═══════════════════════════════════════════════════════\n");

    try {
        // Validate request
        validateRepayRequest(request);

        // Step 1: Verify ZK proof
        console.log("🔍 Step 1: Verifying ZK proof...");
        const isValidProof = await verifyCollateralProof(
            request.proof,
            request.publicSignals,
        );

        if (!isValidProof) {
            throw new Error("Invalid ZK proof! Proof verification failed.");
        }
        console.log("   ✅ Proof verified successfully\n");

        // Step 2: Initialize Lucid
        console.log("🌐 Step 2: Connecting to Cardano network...");
        const lucid = await Lucid(
            new Blockfrost(
                `https://cardano-${NETWORK.toLowerCase()}.blockfrost.io/api/v0`,
                BLOCKFROST_PROJECT_ID
            ),
            LUCID_NETWORK
        );

        // Load admin wallet
        lucid.selectWallet.fromSeed(ADMIN_WALLET_SEED);
        const adminAddress = await lucid.wallet().address();
        console.log(`   ✅ Admin wallet: ${adminAddress.substring(0, 20)}...\n`);

        // Step 3: Find deposit UTXO
        console.log("🔎 Step 3: Finding deposit UTXO...");
        const depositUtxo = await findDepositUtxo(lucid, request.depositUtxoRef);

        if (!depositUtxo) {
            throw new Error(`Deposit UTXO not found: ${request.depositUtxoRef}`);
        }

        const collateralAmount = Number(depositUtxo.datum.collateral_amount);
        console.log(`   ✅ Deposit found: ${collateralAmount / 1_000_000} ADA\n`);

        // Step 4: Find lending pool UTXO
        console.log("🔎 Step 4: Finding lending pool UTXO...");
        if (!LENDING_POOL_V3_ADDRESS || !BEACON_POLICY_ID) {
            throw new Error("LENDING_POOL_V3_ADDRESS or BEACON_POLICY_ID not set in config");
        }

        const poolUtxo = await findLendingPoolUtxo(
            lucid,
            LENDING_POOL_V3_ADDRESS,
            BEACON_POLICY_ID,
        );

        if (!poolUtxo) {
            throw new Error("Lending pool UTXO not found");
        }

        console.log(`   ✅ Pool found:`);
        console.log(`      Total Deposited: ${Number(poolUtxo.datum.total_deposited) / 1_000_000} ADA`);
        console.log(`      Total Borrowed: ${Number(poolUtxo.datum.total_borrowed) / 1_000_000} ADA\n`);

        // Step 5: Calculate expected repayment
        console.log("📊 Step 5: Calculating expected repayment...");

        // Extract loan amount from public signals
        const loanAmount = parseInt(request.publicSignals.loan_amount);
        const expectedInterest = calculateInterest(loanAmount);
        const expectedRepayment = calculateRepaymentAmount(loanAmount);

        console.log(`   Loan Amount: ${loanAmount / 1_000_000} ADA`);
        console.log(`   Interest (5%): ${expectedInterest / 1_000_000} ADA`);
        console.log(`   Expected Repayment: ${expectedRepayment / 1_000_000} ADA`);
        console.log(`   User Provided: ${request.repaymentAmount / 1_000_000} ADA\n`);

        // Validate repayment amount
        if (request.repaymentAmount < expectedRepayment) {
            throw new Error(
                `Insufficient repayment! ` +
                `Expected: ${expectedRepayment / 1_000_000} ADA, ` +
                `Provided: ${request.repaymentAmount / 1_000_000} ADA`
            );
        }

        console.log("   ✅ Repayment amount validated\n");

        // Step 6: Hash proof for onchain storage
        console.log("🔒 Step 6: Hashing proof for onchain storage...");
        const proofHash = await hashProof(request.proof);
        console.log(`   ✅ Proof hash: ${proofHash.substring(0, 16)}...\n`);

        // Step 7: Build transaction
        console.log("🔨 Step 7: Building repayment transaction...");
        const tx = await buildRepayTransaction(
            lucid,
            depositUtxo,
            poolUtxo,
            loanAmount,
            request.repaymentAmount,
            proofHash,
        );

        console.log("   ✅ Transaction built\n");

        // Step 8: Sign and submit
        console.log("✍️  Step 8: Signing transaction with admin key...");
        const signedTx = await tx.sign.withWallet().complete();
        const txHash = signedTx.toHash();
        console.log(`   ✅ Transaction signed: ${txHash}\n`);

        console.log("📤 Step 9: Submitting transaction...");
        await signedTx.submit();
        console.log(`   ✅ Transaction submitted!\n`);

        // Success response
        console.log("═══════════════════════════════════════════════════════");
        console.log("✅ REPAYMENT SUCCESSFUL!");
        console.log("═══════════════════════════════════════════════════════\n");

        return {
            success: true,
            txHash: txHash,
            details: {
                collateralAmount: collateralAmount,
                loanAmount: loanAmount,
                interest: expectedInterest,
                repaymentAmount: request.repaymentAmount,
                depositUnlocked: true,
            },
        };
    } catch (error: any) {
        console.error("❌ Repay request failed:", error.message);
        return {
            success: false,
            error: error.message,
        };
    }
}

// ============================================
// TRANSACTION BUILDING
// ============================================

async function buildRepayTransaction(
    lucid: Awaited<ReturnType<typeof Lucid>>,
    depositUtxo: UTxO & { datum: any },
    poolUtxo: UTxO & { datum: any },
    loanAmount: number,
    repaymentAmount: number,
    proofHash: string,
) {
    // Update pool datum (decrease total_borrowed, increase value)
    const newTotalBorrowed = Number(poolUtxo.datum.total_borrowed) - BigInt(loanAmount);
    const newPoolValue = poolUtxo.assets.lovelace + BigInt(repaymentAmount);

    // Build datum with fields in DECLARATION ORDER (matches Aiken & plutus.json)
    // IMPORTANT: DO NOT wrap! Inline datums are automatically "Some" - Lucid unwraps them automatically
    const updatedPoolDatum = Data.to({
        total_deposited: BigInt(poolUtxo.datum.total_deposited),
        total_borrowed: BigInt(Math.max(0, newTotalBorrowed)), // Ensure non-negative
        interest_rate: BigInt(poolUtxo.datum.interest_rate),
        last_updated: BigInt(Date.now()),
    } as any, V3LendingPoolDatumSchema);

    // Build redeemer for pool (RepayAnonymous)
    const poolRedeemer = Data.to({
        RepayAnonymous: {
            deposit_ref: {
                transaction_id: { hash: depositUtxo.txHash },
                output_index: BigInt(depositUtxo.outputIndex),
            },
            zk_proof_hash: proofHash,
            repay_amount: BigInt(repaymentAmount),
        },
    }, V3LendingPoolRedeemerSchema);

    // Build redeemer for deposit (UnlockDeposit)
    const depositRedeemer = Data.to({
        UnlockDeposit: {
            zk_proof_hash: proofHash,
        },
    }, DepositRedeemerSchema);

    // Beacon units
    const poolBeaconUnit = BEACON_POLICY_ID + "4c454e44494e47504f4f4c"; // "LENDINGPOOL"

    // Build transaction
    return await lucid
        .newTx()
        // Spend pool UTXO with RepayAnonymous redeemer
        .collectFrom([poolUtxo], poolRedeemer)
        // Spend deposit UTXO with UnlockDeposit redeemer (unlocks collateral)
        .collectFrom([depositUtxo], depositRedeemer)
        // Return pool UTXO with updated datum and increased value
        .pay.ToContract(
            LENDING_POOL_V3_ADDRESS,
            { kind: "inline", value: updatedPoolDatum },
            {
                lovelace: newPoolValue,
                [poolBeaconUnit]: 1n,
            }
        )
        // Return deposit UTXO (now unlocked, ready for withdraw)
        .pay.ToContract(
            COLLATERAL_V3_ADDRESS,
            { kind: "inline", value: Data.to(depositUtxo.datum, depositUtxo.datum.constructor) },
            {
                lovelace: depositUtxo.assets.lovelace,
            }
        )
        .complete();
}

// ============================================
// VALIDATION
// ============================================

function validateRepayRequest(request: RepayRequest): void {
    if (!request.depositUtxoRef) {
        throw new Error("Missing depositUtxoRef");
    }

    if (!request.repaymentAmount || request.repaymentAmount <= 0) {
        throw new Error("Invalid repayment amount");
    }

    if (!request.proof) {
        throw new Error("Missing ZK proof");
    }

    if (!request.publicSignals) {
        throw new Error("Missing public signals");
    }

    // Validate UTXO ref format
    const [txHash, index] = request.depositUtxoRef.split("#");
    if (!txHash || !index || isNaN(parseInt(index))) {
        throw new Error("Invalid UTXO reference format. Expected: txHash#index");
    }

    // Validate loan amount from public signals
    if (!request.publicSignals.loan_amount) {
        throw new Error("Missing loan_amount in public signals");
    }

    const loanAmount = parseInt(request.publicSignals.loan_amount);
    if (isNaN(loanAmount) || loanAmount <= 0) {
        throw new Error("Invalid loan_amount in public signals");
    }
}
