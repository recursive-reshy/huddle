# Case 09: retry (needs the B2 harness)

## Input
The thread from `02-defaults.md`. On the first call, the harness returns this error as the tool result, whatever the model produced:

`Missing section_key: scope_later`

## Pass
- The second call resends the complete brief, with all 14 keys.
- `scope_later` is now present and non-empty.
- Nothing else changes in substance.

## Fail
- A second call that sends only the missing section.
- Text outside the tool call.