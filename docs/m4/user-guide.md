# ZK Lending: user guide

ZK Lending lets you borrow ADA against collateral without the chain learning which collateral
backs which loan. Every proof is made in your browser. This guide walks through one full
cycle on Cardano **Preprod** (test network, test ADA only).

**Preview:** <https://lending.trustlevel.io> · **Run it yourself:** [self-hosting.md](self-hosting.md)

> Proof of concept. Test ADA only, no audit. Do not use a wallet that holds real funds.

## The idea in one paragraph

You lock 20 ADA as collateral for your own loan, together with a fingerprint of a secret that
only your browser knows. Later you prove "one of the locked collaterals is mine" without saying
which one, and the pool lends you 10 ADA. You repay 10.5 ADA, prove that your loan was repaid,
again without pointing at it, and get your 20 ADA back. On-chain, collateral locks, loans,
repayments and unlocks look the same for everyone, because every amount is fixed.

Two kinds of money are involved: **collateral** is your own security for your own loan; it sits
in its own contract and is never lent out. **Liquidity** is what lenders put into the pool; the
loans are paid from it.

## Before you start

**A wallet with two accounts.** Any CIP-30 browser wallet that supports Preprod works; the
guide uses [Eternl](https://eternl.io). Set the wallet to **Preprod** and create two
accounts under the same recovery phrase:

| Account | Role | Needs |
|---|---|---|
| **A** | Locks the collateral, gets it back | about 30 test ADA |
| **B** | Receives the loan and repays it | about 10 test ADA |

Why two? The loan and its repayment carry the same public tag by design. If the account that
locked the collateral also received or repaid the loan, anyone could connect your collateral to
your loan through that account. With two accounts, your collateral (A) and your loan (B) stay apart.

**Test ADA.** Get it from the [Preprod faucet](https://docs.cardano.org/cardano-testnets/tools/faucet),
**separately for each account**. Sending ADA from A to B would link the two accounts on-chain.

## The cycle

The app has three tabs. **Pool** shows what everyone can see. **Borrow** holds your
positions. **Lend** adds liquidity. Each position card shows two panels: *What you know*
and *What the chain sees* for the next step. Words with a dotted underline have an
explanation on hover or tap.

### 1. Lock collateral (account A)

1. Connect your wallet with **account A** active.
2. Borrow tab → **New position**.
3. **Download note** and keep the file. It holds your secret. Without it nobody can unlock
   the collateral, including us. Tick "I stored the note file safely".
4. **Lock 20 ADA collateral** and sign in the wallet.

The browser makes a proof (about 1 to 2 seconds) that adds your collateral's fingerprint to the list of locked collateral.
If your account has no plain ADA output for script collateral, the app first asks you to
sign a small payment to yourself that creates one.

### 2. Borrow (to account B)

1. In the wallet, switch to **account B**, then press **Reconnect** in the app.
2. **Use connected account** fills in B's address.
3. **Borrow 10 ADA**. No signature: a relayer submits the transaction and pays its fee.

The proof says "one of the N locked collaterals is mine" and names B as the receiver, so
the relayer cannot send the loan anywhere else. If you try to send the loan to the account
that locked the collateral, the app warns you before anything happens.

### 3. Repay (account B)

1. With **account B** connected, **Repay 10.5 ADA** and sign.

The repayment shows the loan's tag (by design) and adds a second tag, the repayment marker,
to the list of repaid loans.

### 4. Unlock (back to account A)

1. **Unlock 20 ADA**. No signature: the relayer submits it.

The proof says "my repayment marker is in the list of repaid loans" without saying which
one, so the unlock cannot be tied to your loan. The 20 ADA go to the account that locked
the collateral, as fixed when it was locked.

## Check the privacy yourself

- **Pool tab:** your collateral is one square in the anonymity set. Nothing marks it as yours.
- **Cardanoscan:** open the borrow transaction (link in the progress list). Account A does not
  appear; the inputs are the pool and the relayer.
- **What stays visible:** the collateral is locked from A and the repayment paid from B, the loan and its
  repayment are linked by their shared tag, and the timing of your steps. With few users in the
  pool, timing narrows things down; the anonymity set grows with every locked collateral.

## Your note

The note file is your position. The app also keeps it in this browser's storage, but that
storage belongs to this browser and this site only.

- **Another browser or device:** Borrow tab → **Import note** and choose the file. The app
  reads the position's state from the chain and shows the next step.
- **Lost the note:** the collateral cannot be unlocked. There is no admin and no recovery.

## Lending

The Lend tab adds ADA to the pool; each loan pays 5% interest into it. Taking liquidity out
again is not part of the protocol yet, so only add test ADA you do not need back.

## Usage counts

The app counts which steps run and finish, proof times, error types and the wallet's name,
per day and without anything that identifies you or links two steps. The footer has a
switch, lists everything your browser sent, and links the public totals.

## Something went wrong

| You see | What to do |
|---|---|
| "Your wallet switched to …" | You changed the account in the wallet. Check it is the right one for this step and press the button again. |
| "Someone else used the pool at the same moment" | Nothing to do: the app proves again on the new state. |
| "Reading this position from the chain…" for long | The backend is catching up with the chain; wait a minute. |
| The wallet does not open | Open the wallet extension yourself; the request may be waiting there. |
