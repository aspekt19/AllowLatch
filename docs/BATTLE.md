# AllowLatch — real battle checklist

## What “real battle” means

```
You (owner)
  → SERV Reasoning compiles mandate into policy (AllowLatch)
Spender (AgentKit wallet)
  → before every spend calls AllowLatch evaluate / gatedTransfer
  → only on ALLOW does AgentKit sign a Base USDC transfer
```

The Vercel UI is still a **demo dialog**. Live money moves only via CLI/`npm run battle` with CDP keys.

## 1. SERV Reasoning (already working)

`.env`:
```env
SERV_API_KEY=serv_...
```

```bash
npm run reasoning:ping
```

## 2. Coinbase AgentKit / CDP (for live txs)

1. Open [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com)
2. Create API key → copy **API Key ID** + **Secret**
3. Create / export **Wallet Secret** for a CDP EVM wallet
4. Put in `.env`:

```env
CDP_API_KEY_ID=...
CDP_API_KEY_SECRET=...
CDP_WALLET_SECRET=...
NETWORK_ID=base-sepolia
# Optional: existing wallet address
# CDP_WALLET_ADDRESS=0x...
# Your second wallet to receive test USDC (auto-allowlisted in battle)
# BATTLE_DESTINATION_ADDRESS=0x...
ALLOWLATCH_EXECUTE_MODE=live
```

5. Fund the **spender** CDP wallet on **Base Sepolia** with:
   - a little ETH (gas)
   - test USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`)

Faucets: Coinbase CDP faucet / Base Sepolia faucets (search current links).

## 3. Run battle

Dry-run (gate real, no chain):

```bash
npm run battle
```

Live (needs CDP + funds):

```bash
npm run battle -- --live
```

You should see Spender proposes → AllowLatch ALLOW/DENY → EXECUTED or BLOCKED.

## 4. Safety

- Start with **base-sepolia** and **$1** transfers
- Never commit `.env`
- Rotate any key that appeared in logs/chat
