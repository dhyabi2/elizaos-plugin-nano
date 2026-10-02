# @dhyabi2/plugin-nano — Nano (XNO) wallet for ElizaOS agents

Give an ElizaOS agent a **Nano (XNO)** wallet: feeless, instant, final payments, and an x402 payer that
settles in XNO. Built for agents that already transact — Nano has **no gas**, so sub-cent agent-to-agent
micropayments are economic where fee-metered rails erode them.

## Why Nano for agent payments
- **Feeless** — the sender pays 0. Sub-cent payments are viable.
- **Instant & final** — confirmation in under a second; irreversible once confirmed (no chargebacks).
- **Add it beside USDC, not instead of it** — see the [dual-rail](https://github.com/dhyabi2/dual-rail) pattern.

## Install
```bash
npm install @dhyabi2/plugin-nano nanocurrency
```
Add to your character/agent config and set:
```
NANO_SEED      = <64-hex seed>        # required to send/receive; the seed never leaves the process
NANO_RPC_URL   = https://rpc.nano.to  # any Nano RPC (send a User-Agent)
NANO_INDEX     = 0                     # optional
NANO_REP       = nano_...              # optional representative
```
```ts
import { nanoPlugin } from "@dhyabi2/plugin-nano";
// plugins: [ ..., nanoPlugin ]
```

## Actions
| Action | What it does |
|---|---|
| `CHECK_NANO_BALANCE` | the agent's XNO address + balance |
| `RECEIVE_NANO` | receive pending XNO (opens the account if new) |
| `SEND_NANO` | pay an amount of XNO to a `nano_` address — feeless, final |
| `PAY_X402_NANO` | call an x402 endpoint priced in XNO: 402 → pay → retry (e.g. `extract.paypercall.dev`) |

A wallet **provider** also injects the agent's address + balance into context each turn.

## Status & honesty
Reference plugin targeting `@elizaos/core >= 0.1.7`. Key derivation/signing uses the production-proven
`nanocurrency` path (`deriveSecretKey → derivePublicKey → deriveAddress`, local signing, only the signed block
is relayed). The ElizaOS `Action`/`Provider` handler signature has shifted across 0.1.x — **verify against your
version** before production. Work generation assumes your RPC has `work_generate` enabled (or supply work
upstream). PRs welcome. Nano as an x402 settlement network is under discussion at
[x402#3512](https://github.com/x402-foundation/x402/issues/3512).

MIT.
