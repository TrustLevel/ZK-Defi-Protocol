/**
 * UTXO Query Utilities for V3 Privacy-Enhanced Lending Protocol
 *
 * This module provides functions to query UTXOs from the blockchain:
 * - Find collateral deposits by reference or owner
 * - Find lending pool UTXO
 * - Wait for transaction confirmation
 */

import { Data, type Lucid, type UTxO } from "@lucid-evolution/lucid";
import type { DepositDatum, V3LendingPoolDatum } from "./types.ts";
import { DepositDatumSchema, V3LendingPoolDatumSchema } from "./types.ts";

// ============================================
// COLLATERAL DEPOSIT QUERIES
// ============================================

/**
 * Finds a collateral deposit UTXO by reference
 *
 * @param lucid - Lucid instance
 * @param depositRef - Format: "txHash#outputIndex"
 * @returns UTxO with parsed datum, or null if not found
 *
 * @example
 * const utxo = await findDepositUtxo(lucid, "abc123...#0");
 * if (utxo) {
 *   console.log("Collateral:", utxo.datum.collateral_amount);
 * }
 */
export async function findDepositUtxo(
    lucid: Lucid,
    depositRef: string,
): Promise<(UTxO & { datum: DepositDatum }) | null> {
    // Parse reference
    const [txHash, outputIndexStr] = depositRef.split("#");

    if (!txHash || outputIndexStr === undefined) {
        throw new Error(`Invalid deposit reference format: ${depositRef}. Expected "txHash#index"`);
    }

    const outputIndex = parseInt(outputIndexStr, 10);
    if (isNaN(outputIndex)) {
        throw new Error(`Invalid output index in reference: ${depositRef}`);
    }

    // Query UTXO by reference
    const utxos = await lucid.utxosByOutRef([{ txHash, outputIndex }]);

    if (utxos.length === 0) {
        return null;
    }

    const utxo = utxos[0];

    // Parse datum
    if (!utxo.datum) {
        throw new Error(`Deposit UTXO ${depositRef} has no datum`);
    }

    try {
        const datum = Data.from(utxo.datum, DepositDatumSchema);
        return { ...utxo, datum };
    } catch (error: any) {
        // Safely extract error message (avoiding BigInt serialization)
        const errorMsg = error?.message || String(error);
        throw new Error(`Failed to parse deposit datum for ${depositRef}: ${errorMsg}`);
    }
}

/**
 * Finds all collateral deposit UTXOs owned by a specific user
 *
 * @param lucid - Lucid instance
 * @param depositAddress - Collateral contract address (bech32)
 * @param ownerPkh - Owner's payment credential hash (hex string)
 * @param beaconPolicyId - Beacon token policy ID (hex string)
 * @returns Array of UTxOs with parsed datums
 *
 * @example
 * const deposits = await findDepositUtxosByOwner(
 *   lucid,
 *   "addr_test1...",
 *   "abc123...",
 *   "def456..."
 * );
 * console.log(`Found ${deposits.length} deposits`);
 */
export async function findDepositUtxosByOwner(
    lucid: Lucid,
    depositAddress: string,
    ownerPkh: string,
    beaconPolicyId: string,
): Promise<Array<UTxO & { datum: DepositDatum }>> {
    // Query all UTXOs at deposit contract address
    const utxos = await lucid.utxosAt(depositAddress);

    // Filter by beacon token and owner
    const deposits: Array<UTxO & { datum: DepositDatum }> = [];

    for (const utxo of utxos) {
        // Check for beacon token
        const hasBeacon = Object.keys(utxo.assets).some((unit) => unit.startsWith(beaconPolicyId));

        if (!hasBeacon || !utxo.datum) {
            continue;
        }

        // Parse datum and check owner
        try {
            const datum = Data.from(utxo.datum, DepositDatumSchema);

            // Compare owner (datum.owner is ByteArray hex string)
            if (datum.owner === ownerPkh) {
                deposits.push({ ...utxo, datum });
            }
        } catch (error) {
            // Skip UTXOs with invalid datums
            console.warn(`Skipping UTXO with invalid datum:`, error);
            continue;
        }
    }

    return deposits;
}

/**
 * Finds all collateral deposit UTXOs at an address (for listing)
 *
 * @param lucid - Lucid instance
 * @param depositAddress - Collateral contract address (bech32)
 * @param beaconPolicyId - Beacon token policy ID (hex string)
 * @returns Array of UTxOs with parsed datums
 *
 * @example
 * const deposits = await findAllDepositUtxos(lucid, "addr_test1...", "abc123...");
 */
export async function findAllDepositUtxos(
    lucid: Lucid,
    depositAddress: string,
    beaconPolicyId: string,
): Promise<Array<UTxO & { datum: DepositDatum }>> {
    const utxos = await lucid.utxosAt(depositAddress);

    const deposits: Array<UTxO & { datum: DepositDatum }> = [];

    for (const utxo of utxos) {
        const hasBeacon = Object.keys(utxo.assets).some((unit) => unit.startsWith(beaconPolicyId));

        if (!hasBeacon || !utxo.datum) {
            continue;
        }

        try {
            const datum = Data.from(utxo.datum, DepositDatumSchema);
            deposits.push({ ...utxo, datum });
        } catch (error) {
            console.warn(`Skipping UTXO with invalid datum:`, error);
            continue;
        }
    }

    return deposits;
}

// ============================================
// LENDING POOL QUERIES
// ============================================

/**
 * Finds the lending pool UTXO by beacon token
 *
 * @param lucid - Lucid instance
 * @param poolAddress - Lending pool contract address (bech32)
 * @param beaconPolicyId - Beacon token policy ID (hex string)
 * @param beaconAssetName - Beacon token asset name (hex, default: "LENDINGPOOL")
 * @returns UTxO with parsed datum, or null if not found
 *
 * @example
 * const pool = await findLendingPoolUtxo(lucid, "addr_test1...", "abc123...");
 * if (pool) {
 *   console.log("Available:", pool.datum.total_deposited - pool.datum.total_borrowed);
 * }
 */
export async function findLendingPoolUtxo(
    lucid: Lucid,
    poolAddress: string,
    beaconPolicyId: string,
    beaconAssetName: string = "4c454e44494e47504f4f4c", // "LENDINGPOOL" in hex
): Promise<(UTxO & { datum: V3LendingPoolDatum }) | null> {
    // Query all UTXOs at pool address
    const utxos = await lucid.utxosAt(poolAddress);

    // Find UTXO with beacon token
    const unit = beaconPolicyId + beaconAssetName;
    const poolUtxo = utxos.find((utxo) => utxo.assets[unit] === 1n);

    if (!poolUtxo) {
        return null;
    }

    // Parse datum
    if (!poolUtxo.datum) {
        throw new Error("Lending pool UTXO has no datum");
    }

    try {
        const datum = Data.from(poolUtxo.datum, V3LendingPoolDatumSchema);
        return { ...poolUtxo, datum };
    } catch (error) {
        throw new Error(`Failed to parse lending pool datum: ${error}`);
    }
}

// ============================================
// TRANSACTION UTILITIES
// ============================================

/**
 * Waits for a transaction to be confirmed
 * Polls the blockchain until transaction is confirmed or timeout
 *
 * @param lucid - Lucid instance
 * @param txHash - Transaction hash to wait for (hex string)
 * @param timeoutMs - Maximum wait time in milliseconds (default: 180000 = 3 minutes)
 * @returns true if confirmed, false if timeout
 *
 * @example
 * const confirmed = await waitForTxConfirmation(lucid, "abc123...");
 * if (confirmed) {
 *   console.log("Transaction confirmed!");
 * }
 */
export async function waitForTxConfirmation(
    lucid: Lucid,
    txHash: string,
    timeoutMs: number = 180000,
): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 5000; // 5 seconds

    while (Date.now() - startTime < timeoutMs) {
        try {
            // Try to await transaction
            const confirmed = await lucid.awaitTx(txHash, pollInterval);
            if (confirmed) {
                return true;
            }
        } catch (error) {
            // Continue polling on error
            console.log(`Polling transaction ${txHash}...`);
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    // Timeout reached
    return false;
}

/**
 * Gets the current slot number
 *
 * @param lucid - Lucid instance
 * @returns Current slot number
 *
 * @example
 * const slot = await getCurrentSlot(lucid);
 * console.log("Current slot:", slot);
 */
export async function getCurrentSlot(lucid: Lucid): Promise<number> {
    const provider = lucid.config().provider;
    // Lucid Evolution doesn't expose slot directly, use workaround
    // Query current tip and extract slot
    const slot = await provider.currentSlot();
    return slot;
}

/**
 * Gets UTXOs at a specific address with minimum ADA
 *
 * @param lucid - Lucid instance
 * @param address - Address to query (bech32)
 * @param minAda - Minimum ADA in lovelace (default: 5000000 = 5 ADA)
 * @returns Array of UTxOs with at least minAda
 *
 * @example
 * const utxos = await getUtxosWithMinAda(lucid, "addr1...", 10000000);
 */
export async function getUtxosWithMinAda(
    lucid: Lucid,
    address: string,
    minAda: number = 5000000,
): Promise<UTxO[]> {
    const utxos = await lucid.utxosAt(address);

    return utxos.filter((utxo) => {
        const lovelace = utxo.assets["lovelace"] || 0n;
        return Number(lovelace) >= minAda;
    });
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Formats a UTXO reference as "txHash#index"
 *
 * @param txHash - Transaction hash (hex string)
 * @param outputIndex - Output index (number)
 * @returns Formatted reference string
 *
 * @example
 * const ref = formatUtxoRef("abc123...", 0);
 * console.log(ref); // "abc123...#0"
 */
export function formatUtxoRef(txHash: string, outputIndex: number): string {
    return `${txHash}#${outputIndex}`;
}

/**
 * Parses a UTXO reference into components
 *
 * @param utxoRef - Format: "txHash#index"
 * @returns Object with txHash and outputIndex
 *
 * @example
 * const { txHash, outputIndex } = parseUtxoRef("abc123...#0");
 */
export function parseUtxoRef(utxoRef: string): { txHash: string; outputIndex: number } {
    const [txHash, outputIndexStr] = utxoRef.split("#");

    if (!txHash || outputIndexStr === undefined) {
        throw new Error(`Invalid UTXO reference format: ${utxoRef}`);
    }

    const outputIndex = parseInt(outputIndexStr, 10);
    if (isNaN(outputIndex)) {
        throw new Error(`Invalid output index in reference: ${utxoRef}`);
    }

    return { txHash, outputIndex };
}
