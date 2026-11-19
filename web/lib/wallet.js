// CIP-30 browser wallet (Eternl, Lace, …) via Mesh's BrowserWallet. One
// connection is one account; the user switches accounts in the wallet and the
// app reconnects to read the new one.
import { BrowserWallet, deserializeAddress } from "@meshsdk/core";

export async function availableWallets() {
  return BrowserWallet.getAvailableWallets();
}

function keyHashOf(address) {
  try {
    return deserializeAddress(address).pubKeyHash || null;
  } catch {
    return null;
  }
}

// Connect (or reconnect after an account switch) and describe the account.
export async function connectWallet(name) {
  const wallet = await BrowserWallet.enable(name);
  if ((await wallet.getNetworkId()) !== 0) throw new Error("Switch your wallet to a testnet (Preprod).");
  const address = await wallet.getChangeAddress();
  const used = await wallet.getUsedAddresses();
  const keyHashes = [...new Set([address, ...used].map(keyHashOf).filter(Boolean))];
  return { name, wallet, address, keyHashes };
}

export class AccountChanged extends Error {
  constructor(account) {
    super(`Your wallet switched to ${shortAddress(account.address)}. Check that this is the account you want for this step, then press the button again.`);
    this.name = "AccountChanged";
    this.account = account;
  }
}

// Before a step the wallet signs: the account selected in the wallet may have
// changed since the app connected (the old connection then refuses requests).
// Reconnect and stop if it is a different account, so the user decides again
// with the right account and the right linkage warnings.
export async function ensureSameAccount(account) {
  const fresh = await connectWallet(account.name);
  if (fresh.address !== account.address) throw new AccountChanged(fresh);
  return fresh;
}

// What a transaction builder needs from the account: its UTxOs and, if the
// wallet designates one, its collateral.
export async function payerOf(account) {
  const utxos = await account.wallet.getUtxos();
  const collateral = (await account.wallet.getCollateral())[0];
  return { address: account.address, utxos, ...(collateral ? { collateral } : {}) };
}

export const shortAddress = (a) => (a ? `${a.slice(0, 12)}…${a.slice(-6)}` : "");
