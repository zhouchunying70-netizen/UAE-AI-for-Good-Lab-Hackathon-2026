# Failure Cases and Limitations

## Demonstrated Failure Handling

| Case | Expected behavior | Evidence |
|---|---|---|
| Route event 12 arrives before 11 | Open a gap, suppress current route certainty, preserve both events, then resolve to sequence 12 | S3 run and verifier state assertion |
| Unknown capacity source | Reject the claim and request evidence | S4 run and `unknown-source-rejected` assertion |
| Service claim after power interruption | Block fail-closed | S2 authorization decision |
| Reopen after power restoration only | Block; keep service and capacity unconfirmed | S5 decision and false-recovery metric |
| Audit record modified | Fail chain verification even when manifest is recomputed | automated tamper test |
| S5 result modified and manifest recomputed | Fail semantic state and forbidden-outcome assertions | automated false-recovery test |
| Policy, Coordinator or token output modified | Fail Agent/audit binding and semantic checks | Agent-output tamper test |
| Weather event attempts to change power | Reject domain-payload mismatch | domain binding test |
| Verifier output aliases Oracle through symlink | Reject by canonical path and inode | alias-protection test |
| Otherwise confirmed recovery evidence is stale | Block reopening under candidate freshness policy | freshness test |

## Material Limitations

- The roles are deterministic local software agents, not generative or trained
  AI models.
- The policy corpus is intentionally small and is not a legal knowledge base
  for all UAE federal or emirate requirements.
- The English full text for the TDRA digital-service policy was not captured;
  that source is metadata-only.
- UAE portal reuse is verified as restrictive. Other publication-specific
  rights remain incomplete, so raw source files are excluded from the Git
  publication set.
- The verifier is separate code and a separate command, but it shares the local
  operator and repository. It is not independent human acceptance.
- The hash chain detects changes relative to the manifest but has no external
  timestamp, signature or hardware-backed identity.
- Metrics cover one synthetic fixture. They do not support performance,
  fairness, reliability or public-service effectiveness claims.
- The 300-second freshness window is `PROPOSED_NOT_VALIDATED`, not an
  operational service-level threshold.
- Arabic interaction, accessibility and real institutional validation are not
  implemented. A video is not required for initial submission.
- Participant-specific ITU evidence confirms the submission mailbox and exact
  deadline, but team name, Team Leader, roster, final GitHub URL and final
  receipt remain unverified in this public bundle.
- The current candidate has no remote repository, public publication, final
  submission email package or external submission authorization.
- The knowledge base is metadata/tag-based, not vector retrieval, and is not an
  ITU Lab-hosted distributed knowledge base. Domain and global policy coverage
  remain incomplete.
- Historical source hashes prove local byte identity only; they do not prove
  legal authenticity, policy completeness or copyright permission.

