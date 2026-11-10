import { retrieveClaims } from "./knowledge-base.js";

const SAFE_PROPOSALS = {
  S1: "PUBLISH_SYNTHETIC_HEAT_ADVISORY",
  S2: "HOLD_SERVICE_AVAILABILITY_CLAIM",
  S3: "UPDATE_SIMULATED_ROUTE_STATUS",
  S4: "REQUEST_CAPACITY_CONFIRMATION",
  S5: "HOLD_SERVICE_REOPENING",
};

export function eventIntelligenceAgent(stage, state, eventResults) {
  return {
    role: "Event Intelligence Agent",
    stage_id: stage.id,
    current_facts: structuredClone(state),
    anomalies: eventResults
      .filter((result) => result.status !== "ACCEPTED" || result.late_arrival)
      .map((result) => ({
        event_id: result.event.event_id,
        status: result.status,
        late_arrival: Boolean(result.late_arrival),
        active_gap: Boolean(result.active_gap),
      })),
  };
}

export function policyAdviserAgent(stage, state, kb) {
  const citations = retrieveClaims(kb, stage.policy_tags);
  const externalClaims = stage.events
    .filter((event) => event.payload.external_claim)
    .map((event) => ({
      event_id: event.event_id,
      source_id: event.payload.external_claim.source_id,
      disposition: state.rejected_external_claim_ids.includes(event.event_id)
        ? "REJECTED_SOURCE_NOT_ADMITTED"
        : "ACCEPTED",
    }));

  return {
    role: "Policy Adviser Agent",
    stage_id: stage.id,
    citations,
    external_claims: externalClaims,
    policy_position: citations.length ? "SCOPED_GUIDANCE_AVAILABLE" : "ESCALATE_NO_ADMITTED_SOURCE",
  };
}

export function coordinatorAgent(stage, state) {
  return {
    role: "Simulated Public Service Coordinator",
    authority: "NO_REAL_INSTITUTIONAL_AUTHORITY",
    stage_id: stage.id,
    proposal: SAFE_PROPOSALS[stage.id],
    rationale: proposalRationale(stage.id, state),
  };
}

function proposalRationale(stageId, state) {
  if (stageId === "S1") return "Publish only the synthetic warning and recorded baseline.";
  if (stageId === "S2") return "Power interruption leaves service and capacity unconfirmed.";
  if (stageId === "S3") return "Use the highest contiguous route sequence and preserve the late event.";
  if (stageId === "S4") return "Rising demand and unknown capacity require evidence, not an availability claim.";
  return `Power is ${state.power}, but service and capacity remain unconfirmed.`;
}

export function authorizationAuditAgent(stage, proposal, policyOutput, state, controller, unsafeDecisions) {
  const issuedAt = stage.events.at(-1).observed_at;
  const proposalDecision = controller.issue({
    stageId: stage.id,
    action: proposal.proposal,
    issuedAt,
    state,
    citations: policyOutput.citations,
  });
  const proposalExecution = proposalDecision.fencing_token
    ? controller.consume(proposalDecision.fencing_token, {
      stageId: stage.id,
      action: proposal.proposal,
      at: issuedAt,
    })
    : { status: "NOT_EXECUTED", real_world_effect: false };

  return {
    role: "Authorization and Audit Agent",
    authority: "PROVISIONAL_LOCAL_SIMULATION_ONLY",
    stage_id: stage.id,
    proposal_decision: proposalDecision,
    proposal_execution: proposalExecution,
    unsafe_decisions: unsafeDecisions,
  };
}

