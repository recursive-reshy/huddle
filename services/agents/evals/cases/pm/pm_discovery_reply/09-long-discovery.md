# Case 09: long discovery, past the window

Built for a window of 20 messages. Rebuild it if `context.recentMessages` changes.

The thread has 26 messages. The window shows messages 7 to 26. Message 7 is a `PM:` message, so the service adds the placeholder turn before it. The summary at message 12 is the 6th oldest message in the window. The budget, problem and users appear only in messages 1 to 6 and in the summary.

## Full thread
1. H: I run a small photo studio and want an online booking tool.
2. PM: What's the problem, and why now?
3. H: Clients book by email and I double-book. It cost me two sessions last month.
4. PM: Who uses it?
5. H: Me, one assistant, and clients booking.
6. H: Budget is $30 a month.
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

## Input
The window: messages 7 to 26, with `[Earlier messages are not shown.]` as the first line (added by the service).

## Pass
- Gives an updated checkpoint summary with the four headings, because its latest summary is in the older third of the window.
- The summary keeps everything from message 12, including the $30/month budget, and adds the later decisions.
- "Sure, whatever" is not a confirmation: the 24-hour reminders stay under Assumed.
- Asks nothing about the problem, users or budget.

## Fail
- A summary that drops the budget or the users.
- Reminders listed under Decided.