export const meta = {
  name: 'integra-audit',
  description: 'Bounded read-only audit with adversarial verification',
  whenToUse: 'Independent codebase findings that need cross-checking',
  phases: [
    { title: 'Plan', detail: 'Fable defines the bounded audit plan' },
    { title: 'Audit and verify', detail: 'Sonnet workers inspect independent items' },
    { title: 'Synthesize', detail: 'Fable ranks verified findings' },
  ],
}

const input = args ?? {}
const requestedItems = Array.isArray(input.items) ? input.items : []
const maxAgents = Math.min(Math.max(Number(input.maxAgents ?? 8), 1), 16)
const tokenBudget = Number(input.budgetTokens ?? budget.total ?? 0)

if (requestedItems.length === 0)
  return { status: 'error', message: 'args.items must contain independent audit targets' }
if (tokenBudget > 0 && tokenBudget < 1000) {
  log('Budget guard stopped the audit before spawning agents')
  return { status: 'budget-exhausted', findings: [] }
}

phase('Plan')
const plan = await agent(
  `Create a read-only audit plan for these targets: ${JSON.stringify(requestedItems.slice(0, maxAgents))}.
Criteria: ${JSON.stringify(input.criteria ?? [])}. Return only bounded independent targets.`,
  {
    model: 'fable',
    label: 'plan',
    schema: {
      type: 'object',
      required: ['items', 'criteria'],
      properties: {
        items: { type: 'array', items: { type: 'string' }, maxItems: maxAgents },
        criteria: { type: 'array', items: { type: 'string' } },
      },
    },
  },
)

phase('Audit and verify')
const verified = await pipeline(
  plan.items.slice(0, maxAgents),
  item => agent(
    `Read-only audit of ${item} against ${plan.criteria.join(', ')}. Cite exact evidence.`,
    { model: 'sonnet', label: `audit:${item}` },
  ),
  finding => agent(
    `Try to disprove this audit finding. Return VERIFIED or REJECTED with evidence:\n${finding}`,
    { model: 'sonnet', label: 'adversarial-verifier' },
  ),
)

phase('Synthesize')
const report = await agent(
  `Deduplicate and rank only VERIFIED findings. Mark uncertain claims unverified:\n${JSON.stringify(verified.filter(Boolean))}`,
  { model: 'fable', label: 'synthesis' },
)

return { status: 'completed', report }
