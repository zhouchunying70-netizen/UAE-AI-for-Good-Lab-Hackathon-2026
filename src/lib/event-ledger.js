import { sha256Object } from "./hash.js";
import { domainPayloadError } from "./state.js";

export class EventLedger {
  constructor(domainSequences) {
    this.domains = new Map(
      Object.entries(domainSequences).map(([domain, start]) => [
        domain,
        { next: start, pending: new Map(), applied: new Map(), seen: new Map() },
      ]),
    );
    this.arrivalIndex = 0;
    this.seenEventIds = new Map();
  }

  ingest(event) {
    this.arrivalIndex += 1;
    const shapeError = validateEventShape(event);
    if (shapeError) {
      return { status: "REJECTED_INVALID_EVENT", reason: shapeError, applied: [], event };
    }
    const domain = this.domains.get(event.domain);
    if (!domain) {
      return { status: "REJECTED_UNKNOWN_DOMAIN", applied: [], event };
    }
    const payloadDomainError = domainPayloadError(event);
    if (payloadDomainError) {
      return { status: "REJECTED_DOMAIN_PAYLOAD_MISMATCH", reason: payloadDomainError, applied: [], event };
    }

    const digest = sha256Object(event);
    if (this.seenEventIds.has(event.event_id)) {
      return { status: "DUPLICATE_EVENT_ID_GLOBAL", applied: [], event };
    }
    const existingAtSequence = domain.seen.get(`${event.domain}:${event.sequence}`);
    if (existingAtSequence) {
      return {
        status: existingAtSequence === digest ? "DUPLICATE_SEQUENCE_FACT" : "CONFLICTING_SEQUENCE",
        applied: [],
        event,
      };
    }

    const lateArrival = [...domain.pending.keys()].some((sequence) => sequence > event.sequence);
    this.seenEventIds.set(event.event_id, digest);
    domain.seen.set(`${event.domain}:${event.sequence}`, digest);

    if (event.sequence < domain.next) {
      return { status: "STALE_SEQUENCE", applied: [], event, late_arrival: true };
    }

    domain.pending.set(event.sequence, { ...event, arrival_index: this.arrivalIndex, late_arrival: lateArrival });
    const gapDetected = event.sequence > domain.next;
    const applied = [];

    while (domain.pending.has(domain.next)) {
      const nextEvent = domain.pending.get(domain.next);
      domain.pending.delete(domain.next);
      domain.applied.set(domain.next, nextEvent);
      applied.push(nextEvent);
      domain.next += 1;
    }

    return {
      status: gapDetected ? "PENDING_GAP" : "ACCEPTED",
      applied,
      event,
      late_arrival: lateArrival,
      active_gap: domain.pending.size > 0,
      next_expected: domain.next,
    };
  }

  activeGap(domainName) {
    return (this.domains.get(domainName)?.pending.size ?? 0) > 0;
  }
}

function validateEventShape(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return "EVENT_NOT_OBJECT";
  if (typeof event.event_id !== "string" || !/^EVT-[A-Z0-9-]+$/.test(event.event_id)) return "INVALID_EVENT_ID";
  if (typeof event.domain !== "string" || event.domain.length === 0) return "INVALID_DOMAIN";
  if (!Number.isInteger(event.sequence) || event.sequence < 1) return "INVALID_SEQUENCE";
  if (typeof event.source !== "string" || !event.source.startsWith("SYNTHETIC_")) return "NON_SYNTHETIC_SOURCE";
  if (typeof event.observed_at !== "string" || Number.isNaN(Date.parse(event.observed_at))) return "INVALID_OBSERVED_AT";
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return "INVALID_PAYLOAD";
  return null;
}

