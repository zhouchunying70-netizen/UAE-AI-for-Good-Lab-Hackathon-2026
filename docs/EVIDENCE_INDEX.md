# Public Release Evidence Index

| Question | Public evidence | What it proves | What it does not prove |
|---|---|---|---|
| What scenario was run? | `fixtures/s1-s5.json` | Exact synthetic S1-S5 events, action requests and policy tags | Owner approval or a real UAE incident |
| What did the Agents produce? | `evidence/runs/reference/run.json` | State, citations, proposals, decisions, freshness checks and zero external effects | Production behavior or model intelligence |
| Are inputs bound? | `evidence/runs/reference/manifest.json` | Fixture, source-register and claim-register hashes | Raw-source verification in this redacted bundle |
| Is history linked? | `evidence/runs/reference/audit.jsonl` | Ordered hash-linked event, Agent and state records | Immutability against an attacker controlling all files |
| What source material is included? | `knowledge-base/sources.json`, `knowledge-base/claims.json` | Official URLs, recorded internal hashes, source scope and scoped paraphrases | Reverification of excluded source bytes or permission to redistribute them |
| What was expected? | `verifier/oracles/s1-s5.oracle.json` | Fixed state, action, Agent, token and freshness expectations | Independent human authorship |
| Did actual match expected? | `evidence/verification/reference-receipt.json` | `25/25` repository-local machine assertions | Third-party certification or field acceptance |
| What attacks are tested? | `tests/candidate.test.js`, `evidence/tests/test-output.txt` | `20/20` positive and adversarial tests, including decision multiplicity/stage relocation and duplicate or undeclared audit records | Comprehensive security or penetration testing |
| What does the supplemental technical scenario show? | `fixtures/technical-test-scenario.json`, `evidence/runs/technical-test/`, `scripts/verify_technical_scenario.js` | Three-stage synthetic release, fail-closed actions, unknown-claim rejection and explicit `OWNER_APPROVAL=NOT_GRANTED` | Owner approval, institutional validation or production behavior |
| How are metrics calculated? | `fixtures/opportunities.json`, `evidence/metrics/reference-metrics.json` | Explicit denominators and descriptive values | Validated thresholds or statistical generalization |
| What is safe to publish? | `PUBLICATION_BOUNDARY.md`, `SHA256SUMS.txt` | Intended redacted file set and local integrity hashes | Owner authorization to publish or submit |

All hashes are local integrity evidence. Hash agreement alone does not prove
source authority, completeness, legal admissibility or truth.
