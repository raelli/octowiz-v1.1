export const meta = {
  name: 'integra-migration',
  description: 'Bounded per-item migration in isolated worktrees',
  whenToUse: 'Independent file migrations with a common mechanical target',
  phases: [
    { title: 'Plan', detail: 'Fable validates independent migration items' },
    { title: 'Migrate', detail: 'Sonnet workers edit isolated worktrees' },
    { title: 'Verify', detail: 'Fable reviews worker evidence and conflicts' },
  ],
}

const input = args ?? {}
const requestedItems = Array.isArray(input.items) ? input.items : []
const maxAgents = Math.min(Math.max(Number(input.maxAgents ?? 8), 1), 16)
const tokenBudget = Number(input.budgetTokens ?? budget.total ?? 0)

if (requestedItems.length === 0)
  return { status: 'error', message: 'args.items must contain independent migration targets' }
if (tokenBudget > 0 && tokenBudget < 2000) {
  log('Budget guard stopped the migration before any edits')
  return { status: 'budget-exhausted', changes: [] }
}

phase('Plan')
const plan = await agent(
  `Validate that these migration items can be edited independently: ${JSON.stringify(requestedItems.slice(0, maxAgents))}.
Migration goal: ${String(input.goal ?? '')}. Verification: ${String(input.verification ?? '')}.`,
  {
    model: 'fable',
    label: 'plan',
    schema: {
      type: 'object',
      required: ['items', 'instructions'],
      properties: {
        items: { type: 'array', items: { type: 'string' }, maxItems: maxAgents },
        instructions: { type: 'string' },
      },
    },
  },
)

phase('Migrate')
const changes = await pipeline(
  plan.items.slice(0, maxAgents),
  item => agent(
    `Migrate ${item}. ${plan.instructions}. Run the narrowest relevant check and report files plus evidence.`,
    {
      model: 'sonnet',
      label: `migrate:${item}`,
      isolation: 'worktree',
    },
  ),
)

phase('Verify')
const report = await agent(
  `Review all migration results for correctness, conflicts, missing checks, and scope drift.
Do not claim completion without evidence:\n${JSON.stringify(changes.filter(Boolean))}`,
  { model: 'fable', label: 'verification' },
)

return { status: 'completed', changes: changes.filter(Boolean), report }
