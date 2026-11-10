# Architecture

## Runtime Flow

```text
S1-S5 synthetic fixture
        |
        v
Event Intelligence Agent ----> ordered fact state + anomaly records
        |                                      |
        v                                      v
Policy Adviser Agent --------> admitted claims + source citations
        |                                      |
        v                                      v
Simulated Coordinator -------> side-effect-free proposal
        |                                      |
        v                                      v
Authorization/Audit Agent ---> allow simulation or block fail-closed
        |
        v
run.json + hash-linked audit.jsonl + manifest.json
        |
        v
separate verifier + hidden-from-runtime Oracle -> receipt -> metrics
```

## Trust Boundaries

| Boundary | Control | Remaining limitation |
|---|---|---|
| Fixture to runtime | Schema-shaped deterministic JSON; explicit synthetic and no-authority labels | No cryptographic fixture custodian identity |
| Source to KB | Official URL, local snapshot hash, admission status, locator and scoped paraphrase | License review incomplete; corpus is intentionally small |
| Agent to authorization | Only a side-effect-free proposal can be authorized; listed unsafe attempts are blocked | The four roles are deterministic functions in one process; this is not production identity or ACL separation |
| Runtime to verifier | Runtime never loads the Oracle; verifier reads artifacts separately | Same repository and operator; not independent human acceptance or third-party certification |
| Evidence history | Each audit record hashes its immutable payload and previous record | Local files are not externally timestamped or signed |

## Event Semantics

Each synthetic event has an identity, source, domain, sequence, observed time and payload.
The ledger rejects unknown domains, duplicate IDs, conflicting sequence facts
and stale sequence numbers. Out-of-order events remain pending until the gap is
closed. In S3, route sequence 12 is retained while sequence 11 is missing; 11
is later marked as a late arrival, then 11 and 12 are applied in sequence. The
current route becomes `RESTRICTED` and both historical facts remain auditable.

## Authorization Semantics

The authorization decision is the local linearization record for a stage. Its
fencing token is scoped to that stage and action, has an expiry, is single-use,
and is rejected on replay, revocation, tampering or scope mismatch. Its effect
is always `SIMULATION_ONLY`. Unknown source, uncertain state, missing service
evidence or missing capacity evidence causes a fail-closed result. No executor
capable of external side effects exists in this candidate.

## S5 Recovery Rule

`POWER.RESTORED` changes only the power fact. It does not change facility,
service or capacity status. A service-recovery claim requires separate fresh
service, capacity, demand and human-acceptance evidence; those inputs are
absent in the fixture, so reopening is blocked. The 300-second freshness value
is a candidate rule marked `PROPOSED_NOT_VALIDATED`.

## Knowledge Retrieval Boundary

The candidate uses exact metadata/tag overlap over the admitted claim register.
It does not implement embeddings, a vector database, semantic ranking,
distributed ingestion or ITU Lab hosting. The public bundle contains source
metadata, official links, recorded internal hashes and scoped paraphrases; raw
policy and standards snapshots are excluded because redistribution rights are
not uniformly verified.

