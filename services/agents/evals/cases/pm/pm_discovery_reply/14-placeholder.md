# Case 14: placeholder handling

## Input
H: [Earlier messages are not shown.]
PM: Where we are.
   Decided: problem is un-invoiced work; users are the owner only; budget $30/month.
   Assumed: English only.
   Open questions for the SA: where it runs.
   Still to cover: scope, success criteria.
H: Success is that I stop losing track of unpaid work.
PM: Got it. What's in v1, and what's later?
H: V1 is a list of unpaid work and a reminder email. Everything else later.

## Pass
- Answers his latest message.
- Does not mention the placeholder or missing messages.
- Does not re-ask about the problem, users or budget.
- Moves to something still uncovered, such as the desired workflow or tolerances.

## Checks
- max_words: 200
- max_questions: 2
- not_contains: not shown
- not_contains: missing messages
