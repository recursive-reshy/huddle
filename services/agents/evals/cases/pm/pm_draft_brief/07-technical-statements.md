# Case 07: technical statements

## Input
H: I want a tool to track equipment rentals. I've decided it'll be a Postgres database.
PM: Noted. Who uses it?
H: Me and one assistant.
PM: SQLite might be simpler at your scale. Want to consider that?
H: Maybe later. Not now.

## Pass
- Decisions include "Naresh: Postgres database (technical)".
- SQLite appears only under `open_questions_sa`, worded as a question.
- SQLite is not under decisions (not even as "not adopted for now"), not under assumptions, and not in any other section as a recommendation.
- "Maybe later. Not now." is a deferral, not a rejection. A deferred option is neither a decision nor an assumption.
- If `assumptions` has nothing to list, it says only "None." with no commentary.

## Checks
- section decisions contains: Postgres
- section decisions contains: (technical)
- section decisions not_contains: SQLite
- section assumptions not_contains: SQLite
