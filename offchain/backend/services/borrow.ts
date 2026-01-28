/**
 * V3 Backend: Anonymous Borrow Handler
 *
 * Handles anonymous borrow requests:
 * 1. Receives borrow request from user (with ZK proof)
 * 2. Verifies proof offchain
 * 3. Builds and signs transaction with admin wallet
 * 4. Submits transaction to blockchain
 */

import { Lucid, Blockfrost, Data, UTxO } from "@lucid-evolution/lucid";
import {
    NETWORK,
    BLOCKFROST_PROJECT_ID,
    BLOCKFROST_API_KEY,
    PREPROD_BLOCKFROST,
    LUCID_NETWORK,
    ADMIN_WALLET_SEED,
    COLLATERAL_V3_ADDRESS as _COLLATERAL_V3_ADDRESS,
    LENDING_POOL_V3_ADDRESS,
    BEACON_POLICY_ID,
    BACKEND_SERVICE_FEE,
    calculateMaxLoan,
    calculateInterest,
} from "../../lib/config.ts";
import {
    V3LendingPoolDatumSchema,
    V3LendingPoolRedeemerSchema,
    type ZKProof,
    type ProveCollateralPublicSignals,
} from "../../lib/types.ts";
// NOTE: verifyCollateralProof not imported - we use Node.js subprocess instead
// import { verifyCollateralProof } from "../../lib/proof.ts";
import { findLendingPoolUtxo, findDepositUtxo } from "../../lib/query.ts";
import { hashProof } from "../../lib/crypto.ts";
import { ZK_VKEY } from "../../lib/config.ts";
import { getLendingPoolV3Validator } from "../../lib/validators.ts";

// ============================================
// PROOF VERIFICATION (Node.js Subprocess)
// ============================================

/**
 * Verify ZK proof using Node.js subprocess
 *
 * This is a workaround for Deno's Web Worker incompatibility with snarkjs.
 * We spawn a Node.js process to verify the proof using snarkjs.
 *
 * @param proof - ZK proof to verify
 * @param publicSignals - Public signals from proof generation
 * @returns true if proof is valid, false otherwise
 */
async function verifyProofViaNode(
    proof: ZKProof,
    publicSignals: ProveCollateralPublicSignals,
): Promise<boolean> {
    try {
        console.log("🔍 Verifying proof via Node.js subprocess...");

        // Convert public signals to array format
        const signalsArray = [
            publicSignals.commitment,
            publicSignals.loan_amount,
            publicSignals.collateral_ratio,
        ];

        // Spawn Node.js process
        const command = new Deno.Command("node", {
            args: [
                "../../circuits/verify-proof-node.mjs",
                ZK_VKEY,
                JSON.stringify(proof),
                JSON.stringify(signalsArray),
            ],
            stdout: "piped",
            stderr: "piped",
        });

        const { code, stdout, stderr } = await command.output();

        if (code !== 0) {
            const errorMsg = new TextDecoder().decode(stderr);
            console.error("   ❌ Node.js verification failed:");
            try {
                const errorJson = JSON.parse(errorMsg);
                console.error(`      Error: ${errorJson.error}`);
            } catch {
                console.error(`      ${errorMsg}`);
            }
            return false;
        }

        // Parse result
        const resultText = new TextDecoder().decode(stdout);
        const result = JSON.parse(resultText);

        if (result.valid) {
            console.log("   ✅ Proof verified successfully (Node.js)");
        } else {
            console.log("   ❌ Proof is INVALID");
        }

        return result.valid;

    } catch (error) {
        console.error("   ❌ Proof verification error:", error);
        return false;
    }
}

// ============================================
// TYPES
// ============================================

export interface BorrowRequest {
    // User-provided data
    depositUtxoRef: string; // Format: "txHash#index"
    loanAmount: number; // In lovelace
    destinationAddress: string; // Where to send the loan

    // ZK Proof data
    proof: ZKProof;
    publicSignals: ProveCollateralPublicSignals;
}

export interface BorrowResponse {
    success: boolean;
    txHash?: string;
    error?: string;
    details?: {
        collateralAmount: number;
        loanAmount: number;
        interest: number;
        serviceFee: number;
        totalBorrowed: number;
    };
}

// ============================================
// MAIN HANDLER
// ============================================

/**
 * Handle anonymous borrow request
 *
 * @param request - Borrow request from user
 * @returns Response with transaction hash or error
 */
export async function handleBorrowRequest(
    request: BorrowRequest,
): Promise<BorrowResponse> {
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("🔐 Processing Anonymous Borrow Request");
    console.log("═══════════════════════════════════════════════════════\n");

    try {
        // Validate request
        validateBorrowRequest(request);

        // Step 1: Verify ZK proof (using Node.js subprocess)
        console.log("🔍 Step 1: Verifying ZK proof...");
        const isValidProof = await verifyProofViaNode(
            request.proof,
            request.publicSignals,
        );

        if (!isValidProof) {
            throw new Error("Invalid ZK proof! Proof verification failed.");
        }
        console.log("   ✅ Proof verified successfully\n");

        // Step 2: Initialize Lucid
        console.log("🌐 Step 2: Connecting to Cardano network...");
        console.log(`   Network: ${NETWORK}`);
        console.log(`   Blockfrost URL: https://cardano-${NETWORK.toLowerCase()}.blockfrost.io/api/v0`);
        console.log(`   Lucid Network: ${LUCID_NETWORK}`);

        // Use BLOCKFROST_API_KEY if BLOCKFROST_PROJECT_ID is not set
        const blockfrostApiKey = BLOCKFROST_PROJECT_ID || BLOCKFROST_API_KEY;
        console.log(`   Blockfrost API Key: ${blockfrostApiKey ? blockfrostApiKey.substring(0, 15) + "..." : "NOT SET"}`);

        if (!blockfrostApiKey) {
            throw new Error("BLOCKFROST_PROJECT_ID or BLOCKFROST_API_KEY must be set");
        }

        let lucid;
        try {
            console.log(`   Initializing Blockfrost provider...`);

            // Use Demeter endpoint for Preprod (has complete protocol parameters)
            const blockfrostUrl = PREPROD_BLOCKFROST || `https://cardano-${NETWORK.toLowerCase()}.blockfrost.io/api/v0`;
            console.log(`   Blockfrost URL: ${blockfrostUrl}`);

            const blockfrostProvider = new Blockfrost(
                blockfrostUrl,
                blockfrostApiKey
            );
            console.log(`   ✅ Blockfrost provider created`);

            console.log(`   Initializing Lucid...`);
            lucid = await Lucid(blockfrostProvider, LUCID_NETWORK);
            console.log(`   ✅ Lucid initialized`);
        } catch (error) {
            console.error(`   ❌ Lucid initialization error:`, error);
            throw new Error(`Failed to initialize Lucid: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Load admin wallet
        console.log(`   Loading admin wallet...`);
        lucid.selectWallet.fromSeed(ADMIN_WALLET_SEED);
        const adminAddress = await lucid.wallet().address();
        console.log(`   ✅ Admin wallet: ${adminAddress.substring(0, 20)}...\n`);

        // Step 3: Find deposit UTXO
        console.log("🔎 Step 3: Finding deposit UTXO...");

        // First get the raw UTXO (for readFrom)
        const [depositTxHash, outputIndexStr] = request.depositUtxoRef.split("#");
        const outputIndex = parseInt(outputIndexStr, 10);
        const rawDepositUtxos = await lucid.utxosByOutRef([{ txHash: depositTxHash, outputIndex }]);

        if (rawDepositUtxos.length === 0) {
            throw new Error(`Deposit UTXO not found: ${request.depositUtxoRef}`);
        }

        const rawDepositUtxo = rawDepositUtxos[0];

        // Define BigInt replacer for logging
        const bigIntReplacer = (_key: string, value: any) =>
            typeof value === 'bigint' ? value.toString() : value;

        // Now get the parsed version (for datum access)
        let depositUtxo;
        try {
            depositUtxo = await findDepositUtxo(lucid, request.depositUtxoRef);
        } catch (error: any) {
            // Safely serialize error message (avoiding BigInt serialization issues)
            const errorMsg = error?.message || String(error);
            throw new Error(`Failed to find deposit UTXO: ${errorMsg}`);
        }

        if (!depositUtxo) {
            throw new Error(`Deposit UTXO not found: ${request.depositUtxoRef}`);
        }

        // Debug: Check datum structure (convert BigInt to string for logging)
        console.log(`   📋 Deposit UTXO datum:`, JSON.stringify(depositUtxo.datum, bigIntReplacer, 2));

        if (!depositUtxo.datum || !depositUtxo.datum.collateral_amount) {
            throw new Error(
                `Deposit UTXO has invalid datum. Datum: ${JSON.stringify(depositUtxo.datum, bigIntReplacer)}`
            );
        }

        const collateralAmount = Number(depositUtxo.datum.collateral_amount);
        console.log(`   ✅ Deposit found: ${collateralAmount / 1_000_000} ADA\n`);

        // Step 4: Find lending pool UTXO
        console.log("🔎 Step 4: Finding lending pool UTXO...");
        if (!LENDING_POOL_V3_ADDRESS || !BEACON_POLICY_ID) {
            throw new Error("LENDING_POOL_V3_ADDRESS or BEACON_POLICY_ID not set in config");
        }

        // First get raw pool UTXOs
        const poolUtxos = await lucid.utxosAt(LENDING_POOL_V3_ADDRESS);
        const beaconUnit = BEACON_POLICY_ID + "4c454e44494e47504f4f4c"; // "LENDINGPOOL"
        const rawPoolUtxo = poolUtxos.find((utxo) => utxo.assets[beaconUnit] === 1n);

        if (!rawPoolUtxo) {
            throw new Error("Lending pool UTXO not found");
        }

        // Now get the parsed version
        const poolUtxo = await findLendingPoolUtxo(
            lucid,
            LENDING_POOL_V3_ADDRESS,
            BEACON_POLICY_ID,
        );

        if (!poolUtxo) {
            throw new Error("Lending pool UTXO not found");
        }

        // Debug: Check pool datum structure (convert BigInt to string for logging)
        console.log(`   📋 Pool UTXO datum:`, JSON.stringify(poolUtxo.datum, bigIntReplacer, 2));

        if (!poolUtxo.datum || poolUtxo.datum.total_deposited === undefined || poolUtxo.datum.total_borrowed === undefined) {
            throw new Error(
                `Pool UTXO has invalid datum. Datum: ${JSON.stringify(poolUtxo.datum, bigIntReplacer)}`
            );
        }

        console.log(`   ✅ Pool found:`);
        console.log(`      Total Deposited: ${Number(poolUtxo.datum.total_deposited) / 1_000_000} ADA`);
        console.log(`      Total Borrowed: ${Number(poolUtxo.datum.total_borrowed) / 1_000_000} ADA\n`);

        // Step 5: Validate loan amount
        console.log("📊 Step 5: Validating loan amount...");
        const maxLoan = calculateMaxLoan(collateralAmount);
        if (request.loanAmount > maxLoan) {
            throw new Error(
                `Loan amount (${request.loanAmount / 1_000_000} ADA) exceeds max LTV ` +
                `(${maxLoan / 1_000_000} ADA at 80%)`
            );
        }

        // Check pool liquidity (use actual UTXO balance, not just tracked deposits)
        // The pool UTXO contains both initial liquidity and user deposits
        // Use rawPoolUtxo for balance (has .assets), poolUtxo for datum (parsed)
        const poolBalance = Number(rawPoolUtxo.assets.lovelace);
        const totalBorrowed = Number(poolUtxo.datum.total_borrowed);
        const available = poolBalance - totalBorrowed;

        console.log(`   💰 Pool Balance: ${poolBalance / 1_000_000} ADA`);
        console.log(`   📊 Total Borrowed: ${totalBorrowed / 1_000_000} ADA`);
        console.log(`   ✅ Available: ${available / 1_000_000} ADA`);

        if (request.loanAmount > available) {
            throw new Error(
                `Insufficient liquidity in pool. ` +
                `Available: ${available / 1_000_000} ADA, ` +
                `Requested: ${request.loanAmount / 1_000_000} ADA`
            );
        }

        const interest = calculateInterest(request.loanAmount);
        console.log(`   ✅ Loan validated:`);
        console.log(`      Loan Amount: ${request.loanAmount / 1_000_000} ADA`);
        console.log(`      Interest (5%): ${interest / 1_000_000} ADA`);
        console.log(`      Max Loan: ${maxLoan / 1_000_000} ADA\n`);

        // Step 6: Hash proof for onchain storage
        console.log("🔒 Step 6: Hashing proof for onchain storage...");
        const proofHash = await hashProof(request.proof);
        console.log(`   ✅ Proof hash: ${proofHash.substring(0, 16)}...\n`);

        // Step 7: Build transaction
        console.log("🔨 Step 7: Building transaction...");
        const tx = await buildBorrowTransaction(
            lucid,
            adminAddress,    // Admin address for validator parameters
            rawDepositUtxo,  // Use raw UTXO for .readFrom()
            depositUtxo,     // Use parsed UTXO for datum access
            rawPoolUtxo,     // Use raw UTXO for .collectFrom()
            poolUtxo,        // Use parsed UTXO for datum access
            request.loanAmount,
            request.destinationAddress,
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
        const newTotalBorrowedAmount = Number(poolUtxo.datum.total_borrowed) + request.loanAmount;

        console.log("═══════════════════════════════════════════════════════");
        console.log("✅ BORROW SUCCESSFUL!");
        console.log("═══════════════════════════════════════════════════════\n");

        return {
            success: true,
            txHash: txHash,
            details: {
                collateralAmount: collateralAmount,
                loanAmount: request.loanAmount,
                interest: interest,
                serviceFee: BACKEND_SERVICE_FEE,
                totalBorrowed: newTotalBorrowedAmount,
            },
        };
    } catch (error: any) {
        console.error("❌ Borrow request failed:", error.message);
        return {
            success: false,
            error: error.message,
        };
    }
}

// ============================================
// TRANSACTION BUILDING
// ============================================

async function buildBorrowTransaction(
    lucid: Awaited<ReturnType<typeof Lucid>>,
    adminAddress: string,  // Admin address for validator parameters
    rawDepositUtxo: UTxO,  // Raw UTXO for .readFrom()
    depositUtxo: UTxO & { datum: any },  // Parsed UTXO for datum access
    rawPoolUtxo: UTxO,  // Raw UTXO for .collectFrom()
    poolUtxo: UTxO & { datum: any },  // Parsed UTXO for datum access
    loanAmount: number,
    destinationAddress: string,
    proofHash: string,
) {
    try {
        // Load validator script (with admin parameters)
        console.log("   📜 Loading Lending Pool V3 validator...");
        console.log(`   🔍 Expected pool address: ${LENDING_POOL_V3_ADDRESS}`);
        const poolValidator = await getLendingPoolV3Validator(lucid, adminAddress);
        console.log("   ✅ Validator loaded (parametrized with admin key)");

        // Update pool datum (increase total_borrowed, update timestamp)
        console.log("   🔨 Building pool datum...");
        const newTotalBorrowed = BigInt(poolUtxo.datum.total_borrowed) + BigInt(loanAmount);

        // Debug: Log datum values
        console.log("   📊 Pool datum values:");
        console.log(`      total_deposited: ${poolUtxo.datum.total_deposited}`);
        console.log(`      total_borrowed: ${poolUtxo.datum.total_borrowed} -> ${newTotalBorrowed}`);
        console.log(`      interest_rate: ${poolUtxo.datum.interest_rate}`);
        console.log(`      last_updated: ${poolUtxo.datum.last_updated} -> ${Date.now()}`);

        // Build datum with fields in DECLARATION ORDER (matches Aiken & plutus.json)
        const updatedPoolDatum = Data.to({
            total_deposited: BigInt(poolUtxo.datum.total_deposited),
            total_borrowed: newTotalBorrowed,
            interest_rate: BigInt(poolUtxo.datum.interest_rate),
            last_updated: BigInt(Date.now()),
        } as any, V3LendingPoolDatumSchema);

        // Debug: Log serialized CBOR
        console.log("   🔍 Pool datum CBOR (hex):");
        console.log(`      ${updatedPoolDatum}`);
        console.log(`      Length: ${updatedPoolDatum.length} characters`);

        console.log("   ✅ Pool datum created");

        // Build redeemer for pool
        console.log("   🔨 Building pool redeemer...");

        // Debug: Log input data
        console.log("   📊 Redeemer input data:");
        console.log(`      depositUtxo.txHash: ${depositUtxo.txHash}`);
        console.log(`      depositUtxo.outputIndex: ${depositUtxo.outputIndex}`);
        console.log(`      proofHash: ${proofHash}`);
        console.log(`      loanAmount: ${loanAmount}`);

        // Build redeemer: BorrowAnonymous with plain array (will be fixed manually)
        // Alphabetically: collateral_ref, loan_amount, zk_proof_hash
        const poolRedeemerWrong = Data.to({
            BorrowAnonymous: [
                [depositUtxo.txHash, BigInt(depositUtxo.outputIndex)], // Plain array (wrong!)
                BigInt(loanAmount),
                proofHash,
            ],
        } as any, V3LendingPoolRedeemerSchema);

        // Manual CBOR fix: Replace plain array (9f) with Constructor 0 (d8799f) for OutputReference
        // Current: d87a9f 9f 5820...00 ff 1a... 5820... ff
        // Fixed:   d87a9f d8799f 5820...00 ff 1a... 5820... ff
        const poolRedeemer = poolRedeemerWrong.replace(/^(d87a9f)9f/, '$1d8799f');

        // Debug: Log CBOR
        console.log("   🔍 Redeemer CBOR:");
        console.log(`      Before fix: ${poolRedeemerWrong.substring(0, 60)}...`);
        console.log(`      After fix:  ${poolRedeemer.substring(0, 60)}...`);
        console.log(`      Fixed: Plain Array (9f) → Constructor 0 (d8799f)`);

        console.log("   ✅ Pool redeemer created (with manual CBOR fix)");

        // Build transaction
        console.log("   🔨 Building transaction...");
        const beaconUnit = BEACON_POLICY_ID + "4c454e44494e47504f4f4c"; // "LENDINGPOOL"

        // Debug: Log transaction details
        console.log("   📊 Transaction details:");
        console.log(`      Pool input: ${rawPoolUtxo.txHash}#${rawPoolUtxo.outputIndex}`);
        console.log(`      Pool balance: ${Number(rawPoolUtxo.assets.lovelace) / 1_000_000} ADA`);
        console.log(`      Loan amount: ${loanAmount / 1_000_000} ADA`);
        console.log(`      New pool balance: ${(Number(rawPoolUtxo.assets.lovelace) - loanAmount) / 1_000_000} ADA`);
        console.log(`      Deposit ref (readFrom): ${rawDepositUtxo.txHash}#${rawDepositUtxo.outputIndex}`);
        console.log(`      Destination: ${destinationAddress}`);
        console.log(`      Beacon unit: ${beaconUnit}`);

        try {
            return await lucid
                .newTx()
                // Attach validator script (required for spending from script address)
                .attach.Script(poolValidator)
                // Spend pool UTXO with BorrowAnonymous redeemer - use RAW UTXO
                .collectFrom([rawPoolUtxo], poolRedeemer)
                // Reference deposit UTXO (read-only) - use RAW UTXO with original datum
                .readFrom([rawDepositUtxo])
                // Return pool UTXO with updated datum and reduced balance
                .pay.ToContract(
                    LENDING_POOL_V3_ADDRESS,
                    { kind: "inline", value: updatedPoolDatum },
                    {
                        lovelace: BigInt(rawPoolUtxo.assets.lovelace) - BigInt(loanAmount),
                        [beaconUnit]: 1n,
                    }
                )
                // Send loan to user's destination address
                .pay.ToAddress(destinationAddress, { lovelace: BigInt(loanAmount) })
                .complete();
        } catch (txError: any) {
            console.log("   🔍 Transaction building error details:");
            console.log(`      Error type: ${txError.constructor.name}`);
            console.log(`      Error message: ${txError.message}`);
            if (txError.cause) {
                console.log(`      Cause: ${JSON.stringify(txError.cause, null, 2)}`);
            }
            throw txError;
        }
    } catch (error) {
        console.error("   ❌ Transaction building failed:", error);
        throw error;
    }
}

// ============================================
// VALIDATION
// ============================================

function validateBorrowRequest(request: BorrowRequest): void {
    if (!request.depositUtxoRef) {
        throw new Error("Missing depositUtxoRef");
    }

    if (!request.loanAmount || request.loanAmount <= 0) {
        throw new Error("Invalid loan amount");
    }

    if (!request.destinationAddress) {
        throw new Error("Missing destination address");
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

    // Validate Cardano address format
    if (!request.destinationAddress.startsWith("addr")) {
        throw new Error("Invalid Cardano address format");
    }
}
