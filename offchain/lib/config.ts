/**
 * Configuration and Environment Variables for V3 Privacy-Enhanced Lending Protocol
 *
 * This module loads and validates environment variables from .env file.
 * All configuration values are loaded once and cached.
 */

import { type Network } from "@lucid-evolution/lucid";

// ============================================
// ENVIRONMENT VALIDATION
// ============================================

/**
 * Gets an environment variable or throws if not set
 *
 * @param key - Environment variable name
 * @param defaultValue - Optional default value
 * @returns Environment variable value
 * @throws Error if variable not set and no default provided
 */
function getEnv(key: string, defaultValue?: string): string {
    const value = Deno.env.get(key);
    if (value === undefined) {
        if (defaultValue !== undefined) {
            return defaultValue;
        }
        throw new Error(`Environment variable ${key} is not set. Please check your .env file.`);
    }
    return value;
}

/**
 * Gets an environment variable as number or throws if invalid
 *
 * @param key - Environment variable name
 * @param defaultValue - Optional default value
 * @returns Environment variable value as number
 * @throws Error if variable not set or not a valid number
 */
function getEnvNumber(key: string, defaultValue?: number): number {
    const value = Deno.env.get(key);
    if (value === undefined) {
        if (defaultValue !== undefined) {
            return defaultValue;
        }
        throw new Error(`Environment variable ${key} is not set`);
    }
    const num = parseInt(value, 10);
    if (isNaN(num)) {
        throw new Error(`Environment variable ${key} must be a number, got: ${value}`);
    }
    return num;
}

/**
 * Gets an environment variable as boolean
 *
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns Environment variable value as boolean
 */
function getEnvBoolean(key: string, defaultValue: boolean = false): boolean {
    const value = Deno.env.get(key);
    if (value === undefined) {
        return defaultValue;
    }
    return value.toLowerCase() === "true" || value === "1";
}

// ============================================
// NETWORK CONFIGURATION
// ============================================

/**
 * Cardano network configuration
 */
export const NETWORK = getEnv("NETWORK", "preprod") as "preprod" | "mainnet";

/**
 * Network type for Lucid
 */
export const LUCID_NETWORK: Network = NETWORK === "mainnet" ? "Mainnet" : "Preprod";

/**
 * Blockfrost API configuration
 */
export const BLOCKFROST_PROJECT_ID = getEnv("BLOCKFROST_PROJECT_ID", "");

/**
 * Preprod Blockfrost endpoint (Demeter)
 */
export const PREPROD_BLOCKFROST = getEnv("PREPROD_BLOCKFROST", "");
export const BLOCKFROST_ENDPOINT = PREPROD_BLOCKFROST;
export const BLOCKFROST_API_KEY = "blockfrost1he7uy2whn7zfqzlw2m7";

/**
 * Kupmios provider URLs
 */
export const KUPO_URL = getEnv(
    NETWORK === "mainnet" ? "KUPO_MAINNET" : "KUPO_PREPROD",
    "https://preprod.kupo-m1.demeter.run",
);

export const OGMIOS_URL = getEnv(
    NETWORK === "mainnet" ? "OGMIOS_MAINNET" : "OGMIOS_PREPROD",
    "https://preprod.ogmios-m1.demeter.run",
);

// ============================================
// WALLET CONFIGURATION
// ============================================

/**
 * Admin wallet seed phrase (backend service)
 * CRITICAL: Must be kept secret!
 */
export const ADMIN_WALLET_SEED = getEnv("ADMIN_WALLET_SEED");

/**
 * Test user wallet seeds (for development)
 */
export const USER1_WALLET_SEED = getEnv("USER1_WALLET_SEED", "");

// ============================================
// V3 CONTRACT ADDRESSES
// ============================================

/**
 * Collateral V3 contract address (deployed)
 */
export const COLLATERAL_V3_ADDRESS = getEnv("COLLATERAL_V3_ADDRESS", "");

/**
 * Lending Pool V3 contract address (deployed)
 */
export const LENDING_POOL_V3_ADDRESS = getEnv("LENDING_POOL_V3_ADDRESS", "");

/**
 * Beacon token policy ID
 */
export const BEACON_POLICY_ID = getEnv("BEACON_POLICY_ID", "");

// ============================================
// BACKEND SERVICE ADDRESSES
// ============================================

/**
 * Backend address for borrow payments
 */
export const BACKEND_BORROW_ADDR = getEnv("BACKEND_BORROW_ADDR", "");

/**
 * Backend address for repayment payments
 */
export const BACKEND_REPAYMENT_ADDR = getEnv("BACKEND_REPAYMENT_ADDR", "");

// ============================================
// ZK CIRCUIT CONFIGURATION
// ============================================

/**
 * ZK Circuit file paths
 */
export const ZK_CIRCUIT_WASM = getEnv("ZK_CIRCUIT_WASM", "../circuits/collateral_proof_js/collateral_proof.wasm");
export const ZK_CIRCUIT_ZKEY = getEnv("ZK_CIRCUIT_ZKEY", "../circuits/keys/collateral_proof_0000.zkey");
export const ZK_VKEY = getEnv("ZK_VKEY", "../../circuits/keys/verification_key.json");

// ============================================
// API SERVER CONFIGURATION
// ============================================

/**
 * API server port and host
 */
export const API_PORT = getEnvNumber("API_PORT", 3000);
export const API_HOST = getEnv("API_HOST", "localhost");
export const API_CORS_ORIGIN = getEnv("API_CORS_ORIGIN", "http://localhost:8000");

// ============================================
// TRANSACTION FEE CONFIGURATION
// ============================================

/**
 * Minimum UTXO ADA (in lovelace)
 */
export const MIN_UTXO_ADA = getEnvNumber("MIN_UTXO_ADA", 2000000);

/**
 * Transaction fee buffer (in lovelace)
 */
export const TX_FEE_BUFFER = getEnvNumber("TX_FEE_BUFFER", 500000);

/**
 * Backend service fee (in lovelace)
 */
export const BACKEND_SERVICE_FEE = getEnvNumber("BACKEND_SERVICE_FEE", 500000);

// ============================================
// LOAN CONFIGURATION
// ============================================

/**
 * Maximum Loan-to-Value ratio (percentage)
 * Default: 80 (means max 80% of collateral can be borrowed)
 */
export const MAX_LTV_RATIO = getEnvNumber("MAX_LTV_RATIO", 80);

/**
 * Minimum collateral amount (in lovelace)
 * Default: 10 ADA
 */
export const MIN_COLLATERAL_ADA = getEnvNumber("MIN_COLLATERAL_ADA", 10000000);

/**
 * Annual interest rate in basis points
 * Default: 500 (5%)
 */
export const INTEREST_RATE_BPS = getEnvNumber("INTEREST_RATE_BPS", 500);

// ============================================
// DEVELOPMENT/DEBUG CONFIGURATION
// ============================================

/**
 * Debug mode flag
 */
export const DEBUG = getEnvBoolean("DEBUG", false);

/**
 * Log level
 */
export const LOG_LEVEL = getEnv("LOG_LEVEL", "info");

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Validates that all required configuration is set
 * Throws error if any required config is missing
 *
 * @throws Error if required configuration is missing
 *
 * @example
 * validateConfig(); // throws if missing required vars
 */
export function validateConfig(): void {
    const requiredForCLI = [
        "ADMIN_WALLET_SEED",
        "COLLATERAL_V3_ADDRESS",
        "LENDING_POOL_V3_ADDRESS",
        "BEACON_POLICY_ID",
    ];

    const requiredForBackend = [
        ...requiredForCLI,
        "BACKEND_BORROW_ADDR",
        "BACKEND_REPAYMENT_ADDR",
        "ZK_CIRCUIT_WASM",
        "ZK_CIRCUIT_ZKEY",
        "ZK_VKEY",
    ];

    // Check if running as backend or CLI
    const isBackend = Deno.env.get("IS_BACKEND") === "true";
    const required = isBackend ? requiredForBackend : requiredForCLI;

    const missing = required.filter((key) => {
        const value = Deno.env.get(key);
        return !value || value.trim() === "";
    });

    if (missing.length > 0) {
        throw new Error(
            `Missing required configuration:\n${missing.map((k) => `  - ${k}`).join("\n")}\n\nPlease check your .env file.`,
        );
    }
}

/**
 * Prints current configuration (for debugging)
 * SECURITY: Hides sensitive values like seeds
 *
 * @example
 * printConfig();
 */
export function printConfig(): void {
    console.log("=== V3 Configuration ===");
    console.log(`Network: ${NETWORK}`);
    console.log(`Kupo URL: ${KUPO_URL}`);
    console.log(`Ogmios URL: ${OGMIOS_URL}`);
    console.log(`Collateral V3: ${COLLATERAL_V3_ADDRESS || "(not set)"}`);
    console.log(`Lending Pool V3: ${LENDING_POOL_V3_ADDRESS || "(not set)"}`);
    console.log(`Beacon Policy: ${BEACON_POLICY_ID || "(not set)"}`);
    console.log(`Max LTV Ratio: ${MAX_LTV_RATIO}%`);
    console.log(`Interest Rate: ${INTEREST_RATE_BPS / 100}%`);
    console.log(`Min Collateral: ${MIN_COLLATERAL_ADA / 1000000} ADA`);
    console.log(`Debug Mode: ${DEBUG}`);
    console.log("========================");
}

/**
 * Gets beacon token unit (policy + name)
 *
 * @param assetName - Asset name in hex (e.g., "4445504f534954" for "DEPOSIT")
 * @returns Full unit (policyId + assetName)
 *
 * @example
 * const unit = getBeaconUnit("4445504f534954");
 */
export function getBeaconUnit(assetName: string): string {
    if (!BEACON_POLICY_ID) {
        throw new Error("BEACON_POLICY_ID not set in config");
    }
    return BEACON_POLICY_ID + assetName;
}

/**
 * Calculates maximum loan amount from collateral
 *
 * @param collateralAmount - Collateral amount in lovelace
 * @returns Maximum loan amount in lovelace
 *
 * @example
 * const maxLoan = calculateMaxLoan(10000000); // 10 ADA collateral
 * console.log(maxLoan); // 8000000 (8 ADA at 80% LTV)
 */
export function calculateMaxLoan(collateralAmount: number): number {
    return Math.floor((collateralAmount * MAX_LTV_RATIO) / 100);
}

/**
 * Calculates interest on a loan amount
 *
 * @param loanAmount - Loan amount in lovelace
 * @returns Interest amount in lovelace
 *
 * @example
 * const interest = calculateInterest(8000000);
 * console.log(interest); // 400000 (0.4 ADA at 5%)
 */
export function calculateInterest(loanAmount: number): number {
    return Math.floor((loanAmount * INTEREST_RATE_BPS) / 10000);
}

/**
 * Calculates total repayment amount (principal + interest)
 *
 * @param loanAmount - Loan amount in lovelace
 * @returns Total repayment amount in lovelace
 *
 * @example
 * const repayment = calculateRepaymentAmount(8000000);
 * console.log(repayment); // 8400000 (8.4 ADA)
 */
export function calculateRepaymentAmount(loanAmount: number): number {
    const interest = calculateInterest(loanAmount);
    return loanAmount + interest;
}
