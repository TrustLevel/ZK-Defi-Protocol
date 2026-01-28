# CLI Tools

Command-line interface tools for interacting with the ZK-DeFi Protocol.

## Structure

```
cli/
├── v3/           # V3 ZK-Privacy Commands (Active)
├── legacy/       # V2 Legacy Commands (Reference)
├── utils/        # Utility Scripts
├── admin/        # Admin-only Tools (proving service)
└── README.md     # This file
```

---

## V3 Commands (ZK-Privacy Enabled)

Located in `v3/` - these are the **active** commands for privacy-enhanced borrowing.

### Deposit Collateral
```bash
deno task deposit-v3
```
Deposits collateral and generates a secret receipt with commitment.

### Borrow Anonymously
```bash
deno task borrow-v3
```
Borrows against collateral using ZK proof. Backend signs the transaction, achieving ~85% privacy.

### Repay Loan
```bash
deno task repay-v3
```
Repays loan using the secret from the deposit receipt.

### Withdraw Collateral
```bash
deno task withdraw-v3
```
Withdraws collateral after repaying the loan.

**Files:**
- `deposit-collateral-v3.ts` - Deposit with commitment generation
- `borrow-anonymous-v3.ts` - Anonymous borrowing with ZK proof
- `repay-anonymous-v3.ts` - Loan repayment
- `withdraw-collateral-v3.ts` - Collateral withdrawal
- `loan-take-anonymous.ts` - Alternative borrow script
- `borrow-v3-node.mjs` - Node.js version for proof generation
- `README-V3.md` - Detailed V3 documentation

---

## Legacy Commands (V2 - Reference Only)

Located in `legacy/` - these are **old V2 commands** kept for reference.

**Not recommended for new deployments.** V3 commands provide better privacy.

### V2 Workflow
1. Deploy refscripts: `deno task deploy-refscripts`
2. Mint tokens: `deno task mint-loanable-tokens`
3. Deposit: `deno task deposit-collateral-asset`
4. Borrow: `deno task borrow`
5. Repay: `deno task repay`
6. Withdraw: `deno task withdraw-collateral`

**Files:**
- Collateral: `collateral-deposit.ts`, `collateral-withdraw.ts`
- Loans: `loan-take.ts`, `loan-repay.ts`, `loan-request-reset.ts`
- Tokens: `loanable-tokens-*.ts`, `beacon-tokens-mint.ts`
- Refscripts: `refscripts-*.ts`

---

## Admin Tools

Located in `admin/` - admin-only tools for backend operations.

### Prove and Borrow (Admin)
```bash
deno task admin:prove-and-borrow borrow-request.json
```

Admin-side proving service that:
- Receives borrow request with user's secret
- Generates ZK proof on behalf of user
- Signs and submits transaction

**Use Case:** Development, testing, or full-service workflow.

**For Production:** Users should use the HTTP API workflow (`POST /api/v3/borrow`) to keep secrets private.

See `admin/README.md` for details.

---

## Utility Commands

Located in `utils/` - helper scripts for both V2 and V3.

### Generate Secret
```bash
deno task generate-secret
```
Generates a random 253-bit secret for V3 deposits.

### List Collateral
```bash
deno task list-collateral
```
Lists all collateral UTXOs at the collateral validator address.

### Decode CBOR Datum
```bash
deno run --allow-all utils/decodeCborDatum.ts
```
Decodes CBOR-encoded datums from blockchain.

**Files:**
- `secret-generate.ts` - Secret generation
- `collateral-list.ts` - UTXO querying
- `decodeCborDatum.ts` - CBOR decoding

---

## Configuration

All commands read from:
- **`../.env`** - Network configuration (Blockfrost API, network selection)
- **`../.data/secrets.json`** - User secrets (gitignored)
- **`../.data/receipts/`** - Deposit receipts (gitignored)

---

## Development

### Adding a New V3 Command

1. Create file in `v3/` directory
2. Import from `../../lib/` for shared utilities
3. Add task to `../deno.json`:
   ```json
   "my-command": "deno run --allow-all cli/v3/my-command.ts"
   ```

### Updating Legacy Commands

**Do not modify legacy commands** unless for bug fixes. They are kept for reference only.

---

## See Also

- **Backend Service:** `../backend/README.md`
- **Library Functions:** `../lib/`
- **V3 Design:** `../../docs/v3-zk-privacy-design.md`

---

**Last Updated:** 2026-01-22
