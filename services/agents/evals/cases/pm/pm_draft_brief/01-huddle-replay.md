# Case 01: Huddle replay

## Input
Includes: evals/fixtures/huddle-pm-chat.md

## Pass
- The general criteria in README.md.
- Decisions include: used only by Naresh, web UI, Naresh approves at major handoffs while agents clarify among themselves, he wants a summary once clarifications finish, and v1 success is running one project from requirements to PRD and TRD without copy-pasting.
- Framework choice and reuse of the agentic-patterns repo are under `open_questions_sa`, because Naresh deferred them to the SA.
- Budget, tolerances (downtime, data loss, response time) and existing assets are not in this thread. They say "Not covered in discovery." and are listed under `open_questions_naresh`.
- Nothing from later in the project (Cloudflare, SQLite, Lightsail) appears.

## Checks
- not_contains: Cloudflare
- not_contains: SQLite
- not_contains: Lightsail
- section constraints_and_priorities contains: Not covered in discovery.
