import { sha256Object } from "./hash.js";

const SAFE_SIMULATION_ACTIONS = new Set([
  "PUBLISH_SYNTHETIC_HEAT_ADVISORY",
  "HOLD_SERVICE_AVAILABILITY_CLAIM",
  "UPDATE_SIMULATED_ROUTE_STATUS",
  "REQUEST_CAPACITY_CONFIRMATION",
  "HOLD_SERVICE_REOPENING",
]);

export const RECOVERY_FRESHNESS_MAX_AGE_SECONDS = 300;

function evaluateFreshness(state, requestedAt) {
  const requiredFields = ["facility", "service", "capacity", "demand", "human_acceptance"];
  const requestTime = Date.parse(requestedAt);
  const checks = requiredFields.map((field) => {
    const observedAt = state.evidence_observed_at?.[field] ?? null;
    const ageSeconds = observedAt ? (requestTime - Date.parse(observedAt)) / 1000 : null;
    const fresh = ageSeconds !== null
      && Number.isFinite(ageSeconds)
      && ageSeconds >= 0
      && ageSeconds <= RECOVERY_FRESHNESS_MAX_AGE_SECONDS;
    return { field, observed_at: observedAt, age_seconds: ageSeconds, fresh };
  });
  return {
    max_age_seconds: RECOVERY_FRESHNESS_MAX_AGE_SECONDS,
    threshold_status: "PROPOSED_NOT_VALIDATED",
    checks,
  };
}

function unmetRequirements(action, state, requestedAt) {
  if (action === "CLAIM_SERVICE_AVAILABLE") {
    return [
      state.power === "CONFIRMED_ON" || "POWER_NOT_CONFIRMED_ON",
      state.facility === "CONFIRMED_OPEN" || "FACILITY_NOT_CONFIRMED_OPEN",
      state.service === "CONFIRMED_AVAILABLE" || "SERVICE_NOT_CONFIRMED_AVAILABLE",
    ].filter((value) => value !== true);
  }
  if (action === "PUBLISH_ROUTE_OPEN_DURING_GAP") {
    return [
      state.route_gap === false || "ROUTE_SEQUENCE_GAP_ACTIVE",
      state.route === "OPEN" || "ROUTE_NOT_CONFIRMED_OPEN",
    ].filter((value) => value !== true);
  }
  if (action === "CLAIM_CAPACITY_AVAILABLE") {
    return [
      state.capacity === "CONFIRMED_SUFFICIENT" || "CAPACITY_NOT_CONFIRMED_SUFFICIENT",
      state.rejected_external_claim_ids.length === 0 || "SUPPORTING_SOURCE_REJECTED",
    ].filter((value) => value !== true);
  }
  if (action === "REOPEN_SERVICE") {
    const freshness = evaluateFreshness(state, requestedAt);
    const reasons = [
      state.power === "CONFIRMED_ON" || "POWER_NOT_CONFIRMED_ON",
      state.facility === "CONFIRMED_OPEN" || "FACILITY_NOT_CONFIRMED_OPEN",
      state.service === "CONFIRMED_AVAILABLE" || "SERVICE_NOT_CONFIRMED_AVAILABLE",
      state.capacity === "CONFIRMED_SUFFICIENT" || "CAPACITY_NOT_CONFIRMED_SUFFICIENT",
      state.human_acceptance === "RECORDED" || "HUMAN_ACCEPTANCE_NOT_RECORDED",
    ].filter((value) => value !== true);
    for (const check of freshness.checks) {
      if (!check.fresh) reasons.push(`${check.field.toUpperCase()}_EVIDENCE_NOT_FRESH`);
    }
    return { reasons, freshness };
  }
  return { reasons: ["UNKNOWN_ACTION_FAIL_CLOSED"], freshness: null };
}

export function evaluateActionRequest(request, state) {
  const evaluation = unmetRequirements(request.action, state, request.requested_at);
  const unmet = Array.isArray(evaluation) ? evaluation : evaluation.reasons;
  return {
    request_id: request.attempt_id,
    action: request.action,
    requester: request.requester,
    requested_at: request.requested_at,
    status: unmet.length === 0 ? "AUTHORIZED_SIMULATION_ONLY" : "BLOCKED_FAIL_CLOSED",
    reason_codes: unmet,
    evaluated_state: structuredClone(state),
    evaluated_state_sha256: sha256Object(state),
    freshness_evaluation: Array.isArray(evaluation) ? null : evaluation.freshness,
    real_world_effect: false,
  };
}

export class SimulationAuthorizationController {
  constructor(runId, ttlSeconds = 300) {
    this.runId = runId;
    this.ttlSeconds = ttlSeconds;
    this.tokens = new Map();
  }

  issue({ stageId, action, issuedAt, state, citations }) {
    if (!SAFE_SIMULATION_ACTIONS.has(action) || citations.length === 0) {
      return {
        status: "BLOCKED_FAIL_CLOSED",
        reason_codes: citations.length === 0 ? ["NO_ADMITTED_POLICY_CITATION"] : ["ACTION_NOT_SIMULATION_ALLOWLISTED"],
        real_world_effect: false,
      };
    }
    const expiresAt = new Date(Date.parse(issuedAt) + this.ttlSeconds * 1000).toISOString();
    const claimsDigest = sha256Object(citations);
    const stateDigest = sha256Object(state);
    const tokenId = `SIM-${stageId}-${sha256Object({
      run_id: this.runId,
      stage_id: stageId,
      action,
      issued_at: issuedAt,
      expires_at: expiresAt,
      state_sha256: stateDigest,
      citations_sha256: claimsDigest,
    }).slice(0, 20)}`;
    const token = {
      token_id: tokenId,
      run_id: this.runId,
      stage_id: stageId,
      action,
      issued_at: issuedAt,
      expires_at: expiresAt,
      state_sha256: stateDigest,
      citations_sha256: claimsDigest,
      real_world_effect: false,
    };
    this.tokens.set(tokenId, { token, consumed: false, revoked: false });
    return { status: "AUTHORIZED_SIMULATION_ONLY", fencing_token: token };
  }

  consume(token, { stageId, action, at }) {
    const entry = this.tokens.get(token?.token_id);
    if (!entry) return { status: "REJECTED_UNKNOWN_TOKEN", real_world_effect: false };
    if (sha256Object(entry.token) !== sha256Object(token)) {
      return { status: "REJECTED_TOKEN_TAMPER", real_world_effect: false };
    }
    if (entry.revoked) return { status: "REJECTED_REVOKED_TOKEN", real_world_effect: false };
    if (entry.consumed) return { status: "REJECTED_TOKEN_REPLAY", real_world_effect: false };
    if (entry.token.stage_id !== stageId || entry.token.action !== action) {
      return { status: "REJECTED_TOKEN_SCOPE", real_world_effect: false };
    }
    if (Date.parse(at) > Date.parse(entry.token.expires_at)) {
      return { status: "REJECTED_EXPIRED_TOKEN", real_world_effect: false };
    }
    entry.consumed = true;
    return {
      status: "CONSUMED_SIMULATION_ONLY",
      token_id: token.token_id,
      consumed_at: at,
      real_world_effect: false,
    };
  }

  revoke(tokenId) {
    const entry = this.tokens.get(tokenId);
    if (entry) entry.revoked = true;
  }
}
