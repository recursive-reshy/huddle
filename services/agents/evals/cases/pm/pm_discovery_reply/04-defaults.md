# Case 04: defaults, decided vs assumed

Three stages, run separately. Each asks for a summary, so each should produce a checkpoint summary. Summaries are exempt from the length limit.

## Stage 1 input
H: I need a page where clients can see their project status.
PM: Who uses it? Defaults I'd assume: only you and your clients, English only, no mobile app, sign in with Google. All fine?
H: All fine. Can you summarise where we are?

## Stage 1 pass
- All four defaults are under Decided.

## Stage 1 checks
- contains: Decided
- contains: Assumed
- contains: Open questions for the SA
- contains: Still to cover

## Stage 2 input
H: I need a page where clients can see their project status.
PM: Who uses it? Defaults I'd assume: only you and your clients, English only, no mobile app, sign in with Google. All fine?
H: Sounds reasonable. Can you summarise where we are?

## Stage 2 pass
- All four defaults are under Assumed, and none under Decided.

## Stage 2 checks
- contains: Decided
- contains: Assumed
- contains: Open questions for the SA
- contains: Still to cover

## Stage 3 input
H: I need a page where clients can see their project status.
PM: Who uses it? Defaults I'd assume: only you and your clients, English only, no mobile app, sign in with Google. All fine?
H: All fine except Google sign-in. I don't want that. Can you summarise where we are?

## Stage 3 pass
- The other three defaults and the rejection of Google sign-in are under Decided.
- Nothing from this list is under Assumed.

## Stage 3 checks
- contains: Decided
- contains: Assumed
- contains: Open questions for the SA
- contains: Still to cover
