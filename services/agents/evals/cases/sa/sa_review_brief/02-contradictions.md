# Case 02: contradictions

The brief disagrees with itself in two places.

## Approved brief
### summary: Summary
An order tool for a small wholesale bakery. Done means orders arrive in one list instead of by phone and WhatsApp.

### problem: Problem and trigger
Wholesale orders from cafes arrive by phone and chat and get lost. Now because order volume doubled this year.

### users_and_environment: Users and environment
Only the owner and her sister use it, on a laptop in the bakery office.

### workflow: Workflow
**Today** Cafes phone or message the owner, who writes orders on a whiteboard.
**Desired** Cafes place their own orders in the tool by 6pm for next-morning delivery. The owner sees all orders in one list.

### existing_assets: What already exists
A spreadsheet of about 20 cafes and their usual orders.

### goals: Goals
No lost orders. Less phone time.

### scope_v1: Scope for v1
Order form, daily order list, a payment link sent to each cafe after delivery.

### scope_later: Later and never
Later: online payment inside the tool, delivery routes. Never: retail customers.

### constraints_and_priorities: Constraints and priorities
Budget $30 a month. Downtime for a few hours is fine. Losing a week of orders is acceptable.

### success_criteria: Success criteria
Every order appears in the list, with none lost for a month.

### decisions: Decisions made
- Orders close at 6pm
- Retail customers rejected

### assumptions: Assumptions to confirm
None.

### open_questions_sa: Open questions for the SA
None.

### open_questions_naresh: Open questions for Naresh
None.

## Pass
- Names the users contradiction: the users section says only the owner and her sister, while the workflow has cafes placing their own orders.
- Names the payment contradiction: a payment link is in v1 while online payment is under later. Asks which is meant, or states what the PRD should say.
- Asks between 1 and 5 questions, each specific.
- Does not choose technology.

## Fail
- Misses either contradiction.
- Asks about things the brief states, such as the 6pm cutoff.

## Checks
- questions min: 1
- questions max: 5
- notes contains: payment
