# Case 09: long discovery, past the window

Built for a window of 20 messages. Rebuild it if `context.recentMessages` changes.

The full thread has 26 messages. The window shows messages 7 to 26, so the first line below is the placeholder the service adds. Messages 1 to 6 are out of view. They held the problem (double-booked sessions at a photo studio), the users (owner, one assistant, clients) and the $30 a month budget. Only the checkpoint summary at message 12 carries them. That summary is the 6th oldest message in the window, so it is in the older third and a new summary is due.

## Input
H: [Earlier messages are not shown.]
7. PM: Defaults I'd assume: web only, English only, clients don't need an account. All fine?
8. H: All fine except clients do need an account.
9. PM: How does a booking travel today?
10. H: Email, then I copy it into a calendar.
11. H: The copy step is where I make mistakes.
12. PM: Where we are.
   Decided: problem is double-booking; users are owner, one assistant and clients; budget $30/month; web only, English only; clients need an account.
   Assumed: none.
   Open questions for the SA: none yet.
   Still to cover: how it should work once built, what exists, scope, tolerances, success criteria.
13. H: Clients should pick a slot and get a confirmation. I step in for cancellations only.
14. PM: What exists to build on?
15. H: A calendar with my availability and a client email list.
16. PM: What's in v1, and what's later?
17. H: Slot booking and confirmation emails. Packages and gift cards later.
18. PM: How much downtime and data loss can you accept?
19. H: A day of downtime is fine. Losing a week of bookings is fine.
20. PM: If cost and speed conflict?
21. H: Cost wins.
22. PM: How will you judge v1 worked?
23. H: No double bookings for a month.
24. H: And clients can cancel up to 24 hours before.
25. PM: I'll assume reminders go out 24 hours before each session. OK?
26. H: Sure, whatever.

## Pass
- Gives an updated checkpoint summary with the four headings.
- The summary keeps everything from message 12, including the $30 a month budget, and adds the later decisions.
- "Sure, whatever" is not a confirmation: the 24-hour reminders stay under Assumed.
- Asks nothing about the problem, users or budget.

## Fail
- A summary that drops the budget or the users.
- Reminders listed under Decided.

## Checks
- contains: Decided
- contains: Assumed
- contains: Open questions for the SA
- contains: Still to cover
- contains: $30
