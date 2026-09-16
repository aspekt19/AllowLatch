/**
 * How another agent talks to the SpendGate *gate* (keyless host).
 *
 * Prefer: draft MandatePolicy on the owner agent (SERV_API_KEY + src/owner/copilot.ts),
 * then send apply_policy with JSON here. See examples/owner-copilot.ts.
 *
 *   npx tsx examples/connect-as-agent.ts
 *   npx tsx examples/connect-as-agent.ts "apply_policy …"
 *
 * Discovery is public. x402 needs a funded caller wallet — not host SERV/CDP.
 */
import { PlatformClient } from '@openserv-labs/client'

async function main() {
  const prompt =
    process.argv.slice(2).join(' ').trim() ||
    'get_policy for policyId=default. If empty, tell me to run owner-side draft (SERV_API_KEY) then apply_policy with MandatePolicy JSON. Do not ask for SERV_API_KEY.'

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
        'Draft with owner SERV_API_KEY locally; never send that key to the gate.'
    )
    process.exit(1)
  }
}

main()
