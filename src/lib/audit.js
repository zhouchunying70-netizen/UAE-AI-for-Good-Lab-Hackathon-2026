import { canonicalJson } from "./canonical.js";
import { sha256Object } from "./hash.js";

export class AuditChain {
  constructor(runId) {
    this.runId = runId;
    this.records = [];
  }

  append(type, stageId, actor, payload) {
    const record = {
      record_id: `AUD-${String(this.records.length + 1).padStart(4, "0")}`,
      run_id: this.runId,
      stage_id: stageId,
      type,
      actor,
      previous_hash: this.records.at(-1)?.record_hash ?? "GENESIS",
      payload: structuredClone(payload),
    };
    record.record_hash = sha256Object(record);
    this.records.push(record);
    return record;
  }

  toJsonl() {
    return `${this.records.map((record) => canonicalJson(record)).join("\n")}\n`;
  }
}

export function verifyAuditRecords(records) {
  const failures = [];
  let previousHash = "GENESIS";
  const seenRecordIds = new Set();

  for (const [index, record] of records.entries()) {
    const expectedRecordId = `AUD-${String(index + 1).padStart(4, "0")}`;
    if (record.record_id !== expectedRecordId) {
      failures.push(`record ${index + 1} record_id sequence mismatch`);
    }
    if (seenRecordIds.has(record.record_id)) {
      failures.push(`record ${index + 1} duplicate record_id`);
    }
    seenRecordIds.add(record.record_id);
    if (record.previous_hash !== previousHash) {
      failures.push(`record ${index + 1} previous_hash mismatch`);
    }
    const { record_hash: actualHash, ...unsigned } = record;
    const expectedHash = sha256Object(unsigned);
    if (actualHash !== expectedHash) {
      failures.push(`record ${index + 1} record_hash mismatch`);
    }
    previousHash = actualHash;
  }

  return {
    valid: failures.length === 0,
    failures,
    head: records.at(-1)?.record_hash ?? "GENESIS",
  };
}

