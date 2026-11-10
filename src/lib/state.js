const VALUES = {
  heat_warning: new Set(["NONE", "EXTREME"]),
  power: new Set(["UNKNOWN", "CONFIRMED_ON", "INTERRUPTED"]),
  facility: new Set(["UNCONFIRMED", "CONFIRMED_OPEN", "CONFIRMED_CLOSED"]),
  service: new Set(["UNCONFIRMED", "CONFIRMED_AVAILABLE", "UNAVAILABLE"]),
  capacity: new Set(["UNKNOWN", "CONFIRMED_SUFFICIENT", "INSUFFICIENT"]),
  route: new Set(["UNKNOWN", "OPEN", "RESTRICTED", "CLOSED"]),
  demand: new Set(["BASELINE", "RISING", "SURGE"]),
  human_acceptance: new Set(["NOT_PROVIDED", "RECORDED"]),
};

const TRANSITIONS = {
  heat_warning: {
    NONE: new Set(["NONE", "EXTREME"]),
    EXTREME: new Set(["EXTREME"]),
  },
  power: {
    UNKNOWN: new Set(["UNKNOWN", "CONFIRMED_ON", "INTERRUPTED"]),
    CONFIRMED_ON: new Set(["CONFIRMED_ON", "INTERRUPTED"]),
    INTERRUPTED: new Set(["INTERRUPTED", "CONFIRMED_ON"]),
  },
  facility: {
    UNCONFIRMED: new Set(["UNCONFIRMED", "CONFIRMED_OPEN", "CONFIRMED_CLOSED"]),
    CONFIRMED_OPEN: new Set(["CONFIRMED_OPEN", "CONFIRMED_CLOSED", "UNCONFIRMED"]),
    CONFIRMED_CLOSED: new Set(["CONFIRMED_CLOSED", "CONFIRMED_OPEN", "UNCONFIRMED"]),
  },
  service: {
    UNCONFIRMED: new Set(["UNCONFIRMED", "CONFIRMED_AVAILABLE", "UNAVAILABLE"]),
    CONFIRMED_AVAILABLE: new Set(["CONFIRMED_AVAILABLE", "UNAVAILABLE", "UNCONFIRMED"]),
    UNAVAILABLE: new Set(["UNAVAILABLE", "CONFIRMED_AVAILABLE", "UNCONFIRMED"]),
  },
  capacity: {
    UNKNOWN: new Set(["UNKNOWN", "CONFIRMED_SUFFICIENT", "INSUFFICIENT"]),
    CONFIRMED_SUFFICIENT: new Set(["CONFIRMED_SUFFICIENT", "INSUFFICIENT", "UNKNOWN"]),
    INSUFFICIENT: new Set(["INSUFFICIENT", "CONFIRMED_SUFFICIENT", "UNKNOWN"]),
  },
  route: {
    UNKNOWN: new Set(["UNKNOWN", "OPEN", "RESTRICTED", "CLOSED"]),
    OPEN: new Set(["OPEN", "RESTRICTED", "CLOSED", "UNKNOWN"]),
    RESTRICTED: new Set(["RESTRICTED", "OPEN", "CLOSED", "UNKNOWN"]),
    CLOSED: new Set(["CLOSED", "OPEN", "RESTRICTED", "UNKNOWN"]),
  },
  demand: {
    BASELINE: new Set(["BASELINE", "RISING", "SURGE"]),
    RISING: new Set(["RISING", "SURGE", "BASELINE"]),
    SURGE: new Set(["SURGE", "RISING", "BASELINE"]),
  },
  human_acceptance: {
    NOT_PROVIDED: new Set(["NOT_PROVIDED", "RECORDED"]),
    RECORDED: new Set(["RECORDED"]),
  },
};

const PAYLOAD_KEYS = new Set([
  "heat_warning",
  "power",
  "facility",
  "service",
  "capacity",
  "route",
  "demand",
  "human_acceptance",
  "external_claim",
]);

const DOMAIN_PAYLOAD_KEYS = {
  weather: new Set(["heat_warning"]),
  power: new Set(["power"]),
  facility: new Set(["facility"]),
  service: new Set(["service"]),
  capacity: new Set(["capacity"]),
  route: new Set(["route"]),
  demand: new Set(["demand", "external_claim"]),
  human_acceptance: new Set(["human_acceptance"]),
};

export function initialState() {
  return {
    heat_warning: "NONE",
    power: "UNKNOWN",
    facility: "UNCONFIRMED",
    service: "UNCONFIRMED",
    capacity: "UNKNOWN",
    route: "UNKNOWN",
    route_gap: false,
    demand: "BASELINE",
    human_acceptance: "NOT_PROVIDED",
    late_event_ids: [],
    rejected_external_claim_ids: [],
    evidence_observed_at: {
      heat_warning: null,
      power: null,
      facility: null,
      service: null,
      capacity: null,
      route: null,
      demand: null,
      human_acceptance: null,
    },
  };
}

function setState(next, field, value) {
  if (!VALUES[field]?.has(value)) throw new Error(`Invalid ${field} value: ${value}`);
  if (!TRANSITIONS[field][next[field]]?.has(value)) {
    throw new Error(`Illegal ${field} transition: ${next[field]} -> ${value}`);
  }
  next[field] = value;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Event payload must be an object");
  }
  for (const key of Object.keys(payload)) {
    if (!PAYLOAD_KEYS.has(key)) throw new Error(`Unknown payload field: ${key}`);
  }
  if (payload.external_claim) {
    const claim = payload.external_claim;
    if (typeof claim.source_id !== "string" || typeof claim.claim !== "string") {
      throw new Error("external_claim requires source_id and claim strings");
    }
  }
}

export function domainPayloadError(event) {
  const allowed = DOMAIN_PAYLOAD_KEYS[event.domain];
  if (!allowed) return `UNKNOWN_EVENT_DOMAIN:${event.domain}`;
  const invalid = Object.keys(event.payload ?? {}).filter((key) => !allowed.has(key));
  return invalid.length ? `DOMAIN_PAYLOAD_MISMATCH:${event.domain}:${invalid.sort().join(",")}` : null;
}

function recordEvidence(next, field, observedAt) {
  next.evidence_observed_at[field] = observedAt;
}

export function applyEvent(state, event, context) {
  const next = structuredClone(state);
  const payload = event.payload;
  validatePayload(payload);
  const mismatch = domainPayloadError(event);
  if (mismatch) throw new Error(mismatch);

  if (payload.heat_warning) {
    setState(next, "heat_warning", payload.heat_warning);
    recordEvidence(next, "heat_warning", event.observed_at);
  }
  if (payload.power === "CONFIRMED_ON") {
    setState(next, "power", "CONFIRMED_ON");
    recordEvidence(next, "power", event.observed_at);
  }
  if (payload.power === "INTERRUPTED") {
    setState(next, "power", "INTERRUPTED");
    setState(next, "facility", "UNCONFIRMED");
    setState(next, "service", "UNCONFIRMED");
    setState(next, "capacity", "UNKNOWN");
    for (const field of ["power", "facility", "service", "capacity"]) {
      recordEvidence(next, field, event.observed_at);
    }
  }
  if (payload.power === "RESTORED") {
    setState(next, "power", "CONFIRMED_ON");
    recordEvidence(next, "power", event.observed_at);
  }
  if (payload.power && !["CONFIRMED_ON", "INTERRUPTED", "RESTORED"].includes(payload.power)) {
    throw new Error(`Invalid power event value: ${payload.power}`);
  }

  if (payload.facility) {
    if (payload.facility === "CONFIRMED_OPEN" && next.power !== "CONFIRMED_ON") {
      throw new Error("Facility cannot be confirmed open without confirmed power");
    }
    setState(next, "facility", payload.facility);
    recordEvidence(next, "facility", event.observed_at);
  }
  if (payload.service) {
    if (payload.service === "CONFIRMED_AVAILABLE" && (next.power !== "CONFIRMED_ON" || next.facility !== "CONFIRMED_OPEN")) {
      throw new Error("Service cannot be confirmed available without confirmed power and facility");
    }
    setState(next, "service", payload.service);
    recordEvidence(next, "service", event.observed_at);
  }
  if (payload.capacity) {
    setState(next, "capacity", payload.capacity);
    recordEvidence(next, "capacity", event.observed_at);
  }
  if (payload.route) {
    setState(next, "route", payload.route);
    recordEvidence(next, "route", event.observed_at);
  }
  if (payload.demand) {
    setState(next, "demand", payload.demand);
    recordEvidence(next, "demand", event.observed_at);
  }
  if (payload.human_acceptance) {
    setState(next, "human_acceptance", payload.human_acceptance);
    recordEvidence(next, "human_acceptance", event.observed_at);
  }

  if (event.late_arrival && !next.late_event_ids.includes(event.event_id)) {
    next.late_event_ids.push(event.event_id);
  }
  if (payload.external_claim && !context.isAdmittedSource(payload.external_claim.source_id)) {
    next.rejected_external_claim_ids.push(event.event_id);
  }

  return next;
}

export function fiveDimensionState({ eventResults, authorization }) {
  const anomaly = eventResults.some((result) => result.status !== "ACCEPTED" || result.late_arrival);
  return {
    evidence: anomaly ? "ACCEPTED_WITH_RECORDED_ANOMALY" : "ACCEPTED",
    proposal: "PROPOSED",
    execution: authorization.proposal_execution.status === "CONSUMED_SIMULATION_ONLY"
      ? "SIMULATION_EXECUTED"
      : "NOT_EXECUTED",
    verification: "PENDING_SEPARATE_VERIFIER",
    human_acceptance: "NOT_REQUESTED",
  };
}
