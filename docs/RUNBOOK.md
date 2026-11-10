# Local Runbook

## Preconditions

- Node.js 20 or later
- npm
- Current directory is the repository root
- No external credentials are needed or read
- No service should be started

## Commands

```bash
npm test
npm run demo
npm run verify
npm run metrics
```

`npm run demo` rewrites only `evidence/runs/reference/` with deterministic
artifacts. `npm run verify` writes a separate receipt and exits non-zero on a
failed assertion. `npm run metrics` derives results from the opportunity
manifest rather than hard-coded percentages.

This redacted bundle maps the standard commands to metadata-only verification
because raw source snapshots are excluded. Every run must report
`RAW_SOURCE_VERIFICATION_NOT_PERFORMED_IN_PUBLIC_BUNDLE`. The policy lookup is
exact metadata/tag overlap; no vector database or external service is used.

## Clean Reproduction Check

1. Run the four commands above.
2. Confirm tests report 20 pass and 0 fail.
3. Confirm the verifier reports 25 pass and 0 fail.
4. Inspect `evidence/runs/reference/manifest.json` for the run and audit hashes.
5. Inspect the S5 state in `run.json`; power must be `CONFIRMED_ON`, while
   service remains `UNCONFIRMED` and capacity remains `UNKNOWN`.
6. Run `git status --short`; only deliberately regenerated evidence should be
   present if the committed reference hashes differ.

The commands demonstrate local reproducibility only. They do not establish
production performance, legal completeness, institutional approval, third-party
certification or formal submission acceptance. The public repository URL is a
publication record for this reviewed file set, not an organizer receipt.

## Policy Adviser Query

Run one deterministic policy query without network access:

```bash
node src/cli.js advise --source-verification metadata-only \
  --question "What privacy and oversight controls apply to a synthetic continuity prototype?"
```

The response must contain admitted claim citations, a metadata-only source status, a scoped answer, an explicit authority boundary and a human-review requirement. It must not present a legal conclusion.

## Supplemental Technical Scenario

```bash
npm run scenario:technical
node scripts/verify_technical_scenario.js evidence/runs/technical-test/run.json
```

This fixture is marked `TECHNICAL_TEST_SCENARIO` and `OWNER_APPROVAL=NOT_GRANTED`. It is a reproducibility test, not an Owner decision.

## Failure Interpretation

- Run hash failure: the run artifact changed after manifest creation.
- Audit hash failure: the audit file changed after manifest creation.
- Audit chain failure: a record or linkage was changed, even if the manifest
  hash was recomputed.
- State assertion failure: execution output does not match fixture semantics.
- Policy semantic failure: citations or claims do not exactly bind to the
  admitted source and claim registers.
- Coordinator semantic failure: proposal or rationale differs from the Oracle.
- Token failure: run/stage/action/state/citation/TTL binding, replay, expiry,
  revocation or protected-output handling failed.
- Freshness failure: recovery evidence exceeds the candidate 300-second window
  or is missing; the window remains `PROPOSED_NOT_VALIDATED`.
- Forbidden outcome failure: a service recovery, capacity confirmation or
  real-world execution claim was introduced.

