# Wallet-native enforcement (roadmap)

AllowLatch today is **middleware authorization**:

```text
Agent → AllowLatch → AgentKit → wallet
```

If the same wallet can sign through another path, the middleware ledger cannot see it.

## Target pairing

Keep AllowLatch for NL → policy → receipt → audit, and **mirror critical caps** into wallet-native controls:

| Cap | Middleware (now) | Wallet-native (next) |
|-----|------------------|----------------------|
| Per-tx / daily USDC | `engine.ts` + SQLite ledger | Coinbase [Spend Permissions](https://docs.cdp.coinbase.com/wallets/using-wallets/spend-permissions) / Circle agent policies |
| Recipient allowlist | address lists | permission `spender` / allowlist on smart account |
| Emergency stop | `risk.emergencyStop` | revoke permission / pause account |

## Integration sketch (not wired in v1)

1. On `apply_policy`, optionally call CDP to create/update a Spend Permission that matches `maxPerOrderUsd` / period / token.
2. On `execute_gated_transfer`, AgentKit uses a session key that can only spend under that permission.
3. Reconciliation job compares on-chain transfers vs SQLite ledger.

Until that lands, pitch AllowLatch honestly as:

> transaction authorization + allow-receipt layer for AgentKit / HTTP agents on Base

—not as a cryptographically sealed wallet vault.
