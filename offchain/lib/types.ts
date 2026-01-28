/**
 * TypeScript Types and Plutus Data Schemas for V3 Protocol
 */

import { Data } from "@lucid-evolution/lucid";

// ============================================================================
// Lending Pool Datum
// ============================================================================

// Pool Datum Schema: Fields in DECLARATION ORDER (matches Aiken definition)
// plutus.json confirms Aiken uses declaration order, NOT alphabetical
export const V3LendingPoolDatumSchema = Data.Object({
    total_deposited: Data.Integer(),
    total_borrowed: Data.Integer(),
    interest_rate: Data.Integer(),
    last_updated: Data.Integer(),
});

export type V3LendingPoolDatum = Data.Static<typeof V3LendingPoolDatumSchema>;

// ============================================================================
// Lending Pool Redeemer
// ============================================================================

// Redeemer schema: Simple Tuple-based (CBOR will be fixed manually in borrow.ts)
// BorrowAnonymous fields (alphabetically sorted in Aiken):
// collateral_ref, loan_amount, zk_proof_hash
// Deposit = 0, BorrowAnonymous = 1, RepayAnonymous = 2
export const V3LendingPoolRedeemerSchema = Data.Enum([
    Data.Object({ Deposit: Data.Tuple([]) }), // Constructor 0
    Data.Object({
        BorrowAnonymous: Data.Tuple([
            Data.Tuple([Data.Bytes(), Data.Integer()]), // collateral_ref (will be fixed to Constructor 0)
            Data.Integer(),  // loan_amount
            Data.Bytes(),    // zk_proof_hash
        ]),
    }), // Constructor 1
    Data.Object({
        RepayAnonymous: Data.Tuple([
            Data.Tuple([Data.Bytes(), Data.Integer()]), // deposit_ref (will be fixed to Constructor 0)
            Data.Integer(),  // repay_amount
            Data.Bytes(),    // zk_proof_hash
        ]),
    }), // Constructor 2
]);

export type V3LendingPoolRedeemer = Data.Static<typeof V3LendingPoolRedeemerSchema>;

// ============================================================================
// Collateral Deposit Datum
// ============================================================================

export const DepositDatumSchema = Data.Object({
    owner: Data.Bytes(),
    collateral_amount: Data.Integer(),
    commitment: Data.Bytes(),
    deposited_at: Data.Integer(),
});

export type DepositDatum = Data.Static<typeof DepositDatumSchema>;

// ============================================================================
// Collateral Deposit Redeemer
// ============================================================================

export const DepositRedeemerSchema = Data.Enum([
    Data.Object({
        UsedAsCollateral: Data.Object({
            loan_id: Data.Bytes(),
        }),
    }),
    Data.Object({
        UnlockDeposit: Data.Object({
            zk_proof_hash: Data.Bytes(),
        }),
    }),
    Data.Literal("Withdraw"),
]);

export type DepositRedeemer = Data.Static<typeof DepositRedeemerSchema>;

// ============================================================================
// Deposit Contract Parameters (for deployment)
// ============================================================================

export const DepositContractParamsSchema = Data.Object({
    beacon_policy: Data.Bytes(),
    admin_key_hash: Data.Bytes(),
});

export type DepositContractParams = Data.Static<typeof DepositContractParamsSchema>;

// ============================================================================
// Deposit Receipt (Off-chain only)
// ============================================================================

export interface DepositReceipt {
    txHash: string;
    depositUtxo: string;
    collateralAmount: number;
    secret: string;
    commitment: string;
    depositedAt: string;
    maxLoan: number;
}

// ============================================================================
// ZK Proof Types
// ============================================================================

export interface ZKProof {
    pi_a: [string, string, string];
    pi_b: [[string, string], [string, string], [string, string]];
    pi_c: [string, string, string];
    protocol: string;
    curve: string;
}

export interface ProveCollateralPublicSignals {
    commitment: string;
    loan_amount: string;
    collateral_ratio: string;
}

// ============================================================================
// Borrow Request (API)
// ============================================================================

export interface BorrowRequest {
    depositUtxoRef: string;
    loanAmount: number;
    destinationAddress: string;
    proof: ZKProof;
    publicSignals: ProveCollateralPublicSignals;
}

// ============================================================================
// Repay Request (API)
// ============================================================================

export interface RepayRequest {
    loanUtxoRef: string;
    repaymentAmount: number;
    borrowerAddress: string;
}
