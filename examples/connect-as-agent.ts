/**
 * How another agent connects to AllowLatch — no end-user SERV/CDP keys.
 *
 *   npx tsx examples/connect-as-agent.ts
 *   npx tsx examples/connect-as-agent.ts "draft mandate: max $10/tx, $40/day, USDC+ETH only"
 *
 * Discovery is public. Paying the x402 call needs a funded OpenServ/client wallet
 * on the *caller* agent (the owner's agent), not AllowLatch host secrets.
 *
 * discoverServices() may omit numeric workflowId — then we pay via webhookUrl / paywall.
 */
import { PlatformClient } from '@openserv-labs/client'

type Discovered = {
  id?: string
  name?: string
  x402Pricing?: string
  workflowId?: number
  paywallUrl?: string
  webhookUrl?: string
}

async function main() {
  const prompt =
    process.argv.slice(2).join(' ').trim() ||
    'draft and apply spending mandate for policyId default: Max $10 per transfer, $40 per day, only USDC and ETH, Uniswap allowed, ask me above $8, no meme coins. Then summarize the policy.'

  const client = new PlatformClient()
  console.log('Discovering OpenServ x402 services…')
  const services = (await client.payments.discoverServices()) as Discovered[]
  const allowlatch = services.find((s) => /allowlatch/i.test(String(s.name ?? '')))

  if (!allowlatch) {
    console.error(
      'AllowLatch not found in discoverServices().\n' +
        'The host must be running `npm run dev` (provisioned x402 workflow).\n' +
        'Until then use the demo UI: https://allowlatch.vercel.app\n' +
        'or install the allowlatch Cursor skill and point at docs/CONNECT.md.'
    )
    console.log(
      '\nKnown services (sample):',
      services.slice(0, 8).map((s) => ({
        name: s.name,
        price: s.x402Pricing,
      }))
    )
    process.exit(1)
  }

  console.log('Found:', allowlatch.name)
  console.log('Price: $' + (allowlatch.x402Pricing ?? '?'))
  console.log('Prompt:', prompt)

  const triggerUrl = allowlatch.webhookUrl
  const paywall = allowlatch.paywallUrl
  const workflowId = allowlatch.workflowId

  try {
    let result: unknown
    if (workflowId) {
      result = await client.payments.payWorkflow({
        workflowId,
        input: { prompt },
      })
    } else if (triggerUrl) {
      result = await client.payments.payWorkflow({
        triggerUrl,
        input: { prompt },
      })
    } else {
      throw new Error('Service has neither workflowId nor webhookUrl')
    }
    console.log('\nAllowLatch response:\n', JSON.stringify(result, null, 2))
  } catch (err) {
    console.error('\nProgrammatic pay failed:', err instanceof Error ? err.message : err)
    console.error(
      'Open the paywall in a browser (human pays ~$0.025), paste the same prompt, then retry.\n' +
        (paywall ? `Paywall: ${paywall}\n` : '') +
        (triggerUrl ? `Trigger: ${triggerUrl}\n` : '') +
        'Host must stay running (`npm run dev`). No end-user SERV_API_KEY required.'
    )
    process.exit(1)
  }
}

main()
