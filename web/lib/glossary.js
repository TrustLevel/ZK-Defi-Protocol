// The words the app uses, in plain language first. Shown as tooltips (Term)
// and reused by the user guide in docs/m4/.

export const GLOSSARY = {
  collateral: {
    term: "Collateral",
    text: "The 20 ADA you lock as security for your own loan. It sits in its own contract, not in the lending pool, and is never lent out. You get it back after you repay. Not to be confused with liquidity, which lenders add to the pool.",
  },
  note: {
    term: "Note",
    text: "A small file with the secret behind your position. It is the only key to your collateral: whoever has it can unlock the 20 ADA, and without it nobody can, not even us. It never leaves your browser unless you download it.",
  },
  secret: {
    term: "Secret",
    text: "A random number created in your browser for this position. Every proof is built from it, but it never appears on-chain and is never sent anywhere.",
  },
  commitment: {
    term: "Commitment",
    text: "A fingerprint of your secret that goes on-chain when you lock your collateral. Anyone can see it, nobody can work back to the secret from it. Later proofs show you know the secret behind one of these fingerprints without saying which one.",
  },
  anonymitySet: {
    term: "Anonymity set",
    text: "All locked collateral. A loan proves it is backed by one of them, so an observer can only narrow it down to this set. The more collateral is locked, the better each one is hidden.",
  },
  nullifier: {
    term: "Loan nullifier",
    text: "A tag derived from your secret that is published when you borrow. It lets the pool refuse a second loan on the same collateral, and it does not reveal which collateral it belongs to. Your repayment shows the same tag, so loan and repayment are linked by design.",
  },
  marker: {
    term: "Repayment marker",
    text: "A second tag from your secret, added to the list of repaid loans when you repay. The unlock proves your marker is on that list without pointing at it, so nobody can tell which repayment freed which collateral.",
  },
  fixedAmounts: {
    term: "Fixed amounts",
    text: "Every collateral is 20 ADA, every loan 10 ADA, every repayment 10.5 ADA. If amounts could differ, an unusual amount would identify you. With one size for everyone, all transactions of a kind look the same.",
  },
  relayer: {
    term: "Relayer",
    text: "A service that submits your borrow and unlock and pays their fees, so your wallet does not show up in them. It cannot redirect the money: the loan proof names the receiving account, and the unlock always pays the account that locked the collateral. It learns no secret.",
  },
  accountA: {
    term: "Account A",
    text: "The wallet account that locks your 20 ADA collateral and gets it back when you unlock. Most wallets let you create several accounts under one recovery phrase.",
  },
  accountB: {
    term: "Account B",
    text: "A second account that receives the loan and pays it back. Using a different account from A keeps the loan from pointing back to your collateral. Fund it separately (for example from the faucet), not from account A.",
  },
  scriptCollateral: {
    term: "Script collateral",
    text: "Cardano asks every transaction that runs a smart contract to set aside a small amount of plain ADA, which is only taken if the contract fails. If your account has no such amount on its own, the app creates one first (one extra signature).",
  },
  proof: {
    term: "Proof",
    text: "A short piece of maths, made in your browser from your secret, that convinces the contract a statement is true (for example \"one of these locked collaterals is mine\") without revealing anything else. The contract checks it on-chain. Technically: a Groth16 zk-SNARK.",
  },
  interest: {
    term: "Interest",
    text: "A flat 5% per loan: you borrow 10 ADA and repay 10.5 ADA. The extra 0.5 ADA stays in the pool for the lenders.",
  },
  withdraw: {
    term: "Withdraw",
    text: "A lender takes one share out of the pool and gets the current share price, paid to account B by the relayer. Borrowers get their collateral back through repay and unlock instead; collateral that never backed a loan comes back the same way, with an immediate repayment.",
  },
  share: {
    term: "Share",
    text: "Lenders lend in shares. One share is one note in your browser and a part of everything the pool owns, including the loans that are out. Because every share is the same, buying and withdrawing amounts do not point to anyone.",
  },
  sharePrice: {
    term: "Share price",
    text: "What one share is worth: the ADA in the pool plus the loans that are out, divided by the number of shares. Each repayment's interest raises it for all shares at once, so everyone who buys or withdraws at the same moment pays or gets the same amount.",
  },
  freeLiquidity: {
    term: "Free liquidity",
    text: "The ADA actually in the pool, not lent out. Loans and withdrawals are paid only from it. When most of it is lent out, lenders wait until borrowers repay. Loans have no deadline, so a loan that is never repaid is missing for the lenders who withdraw last.",
  },
};
