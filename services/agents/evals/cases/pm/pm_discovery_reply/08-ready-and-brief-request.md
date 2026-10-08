# Case 08: ready, and the brief request

Two stages, run separately. The thread has a checkpoint summary at message 10, so no new summary is due.

Naresh gives a reason for accepting the data loss ("I can rebuild lost bookings from WhatsApp"), so the PM has no risk left to raise. This case tests readiness, not risk handling.

## Stage 1 input
H: I run a pottery studio. I want a page where students book classes themselves.
PM: What goes wrong today, and why now?
H: Bookings come by WhatsApp and I copy them into a spreadsheet. Last month I double-booked a class twice, and refunds are a mess.
PM: What exists already, and how do you want it to work once this is built?
H: A Google Sheet with the class list and a simple website with no booking. Students book and pay themselves. I only step in for refunds and cancellations.
PM: Who uses it, and what's in v1? Defaults I'd assume: students book on phones, two staff view the schedule, English only. All fine?
H: All fine. V1 is booking and a payment link. Memberships and gift vouchers later.
PM: Other goals? And tolerances: downtime, data loss, budget? I'd also assume a 24-hour cancellation window.
H: I also want to learn how to build this properly. A few hours of downtime is fine. I can rebuild lost bookings from WhatsApp, so losing a week of them is fine. Budget $30 a month. If cost and speed conflict, cost wins.
PM: Where we are.
   Decided: problem is double-booked classes and messy refunds; students book and pay themselves; students book on phones, two staff view the schedule, English only; v1 is booking and a payment link; memberships and gift vouchers later; learning is a secondary goal; a few hours of downtime and a week of lost bookings are fine; budget $30 a month; cost wins over speed; Naresh steps in only for refunds and cancellations.
   Assumed: 24-hour cancellation window.
   Open questions for the SA: none yet.
   Still to cover: success criteria.
   How will you judge that v1 worked?
H: No double bookings for a month, and no more WhatsApp bookings.
PM: Anything I've missed?
H: I think that's everything.

## Stage 1 pass
- Says once, briefly, that it thinks it has enough, and that he can press "Draft brief" or say what's missing.
- Does not write a brief or a long recap.

## Stage 1 checks
- contains: Draft brief
- max_words: 200
- max_questions: 2

## Stage 2 input
Includes: stage 1
PM: I think I have enough. Press "Draft brief" when you're ready, or tell me what's missing.
H: OK, write the brief now.

## Stage 2 pass
- Says the "Draft brief" button does that, and writes no brief.
- Names what is still assumed: the 24-hour cancellation window.
- Does not repeat the readiness statement at length.

## Stage 2 checks
- contains: Draft brief
- contains: 24
- max_words: 200
