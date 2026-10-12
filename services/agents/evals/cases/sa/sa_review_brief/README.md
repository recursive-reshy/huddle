# sa_review_brief evals

Each case holds its own approved brief under `## Approved brief`, one `### <section_key>: <Title>` subsection per section. Domains differ from Huddle on purpose.

Cases are judged by the Pass and Fail sections, read by hand. Scripted checks are kept narrow: a wrong check fails good output.

## Checks (apply to every case)
- notes not_contains: MySQL
- notes not_contains: MongoDB
- notes not_contains: Firebase
- notes not_contains: Vercel

## What a good review looks like
- Says first whether anything blocks the PRD.
- Asks only what the PRD needs, never what the brief answers.
- Turns Naresh's open questions into labelled working assumptions.
- Separates "PRD needs now" from "waits for the TRD".
- Takes "(technical)" decisions as given.
- Notes stand alone: someone who has not seen the exchange can act on them.

## Cases
| File | Tests |
|---|---|
| 01-happy-path.md | Complete brief gives zero questions |
| 02-contradictions.md | Names contradictions across sections |
| 03-thin-brief.md | Thin line, top questions, rest as assumptions, no return to discovery |
| 04-missing-figures.md | Asks for budget, downtime and data loss figures |
| 05-access-risk.md | States the exposure risk and PRD constraint, no auth technology |
| 06-non-software.md | Different domain, TRD-only items left for the TRD |
| 07-retry.md | Recovers from a tool error with a complete valid review |
