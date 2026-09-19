# Hosted AllowLatch (users run nothing)

End users and their agents **never** run `npm run dev`, never set `SERV_API_KEY`, and never deploy this repo.

## Who runs what

| Role | Runs | Needs secrets? |
|------|------|----------------|
| **End user** | Nothing | No |
| **Their agent** | Discover **AllowLatch Gate** → pay x402 ($0.025) | Only the agent's own wallet key for x402 payment |
| **AllowLatch operator** (us) | One always-on OpenServ host | `SERV_API_KEY`, optional CDP, OpenServ deploy key |

```text
You / your agent
    → OpenServ discoverServices() / paywall
    → AllowLatch Gate (hosted by AllowLatch)
    → ALLOW + receipt → your wallet signs
```

## Public connection (no local host)

| Field | Value |
|-------|--------|
| Service name | **AllowLatch Gate** (match `/allowlatch/i`) |
| Price | **$0.025** per call (or evaluate pack) |
| Paywall | https://platform.openserv.ai/workspace/paywall/d5bd76ab6637492c8dea60fabb590b53 |
| Trigger (webhook) | https://api.openserv.ai/webhooks/x402/trigger/d5bd76ab6637492c8dea60fabb590b53 |
| Live status | `GET https://allowlatch.vercel.app/api/host-info` → `gate.isActive` |

Agents can also omit hardcoded URLs and use:

```ts
const services = await client.payments.discoverServices()
const gate = services.find((s) => /allowlatch/i.test(s.name))
// gate.webhookUrl · gate.paywallUrl · gate.x402Pricing
```

## Operator: keep the gate online

The OpenServ listing exists even when idle (`isActive: false`). Calls only succeed while the AllowLatch process is reachable.

### Option A — OpenServ Cloud (preferred)

```bash
# Dashboard → API key (not the agent key from provision)
echo 'OPENSERV_USER_API_KEY=...' >> .env
npm run dev          # once: provision() writes .openserv.json
npm run deploy:openserv
```

This runs `npx @openserv-labs/client deploy .` and keeps the agent on OpenServ managed containers (`go-live`).

### Option B — Always-on VM / Railway / Fly

```bash
# Public HTTPS URL of this process
DISABLE_TUNNEL=true
# provision with agent.endpointUrl = that URL
npm run dev
```

### Option C — Local tunnel (dev only)

```bash
npm run dev   # SDK tunnel to agents-proxy.openserv.ai
```

Do **not** document Option C as the end-user path.

## After the gate is live

1. Confirm `discoverServices()` returns AllowLatch Gate with `isActive: true` (or host-info says so).
2. Set Vercel env `ALLOWLATCH_PAYWALL_URL` / `ALLOWLATCH_TRIGGER_URL` if they change after re-provision.
3. Demo UI **Enforce** CTA uses the paywall URL from `/api/host-info`.

See [CONNECT.md](./CONNECT.md) (users) · [MONETIZE.md](./MONETIZE.md) · [EMBED.md](./EMBED.md) (builders).
