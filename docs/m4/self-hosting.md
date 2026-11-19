# Running ZK Lending yourself

The hosted preview is a convenience. Everything it does can be run on your own machine
with the files in this repository, so no claim depends on trusting our server. The stack
talks to the same M4 pool on Cardano Preprod.

## What runs

| Part | What it does | Holds |
|---|---|---|
| **Web app** (static files, served by Caddy) | Everything you see. Generates every proof in your browser, builds deposit and repay, keeps your notes in the browser. | Nothing on the server. |
| **Backend** (Node) | Reads the pool and both Merkle trees from the chain, forwards evaluation and submission to Blockfrost, and runs the relayer for borrow and unlock. | The Blockfrost key and the relayer wallet. No secret of any user. |

Caddy faces the network and forwards `/api` to the backend. The backend is not exposed on
its own.

## You need

- Docker with Compose.
- A free Blockfrost project id for **Preprod** ([blockfrost.io](https://blockfrost.io)).
- A wallet used only as the relayer, with some test ADA from the
  [Preprod faucet](https://docs.cardano.org/cardano-testnets/tools/faucet). It pays under
  1 ADA in fees per borrow or unlock (about 0.5 ADA on Preprod today). 50 test ADA lasts a long test round.

## Start

```sh
git clone https://github.com/TrustLevel/ZK-Defi-Protocol.git && cd ZK-Defi-Protocol
git checkout m4-ui            # until M4 is merged
cp deploy/.env.example deploy/.env
# edit deploy/.env: PREPROD_BLOCKFROST_API_KEY and RELAYER_WALLET_SEED
docker compose -f deploy/docker-compose.yml up -d --build
```

Open <http://localhost:8080>. The first start reads the pool's history from the chain,
which takes a few seconds. `docker compose -f deploy/docker-compose.yml logs -f server`
shows `relayer on, paying from addr_test1…` once the relayer is ready.

To serve it under a domain with HTTPS, point the domain at the machine and set in
`deploy/.env`:

```sh
SITE_ADDRESS=lending.example.org
HTTP_PORT=80
HTTPS_PORT=443
```

Caddy fetches the certificate on the next start.

## Check that it is the same protocol

- **Same pool.** The Pool tab shows the same liquidity, deposits and chain activity as
  the hosted preview and as [Cardanoscan](https://preprod.cardanoscan.io): it reads the
  pool NFT `e59c25d2…` (`packages/protocol/deployments/preprod-m4.json`).
- **Same contracts.** The script hashes are derived at build time from
  `contracts/plutus.json` and the deployment's parameters, the same way the CLI and the
  tests do (`packages/protocol/src/scripts.mjs`).
- **Proofs in the browser.** Open the browser's developer tools, Network tab, and run a
  step. The circuit files are loaded from your own server; the requests to `/api` carry
  only public data and, for borrow and unlock, the proof. The secret is never sent.
- **Browser check.** <http://localhost:8080/check> generates and verifies all four proofs
  in your browser and shows the timings.

## Without Docker

```sh
(cd packages/protocol && npm ci)
(cd server && npm ci && npm start)          # reads ../.env, listens on 127.0.0.1:3001
(cd web && npm ci && API_URL=http://127.0.0.1:3001 npm run dev)   # http://localhost:3100
```

`../.env` needs `PREPROD_BLOCKFROST_API_KEY` and `RELAYER_WALLET_SEED` (see
`deploy/.env.example`).

## Privacy of your own instance

- The backend writes no access log with IP addresses, and Caddy writes none at all.
- Usage counters (see the footer of the app) are kept per day in a Docker volume and
  served at `/api/analytics`. `ANALYTICS_FILE=off` in `deploy/.env` turns them off.
- Your notes live in your browser's storage. Download each note file and keep it: it is
  the only way to unlock your collateral.
