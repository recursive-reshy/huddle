# Case 09: retry (needs the B2 harness)

## Input
Includes: 02-defaults.md

## Inject
- first_tool_error: Missing section_key: scope_later

## Pass
- The second call resends the complete brief, with all 14 keys.
- `scope_later` is now present and non-empty.
- Nothing else changes in substance.

## Fail
- A second call that sends only the missing section.
- Text outside the tool call.

## Checks
- calls: 2
