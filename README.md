# ZK Defi Protocol 

🛡️  Privacy-Preserving Lending on Cardano

Welcome to the ZK DeFi Protocol – an open-source privacy layer for decentralized lending and borrowing on Cardano. This protocol enables users to interact privately with DeFi markets by verifying collateral and executing transactions without revealing wallet balances, loan amounts, or identities.

Project Status:  
✅ Protocol Architecture (Milestone 1)  
✅ Smart Contract Develoopmen (Milestone 2)  
🔜 Next: ZK Circuit Implementation (Milestone 3)  

M1 Report: https://docs.google.com/document/d/1cMg0dmwjoTUpP9SSy8Lryxb0cdgB0nyCJnw617k3eUA/edit?usp=sharing  
M2 Report (including Flowcharts, Demo & Testcases): https://docs.google.com/document/d/11QrOcAajDYRgz7Zebqrjgg7A3fR1ZLhD4KZkRb99Q6U/edit?tab=t.0  


# Repository Structure

ZK-Defi-Protocol/  
├── onchain-module/       → Aiken smart contracts  
├── offchain-module/      → Off-chain logic  
├── zk-module/            → ZK logic (TBD)  
└── README.md             

Each module has its own detailed README.md.   
This root readme provides high-level context for the full protocol.  

The onchain module includes the smart contricts, the offchain-module the logic for:  
    1. Collateral Management  
    2. Lending Pool (Issuance & Redemption) - incl. Interest Payment  

Start with the offchain module to run a demo of the current status of the protocol.  

# Protocol Overview

The ZK DeFi Protocol enables:  
	• Private Collateralized Borrowing: Users can borrow against assets without disclosing collateral type or amount.  
	• Anonymous Lending: Liquidity providers contribute funds to lending pools without revealing identity or position size.  
	• Zero-Knowledge Proof Enforcement: Loan issuance, repayments, and interest payments are authorized via zk-SNARKs (PLONK), ensuring validity without  revealing data.  
	• eUTXO-native Privacy    

All privacy features are designed to work natively with Cardano’s extended UTXO model.  
