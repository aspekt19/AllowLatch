import { draftPolicyLocally } from '../src/policy/local-compile.ts'
import { commitIntent, evaluateIntent, freshLedger } from '../src/policy/engine.ts'
import type {
  EvaluationResult,
  MandatePolicy,
  PolicyDraft,
  SpendIntent,
  SpendLedger,
} from '../src/policy/schema.ts'

type Phase = 'mandate' | 'review' | 'spend' | 'escalate'
type Role = 'you' | 'guard' | 'spender'

const UNISWAP = '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD'
const EXAMPLE_MANDATE =
  'Agent wallet budget $200 on Base. Max $10 per transfer, $40 per day. Only USDC and ETH. Uniswap router allowed. Ask me above $8. No meme coins.'
const MESSY_EXAMPLE =
  'Agent wallet about $200. Maybe $10 per transfer or wait maybe $25? $40 a day but weekends can be higher. Only USDC and ETH, Uniswap ok. Ask me above $8. No memes. Also allow any address? Wait — only Uniswap.'

const messagesEl = document.querySelector<HTMLDivElement>('#messages')!
const policyEmpty = document.querySelector<HTMLDivElement>('#policy-empty')!
const policyLive = document.querySelector<HTMLDivElement>('#policy-live')!
const policyName = document.querySelector<HTMLParagraphElement>('#policy-name')!
const policyGrid = document.querySelector<HTMLDListElement>('#policy-grid')!
const policyStatus = document.querySelector<HTMLSpanElement>('#policy-status')!
const ledgerView = document.querySelector<HTMLParagraphElement>('#ledger-view')!
const ledgerSub = document.querySelector<HTMLParagraphElement>('#ledger-sub')!
const phaseLabel = document.querySelector<HTMLDivElement>('#phase-label')!
const consoleHint = document.querySelector<HTMLParagraphElement>('#console-hint')!
const form = document.querySelector<HTMLFormElement>('#composer')!
const input = document.querySelector<HTMLTextAreaElement>('#input')!
const btnExample = document.querySelector<HTMLButtonElement>('#btn-example')!
const btnSend = document.querySelector<HTMLButtonElement>('#btn-send')!

let phase: Phase = 'mandate'
let policy: MandatePolicy | null = null
let pendingDraft: PolicyDraft | null = null
let lastMandate = ''
let ledger: SpendLedger = freshLedger()
let pendingEscalate: SpendIntent | null = null

function setPhase(next: Phase) {
  phase = next
  const hints: Record<Phase, string> = {
    mandate: 'Describe how your agent may spend',
    review: 'Apply the draft, or clarify the mandate',
    spend: 'Propose a spend or use a scenario below',
    escalate: 'Approve or reject this spend',
  }
  consoleHint.textContent = hints[next]

  const steps = phaseLabel.querySelectorAll<HTMLElement>('.step')
  steps.forEach((el) => {
    el.classList.remove('is-active', 'is-done')
    const n = Number(el.dataset.step)
    if (next === 'mandate' && n === 1) el.classList.add('is-active')
    if (next === 'review') {
      if (n === 1) el.classList.add('is-done')
      if (n === 2) el.classList.add('is-active')
    }
    if (next === 'spend' || next === 'escalate') {
      if (n <= 2) el.classList.add('is-done')
      if (n === 3) el.classList.add('is-active')
    }
  })

  input.placeholder =
    next === 'mandate'
      ? 'e.g. Max $10 per transfer, $40/day, only USDC & ETH, ask me above $8…'
      : next === 'review'
        ? 'Type “apply”, or clarify (e.g. use $10 per transfer, Uniswap only)…'
        : next === 'escalate'
          ? 'Type yes to approve, or no to deny…'
          : 'e.g. transfer $8 to Uniswap — or tap a scenario'

  const sendLabel = btnSend.querySelector('span:first-child')
  if (sendLabel) {
    sendLabel.textContent =
      next === 'mandate'
        ? 'Draft policy'
        : next === 'review'
          ? 'Apply / clarify'
          : next === 'escalate'
            ? 'Reply'
            : 'Send'
  }
}

function addMessage(role: Role, body: string, extraClass = '') {
  const el = document.createElement('article')
  el.className = `msg ${role} ${extraClass}`.trim()
  const who =
    role === 'you' ? 'You · owner' : role === 'guard' ? 'SpendGate' : 'Spender · AgentKit'
  el.innerHTML = `<p class="who">${who}</p><div class="body"></div>`
  const bodyEl = el.querySelector('.body')!

  if (extraClass.includes('decision')) {
    const [head, ...rest] = body.split('\n')
    bodyEl.appendChild(document.createTextNode(head))
    if (rest.length) {
      const restEl = document.createElement('span')
      restEl.className = 'decision-rest'
      restEl.textContent = rest.join('\n')
      bodyEl.appendChild(restEl)
    }
  } else {
    bodyEl.textContent = body
  }

  messagesEl.appendChild(el)
  messagesEl.scrollTop = messagesEl.scrollHeight
  return el
}

function addDecision(result: EvaluationResult) {
  const lines = [
    result.decision.toUpperCase(),
    ...result.reasons.map((r) => `• ${r}`),
    `Remaining daily · $${result.remainingDailyUsd.toFixed(2)}`,
  ]
  addMessage('guard', lines.join('\n'), `decision ${result.decision}`)
}

function renderPolicy() {
  if (!policy) {
    policyEmpty.classList.remove('is-hidden')
    policyLive.classList.add('is-hidden')
    policyStatus.textContent = pendingDraft ? 'Draft' : 'Idle'
    policyStatus.classList.toggle('is-live', Boolean(pendingDraft))
    if (pendingDraft) {
      policyEmpty.classList.add('is-hidden')
      policyLive.classList.remove('is-hidden')
      policyName.textContent = pendingDraft.policy.name
      fillPolicyGrid(pendingDraft.policy)
    }
    return
  }

  policyEmpty.classList.add('is-hidden')
  policyLive.classList.remove('is-hidden')
  policyStatus.textContent = 'Live'
  policyStatus.classList.add('is-live')
  policyName.textContent = policy.name
  fillPolicyGrid(policy)
}

function fillPolicyGrid(p: MandatePolicy) {
  const rows: [string, string][] = [
    ['Per order', `$${p.capital.maxPerOrderUsd}`],
    ['Daily cap', `$${p.capital.maxNotionalUsdPerDay}`],
    ['Confirm above', `$${p.escalation.requireHumanConfirmAboveUsd}`],
    [
      'Symbols',
      p.universe.allowedSymbols.length ? p.universe.allowedSymbols.join(', ') : 'any',
    ],
    [
      'Addresses',
      p.universe.allowedAddresses.length
        ? `${p.universe.allowedAddresses.length} allowlisted`
        : 'open',
    ],
    [
      'Actions',
      [
        p.actions.allowTransfer && 'transfer',
        p.actions.allowSwap && 'swap',
        p.actions.allowX402Pay && 'x402',
      ]
        .filter(Boolean)
        .join(' · ') || 'none',
    ],
  ]

  policyGrid.innerHTML = rows
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v.replace(/</g, '&lt;')}</dd></div>`)
    .join('')
}

function renderLedger() {
  ledgerView.textContent = `$${ledger.spentUsdToday.toFixed(2)}`
  ledgerSub.textContent = `${ledger.txCountThisHour} tx this hour`
}

function showDraftReview(draft: PolicyDraft) {
  pendingDraft = draft
  policy = null
  renderPolicy()

  const lines = [
    'Policy draft ready for review (Policy Copilot).',
    '',
    draft.summary,
  ]
  if (draft.conflicts.length) {
    lines.push('', 'Conflicts:')
    for (const c of draft.conflicts) lines.push(`• ${c}`)
  }
  if (draft.assumptions.length) {
    lines.push('', 'Assumptions:')
    for (const a of draft.assumptions) lines.push(`• ${a}`)
  }
  if (draft.questions.length) {
    lines.push('', 'Questions:')
    for (const q of draft.questions) lines.push(`• ${q}`)
  }
  lines.push(
    '',
    draft.readyToApply
      ? 'Reply “apply” to activate the gate, or clarify further.'
      : 'Clarify the questions, or reply “apply anyway” to accept this conservative draft.'
  )

  const host = addMessage('guard', lines.join('\n'))
  const wrap = document.createElement('div')
  wrap.className = 'chips'
  for (const [label, fn] of [
    ['Apply policy', () => applyDraft(false)],
    ['Apply anyway', () => applyDraft(true)],
    ['Messy example', () => {
      input.value = MESSY_EXAMPLE
      input.focus()
    }],
  ] as const) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'chip'
    btn.textContent = label
    btn.addEventListener('click', fn)
    wrap.appendChild(btn)
  }
  host.appendChild(wrap)
  setPhase('review')
}

function applyDraft(_force: boolean) {
  if (!pendingDraft) return
  policy = pendingDraft.policy
  pendingDraft = null
  ledger = freshLedger()
  renderPolicy()
  renderLedger()
  addMessage(
    'guard',
    `Policy applied. Gate is live.\n\n$${policy.capital.maxPerOrderUsd}/tx · $${policy.capital.maxNotionalUsdPerDay}/day · confirm above $${policy.escalation.requireHumanConfirmAboveUsd}\n\nThe Spender may propose spends now — I allow, deny, or escalate.`
  )
  setPhase('spend')
  addSpendChips()
}

function addSpendChips() {
  const wrap = document.createElement('div')
  wrap.className = 'chips'
  const scenarios: { label: string; intent: SpendIntent }[] = [
    {
      label: 'ALLOW · $8 ETH',
      intent: {
        action: 'swap',
        amountUsd: 8,
        symbol: 'ETH',
        toAddress: UNISWAP,
        reason: 'Rebalance idle USDC',
      },
    },
    {
      label: 'DENY · PEPE',
      intent: {
        action: 'swap',
        amountUsd: 5,
        symbol: 'PEPE',
        toAddress: UNISWAP,
        reason: 'YOLO',
      },
    },
    {
      label: 'DENY · $50',
      intent: {
        action: 'transfer',
        amountUsd: 50,
        toAddress: UNISWAP,
        reason: 'Large payout',
      },
    },
    {
      label: 'ESCALATE · $9',
      intent: {
        action: 'x402_pay',
        amountUsd: 9,
        toAddress: UNISWAP,
        reason: 'Pay research API',
      },
    },
    {
      label: 'DENY · unknown addr',
      intent: {
        action: 'transfer',
        amountUsd: 3,
        toAddress: '0x000000000000000000000000000000000000dEaD',
        reason: 'Wrong paste',
      },
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

  const host = addMessage('guard', 'Try a Spender scenario:')
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
    toAddress: addr ?? (/uniswap/i.test(text) ? UNISWAP : undefined),
    reason: text,
  }
}

function runSpend(intent: SpendIntent, _fromChip = false) {
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
    addMessage(
      'guard',
      'ALLOW recorded on the ledger. In production, AgentKit signs on Base only at this point.'
    )
  } else if (result.decision === 'escalate') {
    pendingEscalate = intent
    setPhase('escalate')
    addMessage(
      'guard',
      'Above your confirm threshold. Reply yes to treat as ALLOW for AgentKit, or no to block.'
    )
  } else {
    addMessage(
      'guard',
      'Blocked. In production, explain_decision (SERV) would suggest mandate edits — here the reasons above are the gate truth.'
    )
  }
}

function handleMandate(text: string) {
  addMessage('you', text)
  lastMandate = text
  const draft = draftPolicyLocally(text)
  showDraftReview(draft)
}

function handleReview(text: string) {
  addMessage('you', text)
  const t = text.trim().toLowerCase()
  if (/^(apply(\s+anyway)?|yes|ok|accept|примен)/i.test(t)) {
    applyDraft(/anyway/.test(t))
    return
  }
  // Treat as clarification → re-draft with combined mandate
  lastMandate = `${lastMandate}\n\nClarification: ${text.trim()}`
  const draft = draftPolicyLocally(lastMandate)
  showDraftReview(draft)
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
  if (phase === 'review') {
    handleReview(trimmed)
    return
  }
  if (phase === 'escalate') {
    handleEscalate(trimmed)
    return
  }

  addMessage('you', text)
  const intent = parseSpend(trimmed)
  if (!intent) {
    addMessage(
      'guard',
      'Could not parse a spend. Try: “transfer $8 to Uniswap” or use the scenarios above.'
    )
    return
  }
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

addMessage(
  'guard',
  'I am SpendGate — Policy Copilot and spending turnstile for an AgentKit wallet on Base.\n\n1. You state the mandate.\n2. I draft a policy with conflicts, assumptions, and questions — you review, then apply.\n3. Spender proposes spends; I allow, deny, or escalate. AgentKit moves USDC only after ALLOW.\n\nStart with your rules, or load the example.'
)
setPhase('mandate')
renderPolicy()
renderLedger()
