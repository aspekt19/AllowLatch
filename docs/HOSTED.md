# Hosted AllowLatch (OpenServ fallback)

> **Primary product path is always-on Vercel** `/api/gate` with native Base USDC x402.
> This document is for the **optional OpenServ** keep-alive only.


End users and their agents **never** run `npm run dev`, never set `SERV_API_KEY`, and never deploy this repo.

## Who runs what

| Role | Runs | Needs secrets? |
|------|------|----------------|
| **End user** | Nothing | No |
| **Their agent** | Prefer `/api/gate` native x402; OpenServ discover optional | Agent wallet key for x402 payment |
| **AllowLatch operator** (us) | Vercel always-on (+ optional OpenServ host) | `SERV_API_KEY`, CDP facilitator keys, OpenServ deploy key if used |

```text
You / your agent
    → Prefer always-on https://allowlatch.vercel.app/api/gate (native x402)
    → Optional: OpenServ discoverServices() / paywall when site gate unreachable
    → ALLOW + receipt → your wallet signs
```

## Public connection (OpenServ fallback)

| Field | Value |
|-------|--------|
| Service name | **AllowLatch Gate** (match `/allowlatch/i`) |
| Price | **$0.025** per call (or evaluate pack) |
| Paywall | https://platform.openserv.ai/workspace/paywall/d5bd76ab6637492c8dea60fabb590b53 |
| Trigger (webhook) | https://api.openserv.ai/webhooks/x402/trigger/d5bd76ab6637492c8dea60fabb590b53 |
| Live status | `GET https://allowlatch.vercel.app/api/host-info` → `openserv.isActive` (primary is `primary.gateUrl`) |

Agents can also omit hardcoded URLs and use:

```ts
const services = await client.payments.discoverServices()
const gate = services.find((s) => /allowlatch/i.test(s.name))
// gate.webhookUrl · gate.paywallUrl · gate.x402Pricing
```

## Operator: keep the gate online

The OpenServ listing exists even when idle (`isActive: false`). Calls only succeed while the AllowLatch process is reachable. **`isActive: true` can still hang** — always verify with a real `payWorkflow`.

**Reality check (OpenServ Cloud):** Fly containers often flip to `machineState: stopped` shortly after `goLive continuous` (exec/start 500s). Treat cloud keep-alive as best-effort. For judging / demos, prefer a **local tunnel host** (`npm run dev`) on a machine that stays awake, or Option B (your own VM).

### Option A — OpenServ Cloud container (keep-alive for fallback)

Official `npx @openserv-labs/client deploy` upload can 500. Prefer the slim always-on script (git clone into the container, retries on Cloudflare 502, reuses `OPENSERV_CONTAINER_ID` when healthy):

```bash
# Dashboard → https://platform.openserv.ai/profile/api-keys
# .env must contain OPENSERV_USER_API_KEY=…
# Script syncs OPENSERV_API_KEY from .openserv.json before deploy
npm run deploy:host
```

Re-run after agent code changes. Force a new box with `ALLOWLATCH_FORCE_FRESH_CONTAINER=1 npm run deploy:host`.

If discover stays `isActive: false` while status is `stopped`, fall back to Option B or C immediately — do not wait on cloud.

### Option B — Your own always-on host (**recommended** for `isActive: true`)

OpenServ Cloud containers sleep/502. Run the slim Dockerfile on **Railway / Fly / Render** instead:

1. Deploy `Dockerfile` (see `railway.toml`) with env:
   - `DISABLE_TUNNEL=true`, `PORT=7378`
   - `SERV_API_KEY`, `OPENSERV_API_KEY`, `OPENSERV_AUTH_TOKEN`, `OPENSERV_USER_API_KEY`, `WALLET_PRIVATE_KEY`
2. Point the OpenServ agent at the public HTTPS URL:

```bash
ALLOWLATCH_HOST_URL=https://YOUR-SERVICE.up.railway.app npm run host:point
```

3. Confirm `GET /api/host-info` → `openserv.isActive: true` (may take ~1 min).
4. Stop any local `npm run dev` / laptop tunnel — not needed anymore.

See `Dockerfile` + `scripts/point-openserv-endpoint.mjs`.

### Option C — Local tunnel (temporary only)

```bash
npm run dev   # SDK tunnel to agents-proxy.openserv.ai
# or: npx tsx src/agent.ts
```

Use only until Railway/Fly host is live. Keep the process running (laptop awake). Confirm `GET /api/host-info` → `openserv.isActive: true`.

Do **not** document Option C as the end-user path — operators only.

## After the gate is live

1. Confirm `discoverServices()` returns AllowLatch Gate with `isActive: true` (or host-info says so).
2. **Also** run a real `payWorkflow` ping — discover can report active while the process is hung; clients must fail-closed on timeout.
3. Set Vercel env `ALLOWLATCH_PAYWALL_URL` / `ALLOWLATCH_TRIGGER_URL` if they change after re-provision.
4. Demo UI **Go live** uses `/api/gate` on Vercel (always-on, sessionSeal). **Agent enforcement prefers `/api/gate` native x402**; OpenServ is fallback only.

### Known ops notes

- `npm run deploy:host` clones from GitHub into a slim Fly container (no AgentKit on disk) and `go-live continuous`. Retries 502s; reuses a healthy container by default.
- If `createContainer` / `exec` returns **502/5xx** after retries, fall back to Option B or C. **Do not claim cloud keep-alive is healthy until a real `payWorkflow` succeeds.**
- Stopping a laptop tunnel takes the **paid** agent gate offline until cloud keep-alive is restored. The **website** `/api/gate` stays up on Vercel.

See [CONNECT.md](./CONNECT.md) (users) · [MONETIZE.md](./MONETIZE.md) · [EMBED.md](./EMBED.md) (builders).
