> PUBLICATION STATUS: UNLICENSED public repository for the reviewed UAE hackathon file set. No open-source license is granted.

# UAE Public Service Continuity Agent - Public Release Candidate 001

This repository is a local, deterministic submission candidate for the UAE AI
for Good Hackathon 2026. It is built from synthetic data and official source
metadata only. It does not call an external AI provider, connect to a
production system, or exercise real institutional authority. It is policy-grounded within a limited, admitted source set.

Current status: `PUBLIC_REPOSITORY / ELIGIBILITY_CONFIRMED / SCENARIO_SYNTHETIC / ANONYMOUS_ACCESS_VERIFIED`.

The retained participant-specific ITU correspondence confirms registration, the
submission mailbox `aiforgoodlab@itu.int` and the deadline `2026-11-10 23:59
UAE time`. The Owner has supplied the final identity for this submission:
`YiYuan Qiming`, Team Leader `周玉晨 (Yuchen Zhou)`, single-member team. The
The reviewer-accessible repository is:
`https://github.com/zhouchunying70-netizen/UAE-AI-for-Good-Lab-Hackathon-2026`
The published commit is `5a6b78422490a9101c11a022123ae4ff75202d56`. No
submission receipt exists until the authorized email is sent and acknowledged.

## What Runs

The repository implements four deterministic local roles for a synthetic
extreme-heat public-service continuity scenario:

1. Event Intelligence Agent
2. Policy Adviser Agent
3. Simulated Public Service Coordinator
4. Authorization and Audit Agent

The workflow processes S1-S5 events, retrieves admitted policy claims by exact
metadata/tag overlap, emits citations, rejects an unknown source, blocks
unsupported actions, preserves an append-only hash-linked audit chain and
writes local run artifacts. A separate verifier reads those artifacts and a
fixture Oracle. No network call, model provider, server or production
integration is used at runtime.

This is a deterministic coordination pipeline, not an autonomous negotiating
or generative multi-Agent system. The four roles are ordinary functions in one
Node.js process; their proposals and rationales are fixed program logic.

## Reproduce

Requirements: Node.js 20 or later and npm.

```bash
npm test
npm run demo
npm run verify
npm run metrics
node src/cli.js advise --source-verification metadata-only --question "What privacy and oversight controls apply to a synthetic continuity prototype?"
npm run scenario:technical
```

Expected public metadata-only reference results:

- tests: `20 passed, 0 failed`
- verifier: `25 passed, 0 failed`
- unsafe-attempt fail-closed rate: `4/4`
- unadmitted-claim rejection rate: `1/1`
- S5 false-recovery rate: `0/1`

These are single-fixture synthetic results, not production performance,
reliability, fairness or public-service effectiveness. Every metric threshold
remains `PROPOSED_NOT_VALIDATED`.

The rescue candidate also includes `src/lib/policy-adviser.js`, a deterministic Policy Adviser entry point. It returns tag-based citations, scoped guidance, explicit authority gaps and a human-review requirement. It does not issue legal conclusions. `fixtures/technical-test-scenario.json` is a separate three-stage technical fixture with `OWNER_APPROVAL=NOT_GRANTED`; it does not change the authorization status of the original S1-S5 fixture.

This redacted bundle excludes raw source snapshots. The standard commands use
metadata-only verification and explicitly report
`RAW_SOURCE_VERIFICATION_NOT_PERFORMED_IN_PUBLIC_BUNDLE`. They do not
revalidate excluded policy source bytes.

## Evidence

- Run bundle: `evidence/runs/reference/`
- Verification receipt: `evidence/verification/reference-receipt.json`
- Metrics: `evidence/metrics/reference-metrics.json`
- Source metadata and hashes: `knowledge-base/sources.json`
- Admitted claim paraphrases: `knowledge-base/claims.json`
- Oracle: `verifier/oracles/s1-s5.oracle.json`
- Final technical report: `report/TECHNICAL_REPORT_FINAL.pdf`
- Evidence guide: `docs/EVIDENCE_INDEX.md`

Start with:

- `PUBLICATION_BOUNDARY.md`
- `docs/ARCHITECTURE.md`
- `docs/RUNBOOK.md`
- `docs/OFFICIAL_REQUIREMENT_MAPPING.md`

The canonical historical V0.1 scenario remains missing locally. This candidate
is a new implementation under the working synthetic scope, not a recovered
historical artifact. The fixture and reference run explicitly retain
`WORKING_ASSUMPTION_NOT_OWNER_APPROVED`; no original Owner approval record for
this exact fixture was found. The scenario has not been validated by a UAE
institution.

The public page's `Applications closed` state is retained as a page snapshot;
it does not replace the participant-specific ITU registration confirmation.
The GitHub publication is limited to this reviewed candidate and does not
constitute formal event acceptance.

## Authority Boundary

All institutional identities and events are synthetic. Authorization tokens
apply only to a local stage and never confer real authority. The knowledge base
is metadata-first and tag-based, not vector retrieval and not an ITU Lab-hosted
distributed knowledge base. Source coverage is incomplete and raw restricted
source files are excluded. The Owner authorization records reviewed here
support event-specific package preparation subject to final approval and
external checks. They do not approve the scenario itself, create a public
repository or constitute a submission receipt. No other project or core
platform asset is included.


