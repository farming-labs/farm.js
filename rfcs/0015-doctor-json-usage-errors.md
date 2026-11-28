# Report invalid doctor invocations as JSON

## Problem

An agent running `farm doctor --json` can receive plain text or an empty stdout
for a misspelled option. The exit status can also match a completed diagnostic
report with failed checks. A partially numeric timeout can even run the checks.

## Decision

Keep the existing report on stdout and exit 0 or 1 when checks complete. If
Commander parses `--json` and the invocation is invalid, print one JSON document
on stdout with `schemaVersion: 1`, `error.code: "DOCTOR_INVALID_ARGUMENTS"`, and
an actionable `error.message`. Exit 2 before running diagnostics or applying fixes.
Use the same argument validation for terminal output. Treat the message as text
for display and the code as the stable value for branching.

## Verification

Exercise parser and value errors through the executable, including JSON before
and after an invalid option. Check plain-text errors, successful reports, failed
checks, and an invalid invocation with `--fix`.
