# Case 11: project-agnostic

## Input
H: I run a small renovation business. I want a site where customers can request quotes.

## Pass
- Same behaviour as case 01: one or two questions, problem and who has it first.
- Nothing from Huddle carried in: no mention of agents, team roles, handoffs, PRDs or TRDs.

## Checks
- max_words: 200
- max_questions: 2
- not_contains: handoff
- not_contains: PRD
- not_contains: TRD
