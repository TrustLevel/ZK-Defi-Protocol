import { UTxO } from "@lucid-evolution/lucid";
import { adminAddress, AssetClass, beaconTokens, getLucidInstance } from "./common.ts";

const wantedRefUtxoTokens = [
    beaconTokens.refscripts,
    beaconTokens.collateral,
    beaconTokens.lendingPool,
];

/**
 * Find utxos that can be used in transaction to deploy validators as reference scripts. The utxos should contain the beacon tokens
 * needed to go along with each reference script. Additional utxos will also be selected until there is a total of at least
 * 100_000_000 lovelace in the selected utxos.
 *
 * @param utxos - The list of utxos to select from
 * @param reserved - An optional utxo that should not be included in the result
 * @returns A tuple of the selected utxos and a mapping from the indices of the selected utxos in the input array to the utxos themselves.
 */
export function getDeployUtxos(utxos: UTxO[], reserved?: UTxO): [UTxO[], Record<number, UTxO>] {
    const reservedId = reserved ? reserved.txHash + reserved.outputIndex : undefined;
    const foundRefUtxoTokens: Record<number, UTxO> = {};

    let adaInFoundRefUtxos = 0n;
    wantedRefUtxoTokens.forEach((token) => {
        for (const [idx, utxo] of (Object.entries(utxos) as unknown as [number, UTxO][])) {
            if (utxo.assets[token] && !foundRefUtxoTokens[idx]) {
                foundRefUtxoTokens[idx] = utxo;
                adaInFoundRefUtxos += utxo.assets["lovelace"];
            }
        }
    });
    const deployUtxos = Object.entries(foundRefUtxoTokens).map(([, utxo]) => utxo);

    if (adaInFoundRefUtxos < 100_000_000n) {
        Object.entries(utxos).forEach(([idx, utxo]) => {
            const utxoId = utxo.txHash + utxo.outputIndex;
            if (adaInFoundRefUtxos < 100_000_000n && !foundRefUtxoTokens[Number(idx)]) {
                if (utxoId !== reservedId) {
                    adaInFoundRefUtxos += utxo.assets["lovelace"];
                    foundRefUtxoTokens[Number(idx)] = utxo;
                    deployUtxos.push(utxo);
                }
            }
        });
    }

    return [deployUtxos, foundRefUtxoTokens];
}

/**
 * Retrieves the total amount of a specified loanable asset at the admin address.
 *
 * This function calculates the total amount of the given loanable asset by
 * iterating through all UTXOs at the admin address, summing up the asset's
 * quantities found in those UTXOs.
 *
 * @param loanableAsset - The asset class containing policy ID and asset name
 *                        of the loanable asset to be queried.
 * @returns The total amount of the specified loanable asset at the admin address.
 */

export async function getLoanableAssetAtAdminAddress(loanableAsset: AssetClass) {
    const lucid = getLucidInstance();
    const loanableAssetId = loanableAsset.policy_id + loanableAsset.asset_name;
    const utxos = await lucid.utxosAt(adminAddress);
    let totalAmt = 0n;
    for (const utxo of utxos) {
        if (utxo.assets[loanableAssetId]) {
            totalAmt += utxo.assets[loanableAssetId];
        }
    }
    return totalAmt;
}
