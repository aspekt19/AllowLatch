/**
 * How another agent connects to SpendGate — no end-user SERV/CDP keys.
 *
 *   npx tsx examples/connect-as-agent.ts
 *   npx tsx examples/connect-as-agent.ts "draft mandate: max $10/tx, $40/day, USDC+ETH only"
 *
 * Discovery is public. Paying the x402 call needs a funded OpenServ/client wallet
 * on the *caller* agent (the owner's agent), not SpendGate host secrets.
 */
import { PlatformClient } from '@openserv-labs/client'

async function main() {
  const prompt =
    process.argv.slice(2).join(' ').trim() ||
    'draft and apply spending mandate for policyId default: Max $10 per transfer, $40 per day, only USDC and ETH, Uniswap allowed, ask me above $8, no meme coins. Then summarize the policy.'

  const client = new PlatformClient()
  console.log('Discovering OpenServ x402 services…')
  const services = await client.payments.discoverServices()
  const spendgate = services.find((s: { name?: string }) =>
    /spendgate/i.test(String(s.name ?? ''))
  )

  if (!spendgate) {
    console.error(
      'SpendGate not found in discoverServices().\n' +
        'The host must be running `npm run dev` (provisioned x402 workflow).\n' +
        'Until then use the demo UI: https://spendgate.vercel.app\n' +
        'or install the spendgate Cursor skill and point at docs/CONNECT.md.'
    )
    console.log(
      '\nKnown services (sample):',
      services.slice(0, 8).map((s: { name?: string; x402Pricing?: string }) => ({
        name: s.name,
        price: s.x402Pricing,
      }))
    )
    process.exit(1)
  }

  console.log('Found:', spendgate.name, 'workflowId=', (spendgate as { workflowId?: number }).workflowId)
  console.log('Prompt:', prompt)

  // payWorkflow requires caller credentials / wallet for x402 settlement.
  // If this throws auth errors, the owner's agent should open the paywall URL instead.
  try {
    const workflowId = (spendgate as { workflowId?: number }).workflowId
    if (!workflowId) throw new Error('Service has no workflowId')

    const result = await client.payments.payWorkflow({
      workflowId,
      input: { prompt },
    })
    console.log('\nSpendGate response:\n', JSON.stringify(result, null, 2))
  } catch (err) {
    const paywall =
      (spendgate as { paywallUrl?: string; webhookUrl?: string }).paywallUrl ||
      (spendgate as { webhookUrl?: string }).webhookUrl
    console.error('\nProgrammatic pay failed:', err instanceof Error ? err.message : err)
    console.error(
      'Have the human complete the OpenServ paywall, then retry.\n' +
        (paywall ? `Paywall / trigger: ${paywall}\n` : '') +
        'Still no end-user SERV_API_KEY required.'
    )
    process.exit(1)
  }
}

main()
