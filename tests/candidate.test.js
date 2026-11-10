import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  evaluateActionRequest,
  RECOVERY_FRESHNESS_MAX_AGE_SECONDS,
  SimulationAuthorizationController,
} from "../src/lib/authorization.js";
import { canonicalJson } from "../src/lib/canonical.js";
import { EventLedger } from "../src/lib/event-ledger.js";
import { sha256File, sha256Object } from "../src/lib/hash.js";
import { readJson, writeJson } from "../src/lib/io.js";
import {
  loadKnowledgeBase,
  METADATA_ONLY_PUBLIC_BUNDLE,
  STRICT_LOCAL_SNAPSHOTS,
} from "../src/lib/knowledge-base.js";
import { calculateMetrics } from "../src/lib/metrics.js";
import { runFixture } from "../src/lib/orchestrator.js";
import { answerPolicyQuestion } from "../src/lib/policy-adviser.js";
import { applyEvent, initialState } from "../src/lib/state.js";
import { verifyRun } from "../src/lib/verifier.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const fixturePath = path.join(ROOT, "fixtures/s1-s5.json");
const oraclePath = path.join(ROOT, "verifier/oracles/s1-s5.oracle.json");
const sourcesPath = path.join(ROOT, "knowledge-base/sources.json");
const claimsPath = path.join(ROOT, "knowledge-base/claims.json");
const sourceVerificationMode = process.env.UAE_KB_VERIFICATION_MODE ?? STRICT_LOCAL_SNAPSHOTS;

async function tempDir(name) {
  return mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function buildAndVerify(name) {
  const outputDir = await tempDir(name);
  await runFixture({ fixturePath, outputDir, sourcesPath, claimsPath, sourceVerificationMode });
  const receiptPath = path.join(outputDir, "receipt.json");
  const receipt = await verifyRun({
    runDir: outputDir,
    oraclePath,
    outputPath: receiptPath,
    sourcesPath,
    claimsPath,
    fixturePath,
    sourceVerificationMode,
  });
  return { outputDir, receipt };
}

test("reference S1-S5 run passes all verifier assertions", async () => {
  const { outputDir, receipt } = await buildAndVerify("uae-pass");
  assert.equal(receipt.status, "PASS");
  assert.equal(receipt.summary.failed, 0);

  const run = await readJson(path.join(outputDir, "run.json"));
  assert.equal(run.final_state.power, "CONFIRMED_ON");
  assert.equal(run.final_state.service, "UNCONFIRMED");
  assert.equal(run.final_state.capacity, "UNKNOWN");
  assert.deepEqual(run.final_state.late_event_ids, ["EVT-S3-ROUTE-011"]);
  assert.deepEqual(run.final_state.rejected_external_claim_ids, ["EVT-S4-DEMAND-001"]);
});

test("policy adviser returns scoped citations and an explicit authority gap", async () => {
  const kb = await loadKnowledgeBase(sourcesPath, claimsPath, { sourceVerificationMode });
  const answer = answerPolicyQuestion({
    question: "What privacy, oversight and resilience controls apply to a synthetic public-service continuity prototype, and does the source set authorize reopening?",
    kb,
  });
  assert.equal(answer.execution_mode, "DETERMINISTIC_EXACT_METADATA_TAG_OVERLAP");
  assert.ok(answer.retrieval.citation_count > 0);
  assert.equal(answer.output.legal_conclusion, false);
  assert.equal(answer.output.human_review_status, "REQUIRED_NOT_PERFORMED");
  assert.ok(answer.output.policy_gaps.some((gap) => gap.includes("operating mandate")));
});

test("two runs are byte-for-byte deterministic", async () => {
  const first = await tempDir("uae-deterministic-a");
  const second = await tempDir("uae-deterministic-b");
  await runFixture({ fixturePath, outputDir: first, sourcesPath, claimsPath, sourceVerificationMode });
  await runFixture({ fixturePath, outputDir: second, sourcesPath, claimsPath, sourceVerificationMode });

  assert.equal(await sha256File(path.join(first, "run.json")), await sha256File(path.join(second, "run.json")));
  assert.equal(await sha256File(path.join(first, "audit.jsonl")), await sha256File(path.join(second, "audit.jsonl")));
});

test("audit payload tampering is detected even if the file manifest is recomputed", async () => {
  const outputDir = await tempDir("uae-audit-tamper");
  await runFixture({ fixturePath, outputDir, sourcesPath, claimsPath, sourceVerificationMode });

  const auditPath = path.join(outputDir, "audit.jsonl");
  const records = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  records[0].payload.name = "TAMPERED";
  await writeFile(auditPath, `${records.map(canonicalJson).join("\n")}\n`, "utf8");

  const manifestPath = path.join(outputDir, "manifest.json");
  const manifest = await readJson(manifestPath);
  manifest.files["audit.jsonl"] = await sha256File(auditPath);
  await writeJson(manifestPath, manifest);

  const receipt = await verifyRun({
    runDir: outputDir,
    oraclePath,
    outputPath: path.join(outputDir, "tamper-receipt.json"),
    sourcesPath,
    claimsPath,
    fixturePath,
    sourceVerificationMode,
  });
  assert.equal(receipt.status, "FAIL");
  assert.equal(receipt.assertions.find((item) => item.id === "audit-chain").pass, false);
});

test("false S5 recovery fails semantic verification after manifest recomputation", async () => {
  const outputDir = await tempDir("uae-false-recovery");
  await runFixture({ fixturePath, outputDir, sourcesPath, claimsPath, sourceVerificationMode });

  const runPath = path.join(outputDir, "run.json");
  const run = await readJson(runPath);
  run.stages.find((stage) => stage.stage_id === "S5").state.service = "CONFIRMED_AVAILABLE";
  run.final_state.service = "CONFIRMED_AVAILABLE";
  run.forbidden_outcomes.push("SERVICE_RECOVERED");
  await writeJson(runPath, run);

  const manifestPath = path.join(outputDir, "manifest.json");
  const manifest = await readJson(manifestPath);
  manifest.files["run.json"] = await sha256File(runPath);
  await writeJson(manifestPath, manifest);

  const receipt = await verifyRun({
    runDir: outputDir,
    oraclePath,
    outputPath: path.join(outputDir, "false-recovery-receipt.json"),
    sourcesPath,
    claimsPath,
    fixturePath,
    sourceVerificationMode,
  });
  assert.equal(receipt.status, "FAIL");
  assert.equal(receipt.assertions.find((item) => item.id === "state-S5").pass, false);
  assert.equal(receipt.assertions.find((item) => item.id === "forbidden-outcomes").pass, false);
});

test("oracle expectations do not appear in execution artifacts", async () => {
  const outputDir = await tempDir("uae-oracle-separation");
  await runFixture({ fixturePath, outputDir, sourcesPath, claimsPath, sourceVerificationMode });
  const runText = await readFile(path.join(outputDir, "run.json"), "utf8");
  const auditText = await readFile(path.join(outputDir, "audit.jsonl"), "utf8");
  assert.equal(runText.includes("expected_stages"), false);
  assert.equal(auditText.includes("expected_stages"), false);
  assert.equal(runText.includes("oracle_path"), false);
});

test("completed stage Agent facts cannot be mutated by later stages", async () => {
  const { outputDir } = await buildAndVerify("uae-state-isolation");
  const run = await readJson(path.join(outputDir, "run.json"));
  const s2 = run.stages.find((stage) => stage.stage_id === "S2");
  assert.deepEqual(s2.agents.event_intelligence.current_facts, s2.state);
  assert.equal(s2.state.route, "OPEN");
  assert.equal(s2.state.route_gap, false);
});

test("source integrity metadata or byte mismatch prevents knowledge-base admission", async () => {
  const root = await tempDir("uae-source-integrity");
  const kbDir = path.join(root, "knowledge-base");
  const snapshotDir = path.join(root, "evidence/source-snapshots");
  await mkdir(kbDir, { recursive: true });
  await mkdir(snapshotDir, { recursive: true });
  const sources = await readJson(sourcesPath);
  sources.sources[0].actual_sha256 = sourceVerificationMode === METADATA_ONLY_PUBLIC_BUNDLE
    ? "invalid"
    : "0".repeat(64);
  const tempSources = path.join(kbDir, "sources.json");
  const tempClaims = path.join(kbDir, "claims.json");
  await writeJson(tempSources, sources);
  await copyFile(claimsPath, tempClaims);
  if (sourceVerificationMode === STRICT_LOCAL_SNAPSHOTS) {
    for (const source of sources.sources) {
      await copyFile(path.join(ROOT, source.local_snapshot), path.join(root, source.local_snapshot));
    }
  }
  await assert.rejects(
    () => loadKnowledgeBase(tempSources, tempClaims, { sourceVerificationMode }),
    sourceVerificationMode === STRICT_LOCAL_SNAPSHOTS ? /snapshot hash mismatch/ : /invalid actual_sha256/,
  );
});

test("service availability without confirmed power and facility is rejected", () => {
  const state = initialState();
  assert.throws(() => applyEvent(state, {
    event_id: "EVT-TEST-001",
    domain: "service",
    payload: { service: "CONFIRMED_AVAILABLE" },
  }, { isAdmittedSource: () => true }), /without confirmed power and facility/);
});

test("event domains reject payload fields owned by another domain", () => {
  const ledger = new EventLedger({ weather: 1 });
  const event = {
    event_id: "EVT-DOMAIN-001",
    domain: "weather",
    sequence: 1,
    source: "SYNTHETIC_TEST_FEED",
    observed_at: "2026-07-15T00:00:00Z",
    payload: { power: "INTERRUPTED" },
  };
  assert.equal(ledger.ingest(event).status, "REJECTED_DOMAIN_PAYLOAD_MISMATCH");
  assert.throws(
    () => applyEvent(initialState(), event, { isAdmittedSource: () => true }),
    /DOMAIN_PAYLOAD_MISMATCH/,
  );
  assert.equal(ledger.ingest({
    ...event,
    event_id: "EVT-DOMAIN-002",
    domain: "service",
    payload: { route: "OPEN" },
  }).status, "REJECTED_UNKNOWN_DOMAIN");
  const serviceLedger = new EventLedger({ service: 1, facility: 1 });
  assert.equal(serviceLedger.ingest({
    ...event,
    event_id: "EVT-DOMAIN-003",
    domain: "service",
    payload: { route: "OPEN" },
  }).status, "REJECTED_DOMAIN_PAYLOAD_MISMATCH");
  assert.equal(serviceLedger.ingest({
    ...event,
    event_id: "EVT-DOMAIN-004",
    domain: "facility",
    payload: { service: "UNAVAILABLE" },
  }).status, "REJECTED_DOMAIN_PAYLOAD_MISMATCH");
  assert.throws(
    () => applyEvent(initialState(), {
      ...event,
      event_id: "EVT-DOMAIN-005",
      domain: "unknown-domain",
      payload: {},
    }, { isAdmittedSource: () => true }),
    /UNKNOWN_EVENT_DOMAIN/,
  );
});

test("event identity is globally unique across domains", () => {
  const ledger = new EventLedger({ weather: 1, service: 1 });
  const base = {
    event_id: "EVT-GLOBAL-001",
    sequence: 1,
    source: "SYNTHETIC_TEST_FEED",
    observed_at: "2026-07-15T00:00:00Z",
    payload: {},
  };
  assert.equal(ledger.ingest({ ...base, domain: "weather" }).status, "ACCEPTED");
  assert.equal(ledger.ingest({ ...base, domain: "service" }).status, "DUPLICATE_EVENT_ID_GLOBAL");
});

test("fencing token rejects replay, expiry and revocation", () => {
  const state = initialState();
  const controller = new SimulationAuthorizationController("run-token-test", 10);
  const issued = controller.issue({
    stageId: "S1",
    action: "PUBLISH_SYNTHETIC_HEAT_ADVISORY",
    issuedAt: "2026-07-15T00:00:00Z",
    state,
    citations: [{ claim_id: "C1" }],
  });
  assert.equal(controller.consume(issued.fencing_token, {
    stageId: "S1",
    action: "PUBLISH_SYNTHETIC_HEAT_ADVISORY",
    at: "2026-07-15T00:00:01Z",
  }).status, "CONSUMED_SIMULATION_ONLY");
  assert.equal(controller.consume(issued.fencing_token, {
    stageId: "S1",
    action: "PUBLISH_SYNTHETIC_HEAT_ADVISORY",
    at: "2026-07-15T00:00:02Z",
  }).status, "REJECTED_TOKEN_REPLAY");

  const expired = controller.issue({
    stageId: "S2",
    action: "HOLD_SERVICE_AVAILABILITY_CLAIM",
    issuedAt: "2026-07-15T00:00:00Z",
    state,
    citations: [{ claim_id: "C1" }],
  });
  assert.equal(controller.consume(expired.fencing_token, {
    stageId: "S2",
    action: "HOLD_SERVICE_AVAILABILITY_CLAIM",
    at: "2026-07-15T00:00:11Z",
  }).status, "REJECTED_EXPIRED_TOKEN");

  const revoked = controller.issue({
    stageId: "S3",
    action: "UPDATE_SIMULATED_ROUTE_STATUS",
    issuedAt: "2026-07-15T00:00:00Z",
    state,
    citations: [{ claim_id: "C1" }],
  });
  controller.revoke(revoked.fencing_token.token_id);
  assert.equal(controller.consume(revoked.fencing_token, {
    stageId: "S3",
    action: "UPDATE_SIMULATED_ROUTE_STATUS",
    at: "2026-07-15T00:00:01Z",
  }).status, "REJECTED_REVOKED_TOKEN");
});

test("verifier refuses to overwrite its Oracle", async () => {
  const outputDir = await tempDir("uae-oracle-protect");
  await runFixture({ fixturePath, outputDir, sourcesPath, claimsPath, sourceVerificationMode });
  await assert.rejects(() => verifyRun({
    runDir: outputDir,
    oraclePath,
    outputPath: oraclePath,
    sourcesPath,
    claimsPath,
    fixturePath,
    sourceVerificationMode,
  }), /cannot overwrite protected input/);
});

test("verifier rejects a symlink alias that targets its Oracle", async () => {
  const outputDir = await tempDir("uae-oracle-symlink-protect");
  await runFixture({ fixturePath, outputDir, sourcesPath, claimsPath, sourceVerificationMode });
  const oracleCopy = path.join(outputDir, "oracle-copy.json");
  const receiptAlias = path.join(outputDir, "receipt-alias.json");
  await copyFile(oraclePath, oracleCopy);
  await symlink(oracleCopy, receiptAlias);
  await assert.rejects(() => verifyRun({
    runDir: outputDir,
    oraclePath: oracleCopy,
    outputPath: receiptAlias,
    sourcesPath,
    claimsPath,
    fixturePath,
    sourceVerificationMode,
  }), /cannot overwrite protected input/);
});

test("Agent-state tampering fails three-way consistency verification", async () => {
  const outputDir = await tempDir("uae-agent-state-tamper");
  await runFixture({ fixturePath, outputDir, sourcesPath, claimsPath, sourceVerificationMode });
  const runPath = path.join(outputDir, "run.json");
  const run = await readJson(runPath);
  run.stages.find((stage) => stage.stage_id === "S2").agents.event_intelligence.current_facts.route = "UNKNOWN";
  await writeJson(runPath, run);
  const manifestPath = path.join(outputDir, "manifest.json");
  const manifest = await readJson(manifestPath);
  manifest.files["run.json"] = await sha256File(runPath);
  await writeJson(manifestPath, manifest);
  const receipt = await verifyRun({
    runDir: outputDir,
    oraclePath,
    outputPath: path.join(outputDir, "receipt.json"),
    sourcesPath,
    claimsPath,
    fixturePath,
    sourceVerificationMode,
  });
  assert.equal(receipt.assertions.find((item) => item.id === "stage-agent-audit-output-consistency").pass, false);
});

test("Policy, Coordinator and token tampering fails semantic verification", async () => {
  const outputDir = await tempDir("uae-agent-output-tamper");
  await runFixture({ fixturePath, outputDir, sourcesPath, claimsPath, sourceVerificationMode });
  const runPath = path.join(outputDir, "run.json");
  const run = await readJson(runPath);
  const s1 = run.stages.find((stage) => stage.stage_id === "S1");
  s1.agents.policy_adviser.citations[0].paraphrase = "TAMPERED POLICY CLAIM";
  s1.agents.coordinator.proposal = "TAMPERED_PROPOSAL";
  s1.agents.authorization_audit.proposal_decision.fencing_token.run_id = "tampered-run";
  await writeJson(runPath, run);
  const manifestPath = path.join(outputDir, "manifest.json");
  const manifest = await readJson(manifestPath);
  manifest.files["run.json"] = await sha256File(runPath);
  await writeJson(manifestPath, manifest);
  const receipt = await verifyRun({
    runDir: outputDir,
    oraclePath,
    outputPath: path.join(outputDir, "receipt.json"),
    sourcesPath,
    claimsPath,
    fixturePath,
    sourceVerificationMode,
  });
  assert.equal(receipt.status, "FAIL");
  assert.equal(receipt.assertions.find((item) => item.id === "stage-agent-audit-output-consistency").pass, false);
  assert.equal(receipt.assertions.find((item) => item.id === "policy-agent-semantics").pass, false);
  assert.equal(receipt.assertions.find((item) => item.id === "coordinator-agent-semantics").pass, false);
  assert.equal(receipt.assertions.find((item) => item.id === "fencing-token-consumption").pass, false);
});

test("coordinated anomaly and fake-decision tampering fails independent semantics", async () => {
  const outputDir = await tempDir("uae-coordinated-output-tamper");
  await runFixture({ fixturePath, outputDir, sourcesPath, claimsPath, sourceVerificationMode });
  const runPath = path.join(outputDir, "run.json");
  const auditPath = path.join(outputDir, "audit.jsonl");
  const manifestPath = path.join(outputDir, "manifest.json");
  const run = await readJson(runPath);
  const records = (await readFile(auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));

  const s3 = run.stages.find((stage) => stage.stage_id === "S3");
  s3.agents.event_intelligence.anomalies = [];
  records.find((record) => record.stage_id === "S3"
    && record.type === "AGENT_OUTPUT"
    && record.actor === "Event Intelligence Agent").payload = structuredClone(s3.agents.event_intelligence);

  const s2 = run.stages.find((stage) => stage.stage_id === "S2");
  const fakeDecision = {
    ...structuredClone(s2.agents.authorization_audit.unsafe_decisions[0]),
    request_id: "ATT-FAKE-AUTHORIZATION",
  };
  s2.agents.authorization_audit.unsafe_decisions.push(fakeDecision);
  records.find((record) => record.stage_id === "S2"
    && record.type === "AUTHORIZATION_DECISION"
    && record.actor === "Authorization and Audit Agent").payload = structuredClone(s2.agents.authorization_audit);

  let previousHash = "GENESIS";
  for (const record of records) {
    record.previous_hash = previousHash;
    delete record.record_hash;
    record.record_hash = sha256Object(record);
    previousHash = record.record_hash;
  }
  await writeJson(runPath, run);
  await writeFile(auditPath, `${records.map(canonicalJson).join("\n")}\n`, "utf8");
  const manifest = await readJson(manifestPath);
  manifest.files["run.json"] = await sha256File(runPath);
  manifest.files["audit.jsonl"] = await sha256File(auditPath);
  manifest.audit_chain_head = records.at(-1).record_hash;
  await writeJson(manifestPath, manifest);

  const receipt = await verifyRun({
    runDir: outputDir,
    oraclePath,
    outputPath: path.join(outputDir, "receipt.json"),
    sourcesPath,
    claimsPath,
    fixturePath,
    sourceVerificationMode,
  });
  assert.equal(receipt.status, "FAIL");
  assert.equal(receipt.assertions.find((item) => item.id === "audit-chain").pass, true);
  assert.equal(receipt.assertions.find((item) => item.id === "stage-agent-audit-output-consistency").pass, true);
  assert.equal(receipt.assertions.find((item) => item.id === "event-agent-semantics").pass, false);
  assert.equal(receipt.assertions.find((item) => item.id === "action-decision-set").pass, false);
});

test("verifier rejects decision multiplicity, cross-stage relocation and undeclared audit records", async () => {
  async function rewriteBundle(outputDir, run, records) {
    const runPath = path.join(outputDir, "run.json");
    const auditPath = path.join(outputDir, "audit.jsonl");
    const manifestPath = path.join(outputDir, "manifest.json");
    let previousHash = "GENESIS";
    for (const [index, record] of records.entries()) {
      record.record_id = `AUD-${String(index + 1).padStart(4, "0")}`;
      record.previous_hash = previousHash;
      delete record.record_hash;
      record.record_hash = sha256Object(record);
      previousHash = record.record_hash;
    }
    await writeJson(runPath, run);
    await writeFile(auditPath, `${records.map(canonicalJson).join("\n")}\n`, "utf8");
    const manifest = await readJson(manifestPath);
    manifest.files["run.json"] = await sha256File(runPath);
    manifest.files["audit.jsonl"] = await sha256File(auditPath);
    manifest.audit_chain_head = records.at(-1).record_hash;
    manifest.audit_record_count = records.length;
    await writeJson(manifestPath, manifest);
  }

  async function verifyTampered(outputDir, name) {
    return verifyRun({
      runDir: outputDir,
      oraclePath,
      outputPath: path.join(outputDir, `${name}-receipt.json`),
      sourcesPath,
      claimsPath,
      fixturePath,
      sourceVerificationMode,
    });
  }

  const duplicateDir = await tempDir("uae-duplicate-decision");
  await runFixture({ fixturePath, outputDir: duplicateDir, sourcesPath, claimsPath, sourceVerificationMode });
  const duplicateRun = await readJson(path.join(duplicateDir, "run.json"));
  const duplicateRecords = (await readFile(path.join(duplicateDir, "audit.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const duplicateStage = duplicateRun.stages.find((stage) => stage.stage_id === "S2");
  duplicateStage.agents.authorization_audit.unsafe_decisions.push(
    structuredClone(duplicateStage.agents.authorization_audit.unsafe_decisions[0]),
  );
  duplicateRecords.find((record) => record.stage_id === "S2"
    && record.type === "AUTHORIZATION_DECISION").payload = structuredClone(duplicateStage.agents.authorization_audit);
  await rewriteBundle(duplicateDir, duplicateRun, duplicateRecords);
  const duplicateReceipt = await verifyTampered(duplicateDir, "duplicate");
  assert.equal(duplicateReceipt.assertions.find((item) => item.id === "audit-chain").pass, true);
  assert.equal(duplicateReceipt.assertions.find((item) => item.id === "action-decision-set").pass, false);

  const movedDir = await tempDir("uae-moved-decision");
  await runFixture({ fixturePath, outputDir: movedDir, sourcesPath, claimsPath, sourceVerificationMode });
  const movedRun = await readJson(path.join(movedDir, "run.json"));
  const movedRecords = (await readFile(path.join(movedDir, "audit.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const movedS2 = movedRun.stages.find((stage) => stage.stage_id === "S2");
  const movedS3 = movedRun.stages.find((stage) => stage.stage_id === "S3");
  movedS3.agents.authorization_audit.unsafe_decisions.push(movedS2.agents.authorization_audit.unsafe_decisions.shift());
  for (const stage of [movedS2, movedS3]) {
    movedRecords.find((record) => record.stage_id === stage.stage_id
      && record.type === "AUTHORIZATION_DECISION").payload = structuredClone(stage.agents.authorization_audit);
  }
  movedRecords.find((record) => record.type === "ACTION_REQUEST_DECISION"
    && record.payload.decision.request_id === "ATT-S2-CLAIM-SERVICE").stage_id = "S3";
  await rewriteBundle(movedDir, movedRun, movedRecords);
  const movedReceipt = await verifyTampered(movedDir, "moved");
  assert.equal(movedReceipt.assertions.find((item) => item.id === "audit-chain").pass, true);
  assert.equal(movedReceipt.assertions.find((item) => item.id === "action-decision-set").pass, false);

  const duplicateAuditDir = await tempDir("uae-duplicate-agent-audit");
  await runFixture({ fixturePath, outputDir: duplicateAuditDir, sourcesPath, claimsPath, sourceVerificationMode });
  const duplicateAuditRun = await readJson(path.join(duplicateAuditDir, "run.json"));
  const duplicateAuditRecords = (await readFile(path.join(duplicateAuditDir, "audit.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const extraAgentRecord = structuredClone(duplicateAuditRecords.find((record) => record.stage_id === "S1"
    && record.type === "AGENT_OUTPUT"
    && record.actor === "Event Intelligence Agent"));
  extraAgentRecord.payload.current_facts.route = "CLOSED";
  duplicateAuditRecords.push(extraAgentRecord);
  await rewriteBundle(duplicateAuditDir, duplicateAuditRun, duplicateAuditRecords);
  const duplicateAuditReceipt = await verifyTampered(duplicateAuditDir, "duplicate-audit");
  assert.equal(duplicateAuditReceipt.assertions.find((item) => item.id === "audit-chain").pass, true);
  assert.equal(duplicateAuditReceipt.assertions.find((item) => item.id === "stage-agent-audit-output-consistency").pass, false);

  const undeclaredAuditDir = await tempDir("uae-undeclared-agent-audit");
  await runFixture({ fixturePath, outputDir: undeclaredAuditDir, sourcesPath, claimsPath, sourceVerificationMode });
  const undeclaredAuditRun = await readJson(path.join(undeclaredAuditDir, "run.json"));
  const undeclaredAuditRecords = (await readFile(path.join(undeclaredAuditDir, "audit.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  undeclaredAuditRecords.push({
    record_id: "PENDING_REHASH",
    run_id: undeclaredAuditRun.run_id,
    stage_id: "S1",
    type: "AGENT_OUTPUT",
    actor: "Authorization and Audit Agent",
    previous_hash: "PENDING_REHASH",
    payload: { status: "AUTHORIZED_REAL_WORLD_ACTION" },
  });
  await rewriteBundle(undeclaredAuditDir, undeclaredAuditRun, undeclaredAuditRecords);
  const undeclaredAuditReceipt = await verifyTampered(undeclaredAuditDir, "undeclared-audit");
  assert.equal(undeclaredAuditReceipt.assertions.find((item) => item.id === "audit-chain").pass, true);
  assert.equal(undeclaredAuditReceipt.assertions.find((item) => item.id === "stage-agent-audit-output-consistency").pass, false);
});

test("recovery authorization rejects otherwise confirmed but stale evidence", () => {
  const state = initialState();
  state.power = "CONFIRMED_ON";
  state.facility = "CONFIRMED_OPEN";
  state.service = "CONFIRMED_AVAILABLE";
  state.capacity = "CONFIRMED_SUFFICIENT";
  state.demand = "BASELINE";
  state.human_acceptance = "RECORDED";
  for (const field of ["facility", "service", "capacity", "demand", "human_acceptance"]) {
    state.evidence_observed_at[field] = "2026-07-15T09:00:00Z";
  }
  const decision = evaluateActionRequest({
    attempt_id: "ATT-STALE-RECOVERY",
    action: "REOPEN_SERVICE",
    requester: "SYNTHETIC_SERVICE_OPERATOR",
    requested_at: "2026-07-15T09:10:00Z",
  }, state);
  assert.equal(decision.status, "BLOCKED_FAIL_CLOSED");
  assert.equal(decision.freshness_evaluation.max_age_seconds, RECOVERY_FRESHNESS_MAX_AGE_SECONDS);
  assert.equal(decision.freshness_evaluation.threshold_status, "PROPOSED_NOT_VALIDATED");
  assert.deepEqual(
    decision.freshness_evaluation.checks.filter((check) => !check.fresh).map((check) => check.field),
    ["facility", "service", "capacity", "demand", "human_acceptance"],
  );
});

test("metrics derive denominators and flag a mismatched declaration", async () => {
  const { outputDir } = await buildAndVerify("uae-metric-denominators");
  const opportunities = await readJson(path.join(ROOT, "fixtures/opportunities.json"));
  opportunities.opportunities.unsafe_attempts = 999;
  const declaredPath = path.join(outputDir, "opportunities.json");
  await writeJson(declaredPath, opportunities);
  const result = await calculateMetrics({
    runDir: outputDir,
    receiptPath: path.join(outputDir, "receipt.json"),
    opportunitiesPath: declaredPath,
    outputPath: path.join(outputDir, "metrics.json"),
  });
  assert.equal(result.denominators.derived_from_run.action_requests, 4);
  assert.equal(result.denominators.match, false);
});

