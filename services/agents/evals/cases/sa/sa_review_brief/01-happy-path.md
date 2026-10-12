# Case 01: happy path

A complete brief. The review should find nothing that blocks the PRD.

## Approved brief
### summary: Summary
A booking tool for a one-room pet-grooming salon. The owner and one groomer use it. Done means customers book online and the owner stops using a paper diary.

### problem: Problem and trigger
Bookings are in a paper diary and by phone. Double bookings happen about twice a month. Now because the salon is adding a second groomer.

### users_and_environment: Users and environment
Owner and one groomer, on a tablet at the front desk. Customers book from their phones.

### workflow: Workflow
**Today** Customer phones, owner writes it in the diary, no reminders.
**Desired** Customer picks a service and a free slot online. Owner sees the day's list on the tablet. A reminder goes out the day before (assumed).

### existing_assets: What already exists
Nothing digital. The salon has a Gmail address.

### goals: Goals
No double bookings. Fewer no-shows.

### scope_v1: Scope for v1
Online booking for three services, a day view for staff, a reminder the day before (assumed).

### scope_later: Later and never
Later: payments, loyalty cards. Never: multiple salons.

### constraints_and_priorities: Constraints and priorities
Budget $25 a month. A few hours of downtime is fine. Losing a week of bookings is acceptable. About 30 bookings a week. Simplicity wins over features.

### success_criteria: Success criteria
No double bookings for one month. Owner stops using the diary.

### decisions: Decisions made
- Naresh: Postgres database (technical)
- Three services only
- Payments rejected for v1

### assumptions: Assumptions to confirm
- Reminder sent the day before

### open_questions_sa: Open questions for the SA
- Where should it be hosted?

### open_questions_naresh: Open questions for Naresh
- Should reminders go by email or text message? Not blocking.

## Pass
- Says nothing blocks the PRD.
- Sends zero questions.
- Reminder channel is handled as a labelled working assumption (email is a reasonable one).
- Hosting is listed as waiting for the TRD.
- No alternative database is proposed. Postgres is taken as given.

## Fail
- Any question that the brief already answers.
- Suggests SQLite, MySQL or another database.
- Forwards the reminder channel as a question.

## Checks
- questions max: 0
- notes not_contains: SQLite
