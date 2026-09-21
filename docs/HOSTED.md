# Hosted AllowLatch (OpenServ fallback)

> **Primary product path is always-on Vercel** `/api/gate` with native Base USDC x402.
> This document is for the **optional OpenServ** keep-alive only.


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

The OpenServ listing exists even when idle (`isActive: false`). Calls only succeed while the AllowLatch process is reachable. **`isActive: true` can still hang** — always verify with a real `payWorkflow`.

### Option A — OpenServ Cloud container (primary)

Official `npx @openserv-labs/client deploy` upload can 500. Prefer the slim always-on script (git clone into the container, retries on Cloudflare 502, reuses `OPENSERV_CONTAINER_ID` when healthy):

```bash
# Dashboard → https://platform.openserv.ai/profile/api-keys
# .env must contain OPENSERV_USER_API_KEY=…
npm run deploy:host
```

Re-run after agent code changes. Force a new box with `ALLOWLATCH_FORCE_FRESH_CONTAINER=1 npm run deploy:host`.

### Option B — Your own always-on VM (Railway / Fly / Render)

When OpenServ container exec is degraded, host the same process yourself:

```bash
# Public HTTPS URL of this process
DISABLE_TUNNEL=true
# provision with agent.endpointUrl = that URL
npm run dev
```

See `Dockerfile` in the repo root for a slim Node image (`npm run start:host`).

### Option C — Local tunnel (dev / incident only)

```bash
npm run dev   # SDK tunnel to agents-proxy.openserv.ai
```

Do **not** document Option C as the end-user path.

## After the gate is live

1. Confirm `discoverServices()` returns AllowLatch Gate with `isActive: true` (or host-info says so).
2. **Also** run a real `payWorkflow` ping — discover can report active while the process is hung; clients must fail-closed on timeout.
3. Set Vercel env `ALLOWLATCH_PAYWALL_URL` / `ALLOWLATCH_TRIGGER_URL` if they change after re-provision.
4. Demo UI **Go live** uses `/api/gate` on Vercel (site backend — always-on, sessionSeal survives cold starts). Agent enforcement still uses OpenServ x402.

### Known ops notes

- `npm run deploy:host` clones from GitHub into a slim Fly container (no AgentKit on disk) and `go-live continuous`. Retries 502s; reuses a healthy container by default.
- If `createContainer` / `exec` returns **502/5xx** after retries, fall back to Option B or C. **Do not claim cloud keep-alive is healthy until a real `payWorkflow` succeeds.**
- Stopping a laptop tunnel takes the **paid** agent gate offline until cloud keep-alive is restored. The **website** `/api/gate` stays up on Vercel.

See [CONNECT.md](./CONNECT.md) (users) · [MONETIZE.md](./MONETIZE.md) · [EMBED.md](./EMBED.md) (builders).
