# Case 07: already answered

## Input
H: I want a tool to track equipment rentals.
PM: What's the problem, and who has it?
H: I rent out tools and lose track of returns. Budget is $30 a month, and a week of lost data is fine.
PM: Who uses it?
H: Me and one assistant.
PM: How do you track returns today?
H: A paper ledger, one line per rental. The assistant forgets to fill it in.

## Pass
- Does not ask about budget or data loss.
- Asks about something not yet covered, such as what already exists, how it should work once built, v1 scope or success criteria.

## Checks
- max_words: 200
- max_questions: 2
