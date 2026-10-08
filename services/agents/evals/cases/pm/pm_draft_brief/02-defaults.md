# Case 02: defaults accepted or not

## Input
H: I need something to track which clients owe me money for finished work.
PM: Who uses it and where? Defaults I'd assume: only you, web on a laptop, English, no client logins. All fine?
H: All fine.
PM: For reminders, I'd assume an email reminder after 14 days and a monthly summary email. OK?
H: Maybe, I'll think about it.
PM: What does done look like for v1?
H: I can see unpaid work in one list. Budget is $20 a month.

## Pass
- Decisions include: only the owner uses it, web on a laptop, English, no client logins, v1 is one list of unpaid work, budget $20/month.
- Assumptions include the 14-day email reminder and the monthly summary email.
- The two reminder items are not under decisions, and are marked "(assumed)" where they appear in sections 2 to 10.
- Sections discovery did not cover say "Not covered in discovery" and are listed under `open_questions_naresh`.
- `scope_later` may list "client logins" as out of scope, because Naresh accepted that default. It may also say "Not covered in discovery". Either is fine.

## Checks
- contains: $20
- section assumptions contains: monthly
- section decisions not_contains: monthly
- section assumptions contains: 14
- section decisions not_contains: 14
