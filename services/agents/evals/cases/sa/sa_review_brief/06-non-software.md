# Case 06: different domain, TRD-only items

A renovation company's quote-request site. Open items belong to the TRD.

## Approved brief
### summary: Summary
A website where homeowners request a renovation quote and the owner reviews requests. Done means requests arrive in one place with photos attached.

### problem: Problem and trigger
Quote requests come by phone with no photos, so the owner visits sites twice. Now because travel time is eating the week.

### users_and_environment: Users and environment
Homeowners on phones. The owner on a laptop.

### workflow: Workflow
**Today** Homeowner phones, owner visits, owner quotes.
**Desired** Homeowner fills a form and uploads up to five photos. Owner reviews the request and replies by email.

### existing_assets: What already exists
A business email address and a logo.

### goals: Goals
Fewer wasted site visits.

### scope_v1: Scope for v1
Request form with photo upload, a list of requests for the owner.

### scope_later: Later and never
Later: online quote acceptance. Never: payments.

### constraints_and_priorities: Constraints and priorities
Budget $15 a month. A day of downtime is fine. Losing two weeks of requests is acceptable. About 20 requests a month.

### success_criteria: Success criteria
Site visits drop by a third in three months.

### decisions: Decisions made
- Up to five photos per request
- Replies by email

### assumptions: Assumptions to confirm
None.

### open_questions_sa: Open questions for the SA
- Where are photos stored, and what size limit applies?

### open_questions_naresh: Open questions for Naresh
None.

## Pass
- Says nothing blocks the PRD.
- Lists photo storage and size limits as waiting for the TRD.
- At most 2 questions, and zero is a good result.
- Does not mention Huddle or the team's own tools.

## Fail
- Treats photo storage as blocking the PRD.
- Chooses a storage service.

## Checks
- questions max: 2
- notes not_contains: Huddle
