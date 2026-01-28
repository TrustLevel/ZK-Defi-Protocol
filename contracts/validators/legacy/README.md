# Legacy Validators (V2)

This directory contains the old validator versions that are **no longer actively used** but kept as reference implementations.

## Files

**`collateral.ak`** - V2 collateral validator
- Uses traditional UTXO locking (non-ZK)
- Working implementation (tested)
- Kept for reference

**`lending_pool.ak`** - V2 lending pool validator
- Traditional borrow/repay flow
- Working implementation (tested)
- Kept for reference

## Current Active Validators

The active V3 validators with ZK privacy features are in the parent directory:
- `../collateral_v3.ak` - Privacy-enhanced collateral validator
- `../lending_pool_v3.ak` - Anonymous borrowing support

---

**Note:** These legacy validators are kept for reference only. Do not use for new development.

**Last Updated:** 2026-01-22
