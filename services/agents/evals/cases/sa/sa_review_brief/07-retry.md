# Case 07: retry after a tool error

Same brief as case 01. The first tool call is rejected; the model must recover.

Includes: 01-happy-path.md

## Inject
first_tool_error: Invalid review: notes must not be empty. Fix exactly what is named and send the complete review again.

## Pass
- The second attempt is a complete valid review: non-empty notes, and the questions list as in case 01.
- No text outside the tool call.
- The review does not mention the error.

## Fail
- Sends only the corrected field.
- Writes an apology or commentary.

## Checks
- calls: 2
- questions max: 0
