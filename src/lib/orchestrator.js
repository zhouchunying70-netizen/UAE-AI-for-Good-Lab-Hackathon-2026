import path from "node:path";
import { evaluateActionRequest, SimulationAuthorizationController } from "./authorization.js";
import { AuditChain } from "./audit.js";
import { eventIntelligenceAgent, policyAdviserAgent, coordinatorAgent, authorizationAuditAgent } from "./agents.js";
import { EventLedger } from "./event-ledger.js";
import { sha256File, sha256Object } from "./hash.js";
import { loadKnowledgeBase, isAdmittedSource } from "./knowledge-base.js";
import { readJson, writeJson, writeText } from "./io.js";
import { applyEvent, fiveDimensionState, initialState } from "./state.js";

export async function runFixture({
  fixturePath,
  outputDir,
  sourcesPath,
  claimsPath,
  sourceVerificationMode,
}) {
  const fixture = await readJson(fixturePath);
  const kb = await loadKnowledgeBase(sourcesPath, claimsPath, { sourceVerificationMode });
  const ledger = new EventLedger(fixture.domain_sequences);
  const audit = new AuditChain(fixture.run_id);
  const authorization = new SimulationAuthorizationController(fixture.run_id);
  const stages = [];
  let state = initialState();

  for (const stage of fixture.stages) {
    const eventResults = [];
    const unsafeDecisions = [];
    const pendingRequests = [...stage.unsafe_attempts].sort((left, right) =>
      Date.parse(left.requested_at) - Date.parse(right.requested_at));
    audit.append("STAGE_STARTED", stage.id, "Orchestrator", { name: stage.name });

    const evaluatePendingRequests = (beforeTime = Number.POSITIVE_INFINITY) => {
      while (pendingRequests.length && Date.parse(pendingRequests[0].requested_at) < beforeTime) {
        const request = pendingRequests.shift();
        const decision = evaluateActionRequest(request, structuredClone(state));
        unsafeDecisions.push(decision);
        audit.append("ACTION_REQUEST_DECISION", stage.id, "Authorization and Audit Agent", {
          request,
          decision,
        });
      }
    };

    for (const event of stage.events) {
      evaluatePendingRequests(Date.parse(event.observed_at));
      const result = ledger.ingest(event);
      eventResults.push(result);
      audit.append("EVENT_INGESTED", stage.id, "Event Intelligence Agent", {
        event_id: event.event_id,
        domain: event.domain,
        sequence: event.sequence,
        source: event.source,
        observed_at: event.observed_at,
        event_sha256: sha256Object(event),
        payload_sha256: sha256Object(event.payload),
        payload: event.payload,
        status: result.status,
        reason: result.reason ?? null,
        active_gap: Boolean(result.active_gap),
      });
      if (result.status === "PENDING_GAP") {
        state.route = event.domain === "route" ? "UNKNOWN" : state.route;
        state.route_gap = event.domain === "route";
        if (event.domain === "route") state.evidence_observed_at.route = event.observed_at;
        audit.append("SEQUENCE_GAP_OPENED", stage.id, "Event Intelligence Agent", {
          domain: event.domain,
          next_expected: result.next_expected,
          received: event.sequence,
        });
      }
      for (const appliedEvent of result.applied) {
        state = applyEvent(state, appliedEvent, {
          isAdmittedSource: (sourceId) => isAdmittedSource(kb, sourceId),
        });
        audit.append("EVENT_APPLIED", stage.id, "Event Intelligence Agent", {
          event_id: appliedEvent.event_id,
          domain: appliedEvent.domain,
          sequence: appliedEvent.sequence,
          source: appliedEvent.source,
          observed_at: appliedEvent.observed_at,
          event_sha256: sha256Object(appliedEvent),
          payload_sha256: sha256Object(appliedEvent.payload),
          payload: appliedEvent.payload,
          late_arrival: Boolean(appliedEvent.late_arrival),
        });
      }
      if (event.domain === "route") {
        state.route_gap = ledger.activeGap("route");
      }
    }
    evaluatePendingRequests();

    const eventOutput = eventIntelligenceAgent(stage, state, eventResults);
    const policyOutput = policyAdviserAgent(stage, state, kb);
    const coordinatorOutput = coordinatorAgent(stage, state);
    const authorizationOutput = authorizationAuditAgent(
      stage,
      coordinatorOutput,
      policyOutput,
      state,
      authorization,
      unsafeDecisions,
    );

    audit.append("AGENT_OUTPUT", stage.id, "Event Intelligence Agent", eventOutput);
    audit.append("AGENT_OUTPUT", stage.id, "Policy Adviser Agent", policyOutput);
    audit.append("AGENT_OUTPUT", stage.id, "Simulated Public Service Coordinator", coordinatorOutput);
    audit.append("AUTHORIZATION_DECISION", stage.id, "Authorization and Audit Agent", authorizationOutput);

    const stageRecord = {
      stage_id: stage.id,
      name: stage.name,
      input_events: structuredClone(stage.events),
      action_requests: structuredClone(stage.unsafe_attempts),
      state: structuredClone(state),
      five_dimension_state: fiveDimensionState({ eventResults, authorization: authorizationOutput }),
      agents: {
        event_intelligence: eventOutput,
        policy_adviser: policyOutput,
        coordinator: coordinatorOutput,
        authorization_audit: authorizationOutput,
      },
    };
    stages.push(stageRecord);
    audit.append("STATE_SNAPSHOT", stage.id, "Orchestrator", {
      state: stageRecord.state,
      five_dimension_state: stageRecord.five_dimension_state,
    });
  }

  const run = {
    schema_version: "1.0",
    run_id: fixture.run_id,
    fixture_id: fixture.fixture_id,
    generated_at: fixture.generated_at,
    scenario_status: fixture.scenario_status,
    owner_approval: fixture.owner_approval ?? "NOT_SPECIFIED",
    synthetic_data: fixture.synthetic_data,
    real_authority: fixture.real_authority,
    provider_calls: 0,
    real_world_actions: 0,
    knowledge_base_digest: kb.digest,
    source_register_digest: sha256Object(kb.sourceRegister),
    claim_register_digest: sha256Object(kb.claimRegister),
    fixture_sha256: await sha256File(fixturePath),
    sources_sha256: await sha256File(sourcesPath),
    claims_sha256: await sha256File(claimsPath),
    knowledge_base_verification: kb.verification,
    stages,
    final_state: stages.at(-1).state,
    forbidden_outcomes: [],
    limitations: [
      "No external AI model or provider was used.",
      "All events and identities are synthetic.",
      "No real UAE institution or service was contacted or controlled.",
      "Machine verification is not independent human acceptance.",
      ...(kb.verification.raw_source_bytes_verified
        ? []
        : ["RAW_SOURCE_VERIFICATION_NOT_PERFORMED_IN_PUBLIC_BUNDLE"]),
    ],
  };

  const runPath = path.join(outputDir, "run.json");
  const auditPath = path.join(outputDir, "audit.jsonl");
  await writeJson(runPath, run);
  await writeText(auditPath, audit.toJsonl());

  const manifest = {
    schema_version: "1.0",
    run_id: fixture.run_id,
    files: {
      "run.json": await sha256File(runPath),
      "audit.jsonl": await sha256File(auditPath),
    },
    inputs: {
      fixture: { logical_path: logicalInputPath(fixturePath), sha256: await sha256File(fixturePath) },
      sources: { logical_path: logicalInputPath(sourcesPath), sha256: await sha256File(sourcesPath) },
      claims: { logical_path: logicalInputPath(claimsPath), sha256: await sha256File(claimsPath) },
    },
    knowledge_base_verification: kb.verification,
    audit_chain_head: audit.records.at(-1)?.record_hash ?? "GENESIS",
    audit_record_count: audit.records.length,
  };
  await writeJson(path.join(outputDir, "manifest.json"), manifest);
  return { run, manifest };
}

function logicalInputPath(filePath) {
  return path.relative(process.cwd(), filePath).split(path.sep).join("/");
}

