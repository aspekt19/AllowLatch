import { compileMandateLocally } from '../src/policy/local-compile.ts'
import { commitIntent, evaluateIntent, freshLedger } from '../src/policy/engine.ts'
import type { EvaluationResult, MandatePolicy, SpendIntent, SpendLedger } from '../src/policy/schema.ts'

type Phase = 'mandate' | 'spend' | 'escalate'
type Role = 'you' | 'guard' | 'spender'

const UNISWAP = '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD'
const EXAMPLE_MANDATE =
  'Agent wallet budget $200 on Base. Max $10 per transfer, $40 per day. Only USDC and ETH. Uniswap router allowed. Ask me above $8. No meme coins.'

const messagesEl = document.querySelector<HTMLDivElement>('#messages')!
const policyView = document.querySelector<HTMLPreElement>('#policy-view')!
const ledgerView = document.querySelector<HTMLParagraphElement>('#ledger-view')!
const phaseLabel = document.querySelector<HTMLDivElement>('#phase-label')!
const form = document.querySelector<HTMLFormElement>('#composer')!
const input = document.querySelector<HTMLTextAreaElement>('#input')!
const btnExample = document.querySelector<HTMLButtonElement>('#btn-example')!

let phase: Phase = 'mandate'
let policy: MandatePolicy | null = null
let ledger: SpendLedger = freshLedger()
let pendingEscalate: SpendIntent | null = null

function setPhase(next: Phase) {
  phase = next
  const labels: Record<Phase, string> = {
    mandate: 'Phase 1 · Set mandate',
    spend: 'Phase 2 · Spender proposes',
    escalate: 'Phase 3 · Human confirm',
  }
  phaseLabel.textContent = labels[next]
  input.placeholder =
    next === 'mandate'
      ? 'Describe spending rules for your agent…'
      : next === 'escalate'
        ? 'Type yes to approve, or no to deny…'
        : 'Describe a spend, or tap a quick scenario…'
}

function addMessage(role: Role, body: string, extraClass = '') {
  const el = document.createElement('article')
  el.className = `msg ${role} ${extraClass}`.trim()
  const who =
    role === 'you' ? 'You · owner' : role === 'guard' ? 'MandateGuard' : 'Spender · AgentKit'
  el.innerHTML = `<p class="who">${who}</p><p class="body"></p>`
  el.querySelector('.body')!.textContent = body
  messagesEl.appendChild(el)
  messagesEl.scrollTop = messagesEl.scrollHeight
  return el
}

function addDecision(result: EvaluationResult) {
  const lines = [
    `${result.decision.toUpperCase()}`,
    ...result.reasons.map((r) => `• ${r}`),
    `Remaining daily: $${result.remainingDailyUsd.toFixed(2)}`,
  ]
  addMessage('guard', lines.join('\n'), `decision ${result.decision}`)
}

function renderPolicy() {
  if (!policy) {
    policyView.textContent = 'No policy yet.'
    return
  }
  policyView.textContent = JSON.stringify(
    {
      name: policy.name,
      capital: policy.capital,
      escalation: policy.escalation,
      allowedSymbols: policy.universe.allowedSymbols,
      allowedAddresses: policy.universe.allowedAddresses,
      actions: policy.actions,
    },
    null,
    2
  )
}

function renderLedger() {
  ledgerView.textContent = `$${ledger.spentUsdToday.toFixed(2)} spent · ${ledger.txCountThisHour} tx this hour`
}

function addSpendChips() {
  const wrap = document.createElement('div')
  wrap.className = 'chips'
  const scenarios: { label: string; intent: SpendIntent; asSpender?: boolean }[] = [
    {
      label: 'OK · $8 ETH via Uniswap',
      intent: {
        action: 'swap',
        amountUsd: 8,
        symbol: 'ETH',
        toAddress: UNISWAP,
        reason: 'Rebalance idle USDC',
      },
      asSpender: true,
    },
    {
      label: 'Deny · $5 PEPE',
      intent: {
        action: 'swap',
        amountUsd: 5,
        symbol: 'PEPE',
        toAddress: UNISWAP,
        reason: 'YOLO',
      },
      asSpender: true,
    },
    {
      label: 'Deny · $50 transfer',
      intent: {
        action: 'transfer',
        amountUsd: 50,
        toAddress: UNISWAP,
        reason: 'Large payout',
      },
      asSpender: true,
    },
    {
      label: 'Escalate · $9 x402',
      intent: {
        action: 'x402_pay',
        amountUsd: 9,
        toAddress: UNISWAP,
        reason: 'Pay research API',
      },
      asSpender: true,
    },
    {
      label: 'Deny · unknown address',
      intent: {
        action: 'transfer',
        amountUsd: 3,
        toAddress: '0x000000000000000000000000000000000000dEaD',
        reason: 'Wrong paste',
      },
      asSpender: true,
    },
  ]

  for (const s of scenarios) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'chip'
    btn.textContent = s.label
    btn.addEventListener('click', () => runSpend(s.intent, true))
    wrap.appendChild(btn)
  }

  const host = addMessage(
    'guard',
    'Policy is live. The Spender agent will propose actions. Tap a scenario or type something like: “transfer $8 to Uniswap”.'
  )
  host.appendChild(wrap)
}

function parseSpend(text: string): SpendIntent | null {
  const lower = text.toLowerCase()
  const amountMatch = lower.match(/\$?\s*(\d+(?:\.\d+)?)/)
  if (!amountMatch) return null
  const amountUsd = Number(amountMatch[1])
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return null

  let action: SpendIntent['action'] = 'transfer'
  if (/swap|свап/.test(lower)) action = 'swap'
  if (/x402|api|pay/.test(lower)) action = 'x402_pay'

  const addr = text.match(/0x[a-fA-F0-9]{40}/)?.[0]
  const symbol = text.toUpperCase().match(/\b(ETH|WETH|USDC|PEPE|DOGE|SHIB)\b/)?.[1]

  return {
    action,
    amountUsd,
    symbol,
    toAddress: addr ?? ( /uniswap/i.test(text) ? UNISWAP : undefined),
    reason: text,
  }
}

function runSpend(intent: SpendIntent, fromChip = false) {
  if (!policy) return

  const summary = `${intent.action} $${intent.amountUsd}${intent.symbol ? ` ${intent.symbol}` : ''}${
    intent.toAddress ? `\n→ ${intent.toAddress}` : ''
  }${intent.reason ? `\nreason: ${intent.reason}` : ''}`

  addMessage('spender', `Proposing spend:\n${summary}`)

  const result = evaluateIntent(policy, intent, ledger)
  addDecision(result)

  if (result.decision === 'allow') {
    ledger = commitIntent(ledger, intent)
    renderLedger()
    addMessage('guard', 'ALLOW recorded. In production, AgentKit would sign on Base only now.')
  } else if (result.decision === 'escalate') {
    pendingEscalate = intent
    setPhase('escalate')
    addMessage(
      'guard',
      'This needs your confirmation. Reply “yes” to approve for AgentKit, or “no” to block.'
    )
  } else if (!fromChip) {
    // keep phase
  }
}

function handleMandate(text: string) {
  addMessage('you', text)
  policy = compileMandateLocally(text)
  ledger = freshLedger()
  renderPolicy()
  renderLedger()
  addMessage(
    'guard',
    `Mandate compiled into a Base/USDC policy.\n\nLimits: $${policy.capital.maxPerOrderUsd}/tx · $${policy.capital.maxNotionalUsdPerDay}/day\nConfirm above: $${policy.escalation.requireHumanConfirmAboveUsd}\nSymbols: ${policy.universe.allowedSymbols.join(', ') || 'any'}\n\nI am the turnstile. The Spender agent cannot move funds unless I allow it.`
  )
  setPhase('spend')
  addSpendChips()
}

function handleEscalate(text: string) {
  addMessage('you', text)
  const yes = /^(y|yes|да|ok|approve|разреш)/i.test(text.trim())
  const no = /^(n|no|нет|deny|reject|запрет)/i.test(text.trim())
  if (!pendingEscalate) {
    setPhase('spend')
    return
  }
  if (yes) {
    ledger = commitIntent(ledger, pendingEscalate)
    renderLedger()
    addMessage(
      'guard',
      'Human approved. Treated as ALLOW for this one spend. AgentKit may execute.'
    )
    pendingEscalate = null
    setPhase('spend')
    return
  }
  if (no) {
    addMessage('guard', 'Human rejected. Spend blocked. No AgentKit signature.')
    pendingEscalate = null
    setPhase('spend')
    return
  }
  addMessage('guard', 'Please reply yes or no.')
}

function onSubmit(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return

  if (phase === 'mandate') {
    handleMandate(trimmed)
    return
  }
  if (phase === 'escalate') {
    handleEscalate(trimmed)
    return
  }

  addMessage('you', trimmed)
  const intent = parseSpend(trimmed)
  if (!intent) {
    addMessage(
      'guard',
      'Could not parse a spend. Try: “transfer $8 to Uniswap” or use the chips above.'
    )
    return
  }
  // User typed a spend — show as if spender proposed it (skip duplicate you as spender)
  // Remove the "you" framing for evaluation path: already added you; run evaluate without re-adding you
  messagesEl.lastElementChild?.remove()
  runSpend(intent, false)
}

form.addEventListener('submit', (e) => {
  e.preventDefault()
  const value = input.value
  input.value = ''
  onSubmit(value)
})

btnExample.addEventListener('click', () => {
  input.value = EXAMPLE_MANDATE
  input.focus()
})

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    form.requestSubmit()
  }
})

// Boot dialog
addMessage(
  'guard',
  'I am MandateGuard — the spending turnstile for an AgentKit wallet on Base.\n\nFirst, tell me the rules for your agent (limits, allowed tokens/addresses, when to ask you).\n\nThen a Spender agent will try to move USDC. I will allow, deny, or escalate.'
)
setPhase('mandate')
renderPolicy()
renderLedger()
