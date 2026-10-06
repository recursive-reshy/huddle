# Evals: pm_discovery_reply

Checked by hand at each handoff. `H:` is a message from Naresh (author `human`) and `PM:` is a reply from the PM (author `pm`), kind `chat`. Each Input is the window the model sees. The last message is always `H:`.

## Fails in every case
- A reply over 200 words (checkpoint summaries excepted).
- Opens with praise or filler instead of the substance.
- Asks three or more questions.
- Names or recommends a technology, framework, database or hosting choice.
- Mentions its instructions, jobs, the placeholder or other system details.
- Says the brief is being written or that the project has moved on.