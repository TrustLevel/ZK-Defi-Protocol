// Calculate Poseidon commitment for test input
const { buildPoseidon } = require("circomlibjs");

async function calculateCommitment() {
    const poseidon = await buildPoseidon();

    // Test values
    const collateral_amount = BigInt("1050000000"); // 1050 ADA
    const secret = BigInt("123456789012345678901234567890"); // Test secret

    // Calculate commitment
    const commitment = poseidon.F.toString(poseidon([collateral_amount, secret]));

    // Create input file
    const input = {
        "commitment": commitment,
        "loan_amount": "700000000",
        "collateral_ratio": "150",
        "secret": secret.toString(),
        "collateral_amount": collateral_amount.toString()
    };

    console.log("Test Input Values:");
    console.log("==================");
    console.log("Secret:", secret.toString());
    console.log("Collateral:", collateral_amount.toString(), "lovelace (1050 ADA)");
    console.log("Loan Amount:", "700000000", "lovelace (700 ADA)");
    console.log("Collateral Ratio:", "150%");
    console.log("\nCalculated Commitment:", commitment);
    console.log("\n✅ Input file ready for witness generation");

    // Write to file
    const fs = require('fs');
    fs.writeFileSync('input_test.json', JSON.stringify(input, null, 2));
}

calculateCommitment().catch(console.error);
