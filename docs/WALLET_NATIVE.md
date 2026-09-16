# Wallet-native enforcement

AllowLatch combines two layers:

```text
NL mandate → engine.ts (ALLOW + receipt) → AgentKit
                    ↕ mirrored
         Coinbase Spend Permission (on-chain daily USDC cap)
```

## Modes (`ALLOWLATCH_ENFORCEMENT`)

| Mode | Behavior |
|------|----------|
| `middleware` | Receipt gate only (default if no smart account). |
| `hybrid` | Receipt gate **and** mirror daily cap via CDP Spend Permission when `ALLOWLATCH_SMART_ACCOUNT` is set (default if smart account env present). |
| `wallet_native` | Live execute **refuses** unless Spend Permission status is `synced`; pulls via `use_spend_permission` then transfers. |

## Setup

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

On `apply_policy` / `compile_mandate` / `sync_wallet_permissions`, AllowLatch calls CDP `createSpendPermission` with:

- token: USDC  
- allowance: `maxNotionalUsdPerDay`  
- period: 1 day  
- spender: CDP wallet  

## What this does / does not

- **Does:** hard on-chain ceiling so even a bypass of the HTTP/OpenServ gate cannot pull more than the daily USDC allowance through that spender permission.
- **Does not:** replace recipient allowlists / escalate on-chain (those stay in `engine.ts` + receipt). Pair both.

Capability: `sync_wallet_permissions` · stored under `wallet_bindings` in SQLite.
