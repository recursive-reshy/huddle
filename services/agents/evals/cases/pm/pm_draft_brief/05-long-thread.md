# Case 05: long thread

Problem and budget appear only in the first six messages.

## Input
1. H: I run a tutoring centre and can't track which students are falling behind.
2. PM: Who has this problem, and why now?
3. H: The five tutors and me. Parents started complaining after exam results last month.
4. PM: Who would use the tool, and what's the budget?
5. H: The tutors enter progress, I read it. Budget is $40 a month.
6. PM: How do you track progress today?
7. H: Paper notes and a shared spreadsheet nobody updates.
8. PM: Where does it hurt most?
9. H: Tutors forget to update it, and I only notice at exam time.
10. PM: What exists to build on?
11. H: The spreadsheet, plus a list of 80 students in a CSV.
12. PM: How should work flow once this exists, and where do you step in?
13. H: Tutors log a note after each lesson. I only step in when a student is flagged.
14. PM: Defaults: web page on phones, English only, tutors sign in with Google. All fine?
15. H: All fine.
16. PM: What triggers a flag? I'd assume two weak sessions in a row.
17. H: Make it three.
18. PM: What's in v1?
19. H: Lesson notes, a flag list, and a weekly email to me.
20. PM: And later or never?
21. H: Parent portal later. Never grades or attendance billing.
22. PM: How much downtime and data loss can you accept?
23. H: A day of downtime is fine. Losing a week of notes is survivable.
24. PM: If cost and speed conflict?
25. H: Speed to ship wins, as long as it stays under budget.
26. PM: I'd assume the weekly email goes out Monday morning. OK?
27. H: Sure, whatever.
28. PM: Anything the SA should decide, like where it runs?
29. H: Yes, hosting and storage are for the SA.
30. PM: How will you judge v1 worked?
31. H: Every tutor logs notes within a day of each lesson for a month.
32. PM: Anything else?
33. H: No, that's it.

## Pass
- The problem (students falling behind, parental complaints) and the $40/month budget appear, though they are only in the first six messages.
- Flag threshold of three sessions is under decisions.
- The Monday weekly email is under assumptions, not decisions ("Sure, whatever" does not confirm).
- Hosting and storage are under `open_questions_sa`.
- Later and never: parent portal later, grades and attendance billing never.

## Checks
- contains: $40
- section assumptions contains: Monday
- section decisions not_contains: Monday
- section scope_later contains: parent
- section scope_later contains: grade
