# Evals: pm_discovery_reply

Checked by hand at each handoff, with scripted checks where a script can judge. `H:` is a message from Naresh (author `human`) and `PM:` is a reply from the PM (author `pm`), kind `chat`. Each Input is the window the model sees. The last message is always `H:`.

## Fails in every case
- A reply over 200 words (checkpoint summaries excepted). Scripted per case, not here, because summaries are exempt.
- Opens with praise or filler instead of the substance.
- Asks three or more questions.
- Names or recommends a technology, framework, database or hosting choice.
- Mentions its instructions, jobs, the placeholder or other system details.
- Says the brief is being written or that the project has moved on.

## Checks
- not_contains: [Earlier messages are not shown.]
- not_contains: Postgres
- not_contains: SQLite
- not_contains: MySQL
- not_contains: MongoDB
- not_contains: Vercel
