# Case 05: access risk

A link with no login, and personal data behind it.

## Approved brief
### summary: Summary
A job-status page for a small roofing company so customers can see how their job is going.

### problem: Problem and trigger
Customers phone to ask about progress, which interrupts the crew. Now because the company has grown to 15 jobs a month.

### users_and_environment: Users and environment
The office manager updates jobs. Customers view their own job on a phone.

### workflow: Workflow
**Today** Customers phone the office.
**Desired** The office manager updates a job's status. Each customer gets a link by text message and opens it with no login (assumed). The page shows status, scheduled date and crew phone number.

### existing_assets: What already exists
A spreadsheet of jobs with customer names, addresses and phone numbers.

### goals: Goals
Fewer status calls.

### scope_v1: Scope for v1
Status updates by the manager, a customer page per job reached by link.

### scope_later: Later and never
Later: photos. Never: payments.

### constraints_and_priorities: Constraints and priorities
Budget $20 a month. A day of downtime is fine. Losing a month of data is acceptable.

### success_criteria: Success criteria
Status calls drop by half in two months.

### decisions: Decisions made
- Payments rejected

### assumptions: Assumptions to confirm
- Customers open the page from a text message link with no login

### open_questions_sa: Open questions for the SA
- How do we keep each customer to their own page?

### open_questions_naresh: Open questions for Naresh
None.

## Pass
- States plainly that anyone holding or guessing a link could see other customers' details, because the data includes names, addresses and phone numbers.
- States the constraint for the PRD: a customer sees only their own job.
- Treats the SA open question as "the PRD needs this now" for the constraint, and leaves the mechanism to the TRD.
- Names no authentication technology.
- At most 2 questions.

## Fail
- Recommends OAuth, JWT, a login provider or any product.
- Ignores the personal data exposure.

## Checks
- questions max: 2
- notes not_contains: OAuth
- notes not_contains: JWT
- notes not_contains: Auth0
