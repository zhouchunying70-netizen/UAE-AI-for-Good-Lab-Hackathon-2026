# ITU-T Y.3172 Engineering Mapping

This is a project mapping, not an ITU conformity claim. Source identity and
version are registered as `SRC-ITU-001`.

| Y.3172 functional role | Candidate component | Evidence |
|---|---|---|
| Source (SRC) | Synthetic weather, service, facility, route and demand events | `fixtures/s1-s5.json` |
| Collector (C) | Event ledger ingestion and sequence gate | `src/lib/event-ledger.js` |
| Pre-processor (PP) | Event normalization, gap handling and current-fact reducer | `src/lib/state.js`, `src/lib/orchestrator.js` |
| Model (M) | Deterministic four-role decision logic | `src/lib/agents.js` |
| Policy (P) | Admitted source and claim registry with scoped retrieval | `knowledge-base/`, `src/lib/knowledge-base.js` |
| Distributor (D) | Local orchestrator writes proposal and decision artifacts | `src/lib/orchestrator.js` |
| Sink (SINK) | Local run bundle, audit chain and verifier receipt | `evidence/runs/reference/`, `evidence/verification/` |
| Sandbox | S1-S5 fixture, no side effects, deterministic replay and tests | `fixtures/`, `tests/` |

The candidate does not train or deploy an ML model, connect to a network
operator or demonstrate production Y.3172 interfaces.

