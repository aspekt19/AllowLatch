# Wallet-native enforcement

AllowLatch combines two layers for **AI agents with Coinbase AgentKit / CDP** (compatible gated signers welcome; day‑1 UX is AgentKit):

```text
NL mandate → engine.ts (ALLOW + receipt) → AgentKit
                    ↕ mirrored
         Coinbase Spend Permission (on-chain daily USDC cap)
```

The website does **not** offer “Connect MetaMask to limit my personal wallet.” That is out of product scope.

## Hard invariant (CDP / AgentKit)

**If the agent holds the private key to an address with USDC, prompts, gate, and Spend Permissions cannot stop a raw `transfer`.**

Working model only:

```text
USDC on owner Smart Account  (treasury key stays with the human)
        │
        │  Spend Permission: daily USDC → AgentKit wallet
        ▼
AgentKit / CDP address       (agent signing key or use_spend_permission only)
        │
        ▼
AllowLatch gate              (addresses, escalate, receipt)
```

| Setup | On-chain ceiling works? |
|-------|-------------------------|
| Treasury on owner SA; agent wallet only | Yes |
| Agent has full key to a funded EOA/SA | **No** |

## Modes (`ALLOWLATCH_ENFORCEMENT`)

| Mode | Behavior |
|------|----------|
| `hybrid` | **Default.** Receipt gate **and** mirror daily cap via CDP Spend Permission when an owner Smart Account + agent wallet are set. Without that, still receipt-only but labeled hybrid intent. |
| `middleware` | Receipt gate only — **not custody-grade** if the signer can bypass the gate. |
| `wallet_native` | Live execute **refuses** unless Spend Permission status is `synced`; pulls via `use_spend_permission` then transfers. |

## How owners set this up

**Primary:** Go live → **Copy for my AI** → agent follows `hybrid_plan` / CDP `createSpendPermission` (funded SA → AgentKit address) → optional `hybrid_report`.

**Advanced (operators):** UI Dry-run / Sync (`sync_wallet`) when host CDP can manage the funded Smart Account.

Site gate actions: `hybrid_plan` · `sync_wallet` · `hybrid_report`. Binding persists (Turso when durable).

## Operator / host env

```bash
# Owner smart account that holds USDC and grants the permission
ALLOWLATCH_SMART_ACCOUNT=0x...
# AgentKit / CDP wallet address
CDP_API_KEY_ID=...
CDP_API_KEY_SECRET=...
CDP_WALLET_SECRET=...
CDP_WALLET_ADDRESS=0x...   # agent wallet
ALLOWLATCH_ENFORCEMENT=hybrid   # or wallet_native
NETWORK_ID=base-sepolia
```

On `apply_policy` / `compile_mandate` / `sync_wallet_permissions` / site `sync_wallet`, AllowLatch calls CDP `createSpendPermission` with:

- token: USDC  
- allowance: `maxNotionalUsdPerDay`  
- period: 1 day  
- account: owner Smart Account  
- spender: AgentKit wallet  

**Host Sync note:** the funded SA must be manageable by the AllowLatch host CDP project. Most owners should use Copy for my AI instead.

## What this does / does not

- **Does:** hard on-chain ceiling so even a bypass of the HTTP gate cannot pull more than the daily USDC allowance **through that agent permission**.
- **Does not:** stop an agent that already has the funded private key; does not replace recipient allowlists / escalate on-chain (those stay in `engine.ts` + receipt); does not connect consumer browser wallets on the marketing site.

OpenServ capability: `sync_wallet_permissions` · site bindings under Turso `site_wallet_bindings` / memory map.
