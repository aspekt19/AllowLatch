# Connect to AllowLatch (for humans & their agents)

Full guide: [GUIDE.md](./GUIDE.md).


You do **not** run a server. You do **not** need `SERV_API_KEY`.

## Two surfaces

| Surface | What it is | Always on? |
|---------|------------|------------|
| **Primary** https://allowlatch.vercel.app/api/gate | Go live + Connect. Website Origin **free to try**. Agents pay **$0.025 USDC** via native x402 on Base. | **Yes** (Vercel) |
| **OpenServ fallback** | discover `/allowlatch/i` · trigger/paywall | Only while operator host is reachable |

Install: https://allowlatch.vercel.app/#install  
Skill (any LLM): [`skills/allowlatch/SKILL.md`](../skills/allowlatch/SKILL.md)

## Try on the website

1. Open https://allowlatch.vercel.app → Draft → Apply → **Go live**
2. Try ALLOW / DENY / ESCALATE (free from the site)
3. **Connect your agent** → copy `gateUrl` + `sessionSeal`

## Agent path

```ts
import { assertSpend } from 'allowlatch'

await assertSpend({
  policyId: 'web-…',
  gateUrl: 'https://allowlatch.vercel.app/api/gate',
  sessionSeal: process.env.ALLOWLATCH_SESSION_SEAL,
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY, // pays $0.025 on Base
  intent: { action: 'transfer', amountUsd: 5, toAddress: '0x…', symbol: 'USDC' },
})
```

Optional OpenServ fallback: pass `triggerUrl` (assertSpend tries site gate first, then OpenServ).

Public card: `GET https://allowlatch.vercel.app/api/host-info`

## Operator

- Vercel needs `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` + `WALLET_PRIVATE_KEY` or `ALLOWLATCH_X402_PAY_TO`
- OpenServ host (`npm run deploy:host`) is **optional fallback** only — see [HOSTED.md](./HOSTED.md)

Monetization: [MONETIZE.md](./MONETIZE.md) · Embed: [EMBED.md](./EMBED.md)
