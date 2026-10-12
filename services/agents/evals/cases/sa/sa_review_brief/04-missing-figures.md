# Case 04: missing figures

Everything is stated except the constraints the TRD needs a figure for.

## Approved brief
### summary: Summary
A tool to schedule maintenance for equipment in a small physiotherapy clinic. Done means no service is missed.

### problem: Problem and trigger
Service dates for 40 pieces of equipment live in the head of the practice manager. Two services were missed last year.

### users_and_environment: Users and environment
The practice manager and two physiotherapists, on the clinic desktop PC and phones.

### workflow: Workflow
**Today** The manager remembers, or checks supplier emails.
**Desired** Each item has a service interval. The tool shows what is due in the next 30 days and emails the manager a weekly list.

### existing_assets: What already exists
A spreadsheet listing the 40 items and their last service dates.

### goals: Goals
No missed services.

### scope_v1: Scope for v1
Item list, service intervals, due list, weekly email.

### scope_later: Later and never
Later: supplier contact details. Never: patient data.

### constraints_and_priorities: Constraints and priorities
Budget, acceptable downtime and acceptable data loss were not discussed. Three users.

### success_criteria: Success criteria
No service missed for six months.

### decisions: Decisions made
- Patient data rejected

### assumptions: Assumptions to confirm
None.

### open_questions_sa: Open questions for the SA
None.

### open_questions_naresh: Open questions for Naresh
- Monthly budget, acceptable downtime and acceptable data loss.

## Pass
- Asks for the missing figures: running budget, acceptable downtime, acceptable data loss. At most 3 questions.
- Does not re-ask anything stated, such as users, item count or the weekly email.
- Picks no numbers as if they were fact. Any assumed figure is labelled as an assumption.

## Fail
- Asks about stated items.
- Chooses a budget or downtime figure without labelling it.

## Checks
- questions min: 1
- questions max: 3
