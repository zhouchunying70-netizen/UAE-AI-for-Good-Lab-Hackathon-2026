import { mkdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { verifyAuditRecords } from "./audit.js";
import { sha256File, sha256Object } from "./hash.js";
import { readJson, writeJson } from "./io.js";
import { loadKnowledgeBase, retrieveClaims } from "./knowledge-base.js";

function assertion(id, pass, expected, actual) {
  return { id, pass, expected, actual };
}

function subsetMatches(actual, expected) {
  return Object.entries(expected).every(([key, value]) => {
    if (Array.isArray(value)) return JSON.stringify(actual?.[key]) === JSON.stringify(value);
    return actual?.[key] === value;
  });
}

function exactMatch(left, right) {
  return sha256Object(left) === sha256Object(right);
}

async function pathIdentity(filePath) {
  const resolved = path.resolve(filePath);
  try {
    const canonical = await realpath(resolved);
    const metadata = await stat(canonical);
    return { canonical, device: metadata.dev, inode: metadata.ino };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const canonicalParent = await realpath(path.dirname(resolved));
    return { canonical: path.join(canonicalParent, path.basename(resolved)), device: null, inode: null };
  }
}

async function guardOutputPath(outputPath, protectedPaths) {
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  const outputIdentity = await pathIdentity(outputPath);
  for (const protectedPath of protectedPaths) {
    const protectedIdentity = await pathIdentity(protectedPath);
    const sameCanonicalPath = outputIdentity.canonical === protectedIdentity.canonical;
    const sameExistingFile = outputIdentity.device !== null
      && outputIdentity.device === protectedIdentity.device
      && outputIdentity.inode === protectedIdentity.inode;
    if (sameCanonicalPath || sameExistingFile) {
      throw new Error(`Verifier output cannot overwrite protected input: ${protectedPath}`);
    }
  }
}

function expectedPolicyOutput(stage, fixtureStage, kb) {
  const citations = retrieveClaims(kb, fixtureStage.policy_tags);
  const externalClaims = stage.input_events
    .filter((event) => event.payload.external_claim)
    .map((event) => ({
      event_id: event.event_id,
      source_id: event.payload.external_claim.source_id,
      disposition: stage.state.rejected_external_claim_ids.includes(event.event_id)
        ? "REJECTED_SOURCE_NOT_ADMITTED"
        : "ACCEPTED",
    }));
  return {
    role: "Policy Adviser Agent",
    stage_id: stage.stage_id,
    citations,
    external_claims: externalClaims,
    policy_position: citations.length ? "SCOPED_GUIDANCE_AVAILABLE" : "ESCALATE_NO_ADMITTED_SOURCE",
  };
}

function expectedAuditEvents(fixture) {
  const domains = new Map(Object.entries(fixture.domain_sequences).map(([domain, next]) => [domain, {
    next,
    pending: new Map(),
  }]));
  const expected = new Map();
  for (const stage of fixture.stages) {
    const stageExpected = { applied_event_ids: [], sequence_gaps: [] };
    expected.set(stage.id, stageExpected);
    for (const event of stage.events) {
      const domain = domains.get(event.domain);
      if (event.sequence > domain.next) {
        stageExpected.sequence_gaps.push({
          domain: event.domain,
          next_expected: domain.next,
          received: event.sequence,
        });
      }
      domain.pending.set(event.sequence, event);
      while (domain.pending.has(domain.next)) {
        stageExpected.applied_event_ids.push(domain.pending.get(domain.next).event_id);
        domain.pending.delete(domain.next);
        domain.next += 1;
      }
    }
  }
  return expected;
}

function recordInventory(records) {
  const inventory = {};
  for (const record of records) {
    const key = `${record.type}::${record.actor}`;
    inventory[key] = (inventory[key] ?? 0) + 1;
  }
  return inventory;
}

export async function verifyRun({
  runDir,
  oraclePath,
  outputPath,
  sourcesPath,
  claimsPath,
  fixturePath,
  sourceVerificationMode,
}) {
  await guardOutputPath(outputPath, [oraclePath, sourcesPath, claimsPath, fixturePath]);
  const runPath = path.join(runDir, "run.json");
  const auditPath = path.join(runDir, "audit.jsonl");
  const manifestPath = path.join(runDir, "manifest.json");
  const [run, manifest, oracle, fixture, kb] = await Promise.all([
    readJson(runPath),
    readJson(manifestPath),
    readJson(oraclePath),
    readJson(fixturePath),
    loadKnowledgeBase(sourcesPath, claimsPath, { sourceVerificationMode }),
  ]);
  const auditLines = (await readFile(auditPath, "utf8")).trim().split("\n").filter(Boolean);
  const auditRecords = auditLines.map((line) => JSON.parse(line));
  const chain = verifyAuditRecords(auditRecords);
  const assertions = [];

  const [runHash, auditHash, fixtureHash, sourcesHash, claimsHash, oracleHash] = await Promise.all([
    sha256File(runPath),
    sha256File(auditPath),
    sha256File(fixturePath),
    sha256File(sourcesPath),
    sha256File(claimsPath),
    sha256File(oraclePath),
  ]);

  assertions.push(assertion("fixture-id", run.fixture_id === oracle.fixture_id && run.fixture_id === fixture.fixture_id, oracle.fixture_id, run.fixture_id));
  assertions.push(assertion("run-hash", runHash === manifest.files["run.json"], manifest.files["run.json"], runHash));
  assertions.push(assertion("audit-hash", auditHash === manifest.files["audit.jsonl"], manifest.files["audit.jsonl"], auditHash));
  const runStageIds = new Set(run.stages.map((stage) => stage.stage_id));
  const auditIdentityValid = auditRecords.every((record) => record.run_id === run.run_id && runStageIds.has(record.stage_id));
  assertions.push(assertion("audit-chain", chain.valid
    && chain.head === manifest.audit_chain_head
    && auditRecords.length === manifest.audit_record_count
    && auditIdentityValid, {
    head: manifest.audit_chain_head,
    record_count: manifest.audit_record_count,
    run_id: run.run_id,
    stage_ids: [...runStageIds],
  }, { ...chain, record_count: auditRecords.length, identity_valid: auditIdentityValid }));
  assertions.push(assertion("input-bindings", fixtureHash === manifest.inputs.fixture.sha256
    && sourcesHash === manifest.inputs.sources.sha256
    && claimsHash === manifest.inputs.claims.sha256
    && fixtureHash === run.fixture_sha256
    && sourcesHash === run.sources_sha256
    && claimsHash === run.claims_sha256
    && exactMatch(run.knowledge_base_verification, kb.verification)
    && exactMatch(manifest.knowledge_base_verification, kb.verification),
  { fixture: fixtureHash, sources: sourcesHash, claims: claimsHash, knowledge_base_verification: kb.verification }, {
    manifest: manifest.inputs,
    run: {
      fixture: run.fixture_sha256,
      sources: run.sources_sha256,
      claims: run.claims_sha256,
      knowledge_base_verification: run.knowledge_base_verification,
    },
    manifest_knowledge_base_verification: manifest.knowledge_base_verification,
  }));
  assertions.push(assertion("synthetic-only", run.synthetic_data && !run.real_authority && run.provider_calls === 0 && run.real_world_actions === 0, true, {
    synthetic_data: run.synthetic_data,
    real_authority: run.real_authority,
    provider_calls: run.provider_calls,
    real_world_actions: run.real_world_actions,
  }));

  for (const [stageId, expected] of Object.entries(oracle.expected_stages)) {
    const stage = run.stages.find((candidate) => candidate.stage_id === stageId);
    assertions.push(assertion(`state-${stageId}`, Boolean(stage) && subsetMatches(stage.state, expected), expected, stage?.state ?? null));
  }

  const fixtureBinding = run.stages.every((stage) => {
    const sourceStage = fixture.stages.find((candidate) => candidate.id === stage.stage_id);
    return sourceStage
      && sha256Object(stage.input_events) === sha256Object(sourceStage.events)
      && sha256Object(stage.action_requests) === sha256Object(sourceStage.unsafe_attempts);
  });
  assertions.push(assertion("fixture-stage-inputs", fixtureBinding, "run stage inputs exactly match hashed fixture", run.stages.map((stage) => stage.stage_id)));

  const auditByStage = new Map(run.stages.map((stage) => [stage.stage_id, auditRecords.filter((record) => record.stage_id === stage.stage_id)]));
  const expectedAuditEventsByStage = expectedAuditEvents(fixture);
  const outputConsistency = run.stages.every((stage) => {
    const records = auditByStage.get(stage.stage_id);
    const select = (type, actor) => records.filter((record) => record.type === type && (!actor || record.actor === actor));
    const stageStartedRecords = select("STAGE_STARTED", "Orchestrator");
    const eventAgentRecords = select("AGENT_OUTPUT", "Event Intelligence Agent");
    const policyAgentRecords = select("AGENT_OUTPUT", "Policy Adviser Agent");
    const coordinatorRecords = select("AGENT_OUTPUT", "Simulated Public Service Coordinator");
    const authorizationRecords = select("AUTHORIZATION_DECISION", "Authorization and Audit Agent");
    const snapshotRecords = select("STATE_SNAPSHOT", "Orchestrator");
    const eventIngestedRecords = select("EVENT_INGESTED", "Event Intelligence Agent");
    const eventAppliedRecords = select("EVENT_APPLIED", "Event Intelligence Agent");
    const sequenceGapRecords = select("SEQUENCE_GAP_OPENED", "Event Intelligence Agent");
    const actionDecisionRecords = select("ACTION_REQUEST_DECISION", "Authorization and Audit Agent");
    const expectedAuditEventSet = expectedAuditEventsByStage.get(stage.stage_id);
    const expectedEventIds = stage.input_events.map((event) => event.event_id).sort();
    const actualEventIds = eventIngestedRecords.map((record) => record.payload?.event_id).sort();
    const actualAppliedEventIds = eventAppliedRecords.map((record) => record.payload?.event_id);
    const expectedRequestIds = stage.action_requests.map((request) => request.attempt_id).sort();
    const actualRequestIds = actionDecisionRecords.map((record) => record.payload?.decision?.request_id).sort();
    const expectedInventory = {
      "ACTION_REQUEST_DECISION::Authorization and Audit Agent": stage.action_requests.length,
      "AGENT_OUTPUT::Event Intelligence Agent": 1,
      "AGENT_OUTPUT::Policy Adviser Agent": 1,
      "AGENT_OUTPUT::Simulated Public Service Coordinator": 1,
      "AUTHORIZATION_DECISION::Authorization and Audit Agent": 1,
      "EVENT_APPLIED::Event Intelligence Agent": expectedAuditEventSet.applied_event_ids.length,
      "EVENT_INGESTED::Event Intelligence Agent": stage.input_events.length,
      "SEQUENCE_GAP_OPENED::Event Intelligence Agent": expectedAuditEventSet.sequence_gaps.length,
      "STAGE_STARTED::Orchestrator": 1,
      "STATE_SNAPSHOT::Orchestrator": 1,
    };
    for (const [key, count] of Object.entries(expectedInventory)) {
      if (count === 0) delete expectedInventory[key];
    }
    const singletonCardinality = [
      stageStartedRecords,
      eventAgentRecords,
      policyAgentRecords,
      coordinatorRecords,
      authorizationRecords,
      snapshotRecords,
    ].every((matches) => matches.length === 1);
    const [eventAgentRecord] = eventAgentRecords;
    const [policyAgentRecord] = policyAgentRecords;
    const [coordinatorRecord] = coordinatorRecords;
    const [authorizationRecord] = authorizationRecords;
    const [snapshotRecord] = snapshotRecords;
    const actionAuditBindings = stage.action_requests.every((request) => {
      const matchingRecords = actionDecisionRecords.filter((record) => record.payload?.request?.attempt_id === request.attempt_id);
      const matchingDecisions = stage.agents.authorization_audit.unsafe_decisions
        .filter((decision) => decision.request_id === request.attempt_id);
      return matchingRecords.length === 1
        && matchingDecisions.length === 1
        && exactMatch(matchingRecords[0].payload.request, request)
        && exactMatch(matchingRecords[0].payload.decision, matchingDecisions[0]);
    });
    const appliedEventBindings = eventAppliedRecords.every((record) => {
      const event = stage.input_events.find((candidate) => candidate.event_id === record.payload?.event_id);
      return event
        && record.payload.domain === event.domain
        && record.payload.sequence === event.sequence
        && record.payload.source === event.source
        && record.payload.observed_at === event.observed_at
        && record.payload.payload_sha256 === sha256Object(event.payload)
        && exactMatch(record.payload.payload, event.payload);
    });
    const sequenceGapBindings = exactMatch(
      sequenceGapRecords.map((record) => record.payload),
      expectedAuditEventSet.sequence_gaps,
    );
    return singletonCardinality
      && exactMatch(recordInventory(records), expectedInventory)
      && exactMatch(stageStartedRecords[0].payload, { name: stage.name })
      && exactMatch(actualEventIds, expectedEventIds)
      && exactMatch(actualAppliedEventIds, expectedAuditEventSet.applied_event_ids)
      && exactMatch(actualRequestIds, expectedRequestIds)
      && actionAuditBindings
      && appliedEventBindings
      && sequenceGapBindings
      && exactMatch(stage.agents.event_intelligence.current_facts, stage.state)
      && exactMatch(eventAgentRecord?.payload, stage.agents.event_intelligence)
      && exactMatch(policyAgentRecord?.payload, stage.agents.policy_adviser)
      && exactMatch(coordinatorRecord?.payload, stage.agents.coordinator)
      && exactMatch(authorizationRecord?.payload, stage.agents.authorization_audit)
      && exactMatch(snapshotRecord?.payload?.state, stage.state)
      && exactMatch(snapshotRecord?.payload?.five_dimension_state, stage.five_dimension_state);
  });
  assertions.push(assertion("stage-agent-audit-output-consistency", outputConsistency, "stage state and every Agent output match their audit records", outputConsistency));

  const eventAgentSemantics = run.stages.every((stage) => exactMatch(stage.agents.event_intelligence, {
    role: "Event Intelligence Agent",
    stage_id: stage.stage_id,
    current_facts: stage.state,
    anomalies: oracle.expected_event_anomalies[stage.stage_id],
  }));
  assertions.push(assertion(
    "event-agent-semantics",
    eventAgentSemantics,
    oracle.expected_event_anomalies,
    run.stages.map((stage) => stage.agents.event_intelligence),
  ));

  const ingestedRecords = auditRecords.filter((record) => record.type === "EVENT_INGESTED");
  const eventBindings = run.stages.flatMap((stage) => stage.input_events).every((event) => {
    const record = ingestedRecords.find((candidate) => candidate.payload.event_id === event.event_id);
    return record
      && record.payload.source === event.source
      && record.payload.observed_at === event.observed_at
      && record.payload.event_sha256 === sha256Object(event)
      && record.payload.payload_sha256 === sha256Object(event.payload)
      && exactMatch(record.payload.payload, event.payload);
  });
  assertions.push(assertion("audit-event-input-bindings", eventBindings, "every fixture event is bound by identity, source, time, payload and hashes", eventBindings));

  const decisionEntries = run.stages.flatMap((stage) =>
    stage.agents.authorization_audit.unsafe_decisions.map((decision) => ({ stage_id: stage.stage_id, decision })));
  const expectedDecisionEntries = fixture.stages
    .flatMap((stage) => stage.unsafe_attempts.map((request) => ({ stage_id: stage.id, request_id: request.attempt_id })))
    .sort((left, right) => `${left.stage_id}:${left.request_id}`.localeCompare(`${right.stage_id}:${right.request_id}`));
  const actualDecisionEntries = decisionEntries
    .map((entry) => ({ stage_id: entry.stage_id, request_id: entry.decision.request_id }))
    .sort((left, right) => `${left.stage_id}:${left.request_id}`.localeCompare(`${right.stage_id}:${right.request_id}`));
  assertions.push(assertion(
    "action-decision-set",
    exactMatch(actualDecisionEntries, expectedDecisionEntries),
    expectedDecisionEntries,
    actualDecisionEntries,
  ));
  for (const [requestId, expected] of Object.entries(oracle.expected_action_decisions)) {
    const matches = decisionEntries.filter((entry) => entry.decision.request_id === requestId);
    const entry = matches[0];
    const actual = entry?.decision;
    const fixtureStage = fixture.stages.find((stage) => stage.unsafe_attempts.some((request) => request.attempt_id === requestId));
    const fixtureRequest = fixtureStage?.unsafe_attempts.find((request) => request.attempt_id === requestId);
    const expectedReasonCodes = expected.expected_reason_codes ?? expected.required_reason_codes;
    const staleFields = actual?.freshness_evaluation?.checks
      ?.filter((check) => !check.fresh)
      .map((check) => check.field);
    const pass = matches.length === 1
      && entry.stage_id === fixtureStage?.id
      && actual?.action === expected.action
      && actual?.requester === fixtureRequest?.requester
      && actual?.requested_at === fixtureRequest?.requested_at
      && actual?.status === expected.status
      && exactMatch(actual.reason_codes, expectedReasonCodes)
      && actual.evaluated_state_sha256 === sha256Object(actual.evaluated_state)
      && (!expected.expected_stale_fields || (
        actual.freshness_evaluation?.max_age_seconds === oracle.recovery_freshness_max_age_seconds
        && actual.freshness_evaluation?.threshold_status === "PROPOSED_NOT_VALIDATED"
        && exactMatch(staleFields, expected.expected_stale_fields)
      ))
      && actual.real_world_effect === false;
    assertions.push(assertion(`action-decision-${requestId}`, pass, expected, actual ?? null));
  }

  const tokens = run.stages.map((stage) => stage.agents.authorization_audit).filter((output) => output.proposal_decision.fencing_token);
  const tokenIds = tokens.map((output) => output.proposal_decision.fencing_token.token_id);
  const tokenSemantics = tokens.length === run.stages.length
    && new Set(tokenIds).size === tokenIds.length
    && run.stages.every((stage) => {
      const output = stage.agents.authorization_audit;
      const token = output.proposal_decision.fencing_token;
      const citationsSha256 = sha256Object(stage.agents.policy_adviser.citations);
      const stateSha256 = sha256Object(stage.state);
      const expectedExpiresAt = new Date(
        Date.parse(token.issued_at) + oracle.fencing_token_ttl_seconds * 1000,
      ).toISOString();
      const expectedTokenId = `SIM-${stage.stage_id}-${sha256Object({
        run_id: run.run_id,
        stage_id: stage.stage_id,
        action: stage.agents.coordinator.proposal,
        issued_at: token.issued_at,
        expires_at: token.expires_at,
        state_sha256: stateSha256,
        citations_sha256: citationsSha256,
      }).slice(0, 20)}`;
      return output.proposal_decision.status === "AUTHORIZED_SIMULATION_ONLY"
        && output.role === "Authorization and Audit Agent"
        && output.authority === "PROVISIONAL_LOCAL_SIMULATION_ONLY"
        && output.stage_id === stage.stage_id
        && token.token_id === expectedTokenId
        && token.run_id === run.run_id
        && token.stage_id === stage.stage_id
        && token.action === stage.agents.coordinator.proposal
        && token.state_sha256 === stateSha256
        && token.citations_sha256 === citationsSha256
        && token.expires_at === expectedExpiresAt
        && output.proposal_execution.status === "CONSUMED_SIMULATION_ONLY"
        && output.proposal_execution.token_id === token.token_id
        && output.proposal_execution.consumed_at === token.issued_at
        && token.real_world_effect === false
        && output.proposal_execution.real_world_effect === false;
    });
  assertions.push(assertion("fencing-token-consumption", tokenSemantics, "unique, scoped, unexpired and consumed once for simulation only", tokenIds));

  const policySemantics = run.stages.every((stage) => {
    const fixtureStage = fixture.stages.find((candidate) => candidate.id === stage.stage_id);
    return fixtureStage && exactMatch(stage.agents.policy_adviser, expectedPolicyOutput(stage, fixtureStage, kb));
  });
  assertions.push(assertion(
    "policy-agent-semantics",
    policySemantics,
    kb.verification.raw_source_bytes_verified
      ? "policy outputs exactly match admitted claims bound to verified source snapshots"
      : "policy outputs exactly match admitted metadata; raw source bytes were not included or verified",
    run.stages.map((stage) => stage.agents.policy_adviser),
  ));

  const coordinatorSemantics = run.stages.every((stage) => {
    const expected = oracle.expected_coordinator_outputs[stage.stage_id];
    return expected && exactMatch(stage.agents.coordinator, {
      role: "Simulated Public Service Coordinator",
      authority: "NO_REAL_INSTITUTIONAL_AUTHORITY",
      stage_id: stage.stage_id,
      proposal: expected.proposal,
      rationale: expected.rationale,
    });
  });
  assertions.push(assertion(
    "coordinator-agent-semantics",
    coordinatorSemantics,
    oracle.expected_coordinator_outputs,
    run.stages.map((stage) => stage.agents.coordinator),
  ));

  const rejectedUnknown = run.stages.flatMap((stage) => stage.agents.policy_adviser.external_claims)
    .filter((claim) => claim.disposition === "REJECTED_SOURCE_NOT_ADMITTED");
  assertions.push(assertion("unknown-source-rejected", rejectedUnknown.length === 1, 1, rejectedUnknown.length));
  assertions.push(assertion("forbidden-outcomes", oracle.forbidden_outcomes.every((outcome) => !run.forbidden_outcomes.includes(outcome)), [], run.forbidden_outcomes));

  const receipt = {
    schema_version: "1.1",
    verifier: "LOCAL_DETERMINISTIC_VERIFIER_SEPARATE_CLI",
    review_boundary: "MACHINE_CHECK_NOT_THIRD_PARTY_HUMAN_CERTIFICATION",
    independent_human_acceptance: false,
    run_id: run.run_id,
    oracle: { logical_path: "verifier/oracles/s1-s5.oracle.json", sha256: oracleHash },
    verified_inputs: { fixture_sha256: fixtureHash, sources_sha256: sourcesHash, claims_sha256: claimsHash },
    knowledge_base_verification: kb.verification,
    status: assertions.every((item) => item.pass) ? "PASS" : "FAIL",
    assertions,
    summary: {
      passed: assertions.filter((item) => item.pass).length,
      failed: assertions.filter((item) => !item.pass).length,
      total: assertions.length,
    },
  };
  await writeJson(outputPath, receipt);
  return receipt;
}
