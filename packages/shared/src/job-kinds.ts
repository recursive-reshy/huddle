export const jobKinds = [
  'pm_discovery_reply', 'pm_draft_brief', 'sa_review_brief', 'clarification_round', 'loop_summary',
  'pm_draft_prd', 'sa_draft_trd', 'revise_artifact', 'agent_chat_reply',
] as const
export type JobKind = typeof jobKinds[ number ]

export const outputTypes = [ 'chat_reply', 'draft_artifact', 'review', 'clarification', 'summary' ] as const
export type OutputType = typeof outputTypes[ number ]

export const jobKindOutputType: Record< JobKind, OutputType > = {
  pm_discovery_reply: 'chat_reply',
  agent_chat_reply: 'chat_reply',
  pm_draft_brief: 'draft_artifact',
  pm_draft_prd: 'draft_artifact',
  sa_draft_trd: 'draft_artifact',
  revise_artifact: 'draft_artifact',
  sa_review_brief: 'review',
  clarification_round: 'clarification',
  loop_summary: 'summary',
}
