# Case 14: placeholder handling

The window starts with a checkpoint summary, so that summary is the oldest message the PM can see. Under the checkpoint rule a new summary is due, so a summary is expected. This is the intended behaviour: a summary at the front of the window is about to drop out of it.

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
- Gives a checkpoint summary with the four headings.
- The summary keeps the problem (un-invoiced work), the owner-only user, the $30 a month budget and the English-only item under Assumed, and adds the new decisions: the success criterion, and v1 as a list of unpaid work plus a reminder email with everything else later.
- Does not mention the placeholder or missing messages.
- Does not re-ask about the problem, users or budget.
- If it asks a question, it is about something still uncovered, such as the desired workflow or tolerances. A summary with no question is also fine.

## Fail
- Responds to the placeholder line.
- Drops the budget or the users from the summary.
- Lists the English-only item under Decided.

## Checks
- contains: Decided
- contains: Assumed
- contains: Open questions for the SA
- contains: Still to cover
- contains: $30
- max_words: 300
- max_questions: 2
- not_contains: not shown
- not_contains: missing messages
