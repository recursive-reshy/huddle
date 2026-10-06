# Case 11: workflow in two parts

## Variant A input
H: I manage property maintenance for a small landlord group, and requests come in by phone.
PM: How does a request travel today, and where does it hurt?
H: The tenant calls me, I text a contractor, then I chase for the invoice. Requests get lost between my phone and the contractor.
PM: How should it flow once the tool exists, and where do you step in?
H: Tenants submit a request, the contractor gets it directly, and I only approve jobs over $500.

## Variant A pass
- `workflow` has both bold labels, **Today** and **Desired**.
- Today holds the phone, text and chasing steps and where requests get lost.
- Desired holds the direct submission and "approves jobs over $500" as his step-in point.

## Variant B input
Variant A without the last two messages (the PM's question about the desired flow and Naresh's answer).

## Variant B pass
- Today is filled in as in Variant A.
- Desired says "Not covered in discovery."
- The missing desired flow is listed under `open_questions_naresh`.