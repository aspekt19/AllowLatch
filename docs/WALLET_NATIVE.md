# Wallet-native enforcement

AllowLatch combines two layers:

```text
NL mandate → engine.ts (ALLOW + receipt) → AgentKit
                    ↕ mirrored
         Coinbase Spend Permission (on-chain daily USDC cap)
```

## Hard invariant (CDP / AgentKit)

**If the agent holds the private key to an address with USDC, prompts, gate, and Spend Permissions cannot stop a raw `transfer`.**

Working model only:

```text
USDC on owner Smart Account  (treasury key stays with the human)
        │
        │  Spend Permission: daily USDC → spender
        ▼
Agent / spender address      (spender key or use_spend_permission only)
        │
        ▼
AllowLatch gate              (addresses, escalate, receipt)
```

| Setup | On-chain ceiling works? |
|-------|-------------------------|
| Treasury on owner SA; agent is spender only | Yes |
| Agent has full key to a funded EOA/SA | **No** |

## Modes (`ALLOWLATCH_ENFORCEMENT`)

| Mode | Behavior |
|------|----------|
| `hybrid` | **Default.** Receipt gate **and** mirror daily cap via CDP Spend Permission when an owner Smart Account + spender are set. Without that, still receipt-only but labeled hybrid intent. |
| `middleware` | Receipt gate only — **not custody-grade** if the signer can bypass the gate. |
| `wallet_native` | Live execute **refuses** unless Spend Permission status is `synced`; pulls via `use_spend_permission` then transfers. |

## Dual setup paths (after Go live)

| Path | Who | How |
|------|-----|-----|
| **A · Human Smart Account** | Owner | UI form (or `POST /api/gate` `action=sync_wallet`) with `ownerToken`, owner SA, agent spender. Host CDP `createSpendPermission`. Wallet need not stay online. |
| **B · Agent CDP/AgentKit** | Agent | Connect pack → `hybrid_plan` → agent `createSpendPermission` **from owner SA to spender** (not “permission to self with treasury key”) → optional `hybrid_report`. |

Site gate actions: `hybrid_plan` · `sync_wallet` · `hybrid_report`. Binding persists (Turso when durable).

## Operator / host env

```bash
# Owner smart account that holds USDC and grants the permission
ALLOWLATCH_SMART_ACCOUNT=0x...
# Spender = AgentKit / CDP wallet (CDP_WALLET_ADDRESS)
CDP_API_KEY_ID=...
CDP_API_KEY_SECRET=...
CDP_WALLET_SECRET=...
CDP_WALLET_ADDRESS=0x...   # spender
ALLOWLATCH_ENFORCEMENT=hybrid   # or wallet_native
NETWORK_ID=base-sepolia
```

On `apply_policy` / `compile_mandate` / `sync_wallet_permissions` / site `sync_wallet`, AllowLatch calls CDP `createSpendPermission` with:

- token: USDC  
- allowance: `maxNotionalUsdPerDay`  
- period: 1 day  
- account: owner Smart Account  
- spender: agent spender  

**Path A note:** the owner SA must be manageable by the AllowLatch host CDP project.

## What this does / does not

- **Does:** hard on-chain ceiling so even a bypass of the HTTP gate cannot pull more than the daily USDC allowance **through that spender permission**.
- **Does not:** stop an agent that already has the funded private key; does not replace recipient allowlists / escalate on-chain (those stay in `engine.ts` + receipt).

OpenServ capability: `sync_wallet_permissions` · site bindings under Turso `site_wallet_bindings` / memory map.
