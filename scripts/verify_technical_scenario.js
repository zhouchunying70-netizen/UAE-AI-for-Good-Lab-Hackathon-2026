import path from "node:path";
import { readFile } from "node:fs/promises";
import { readJson, writeJson } from "../src/lib/io.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const EVIDENCE = process.env.SCENARIO_EVIDENCE_DIR
  ? path.resolve(process.env.SCENARIO_EVIDENCE_DIR)
  : path.resolve(ROOT, "evidence/scenario-test");
const runPath = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(EVIDENCE, "technical-run/run.json");
const auditPath = path.resolve(path.dirname(runPath), "audit.jsonl");
const outputPath = path.resolve(EVIDENCE, "technical-scenario-verifier.json");
const run = await readJson(runPath);
const audit = (await readFile(auditPath, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const stages = new Map(run.stages.map((stage) => [stage.stage_id, stage]));
const t2Decision = stages.get("T2")?.agents.authorization_audit.unsafe_decisions.find((decision) => decision.request_id === "ATT-T2-CLAIM-SERVICE");
const t3Decision = stages.get("T3")?.agents.authorization_audit.unsafe_decisions.find((decision) => decision.request_id === "ATT-T3-REOPEN-CAPACITY");
const expected = {
  scenario_status: "TECHNICAL_TEST_SCENARIO",
  owner_approval: "NOT_GRANTED",
  stage_ids: ["T1", "T2", "T3"],
  t2_decision: "BLOCKED_FAIL_CLOSED",
  t3_decision: "BLOCKED_FAIL_CLOSED",
  t3_rejected_claim: "EVT-T3-DEMAND-002",
  provider_calls: 0,
  real_world_actions: 0,
};
const actual = {
  scenario_status: run.scenario_status,
  owner_approval: run.owner_approval,
  stage_ids: run.stages.map((stage) => stage.stage_id),
  t2_decision: t2Decision?.status ?? null,
  t3_decision: t3Decision?.status ?? null,
  t3_rejected_claim: run.final_state.rejected_external_claim_ids.find((eventId) => eventId === "EVT-T3-DEMAND-002") ?? null,
  provider_calls: run.provider_calls,
  real_world_actions: run.real_world_actions,
  audit_record_count: audit.length,
  policy_citation_counts: run.stages.map((stage) => stage.agents.policy_adviser.citations.length),
};
const assertions = [
  { id: "technical-scenario-label", pass: actual.scenario_status === expected.scenario_status && actual.owner_approval === expected.owner_approval, expected: { scenario_status: expected.scenario_status, owner_approval: expected.owner_approval }, actual: { scenario_status: actual.scenario_status, owner_approval: actual.owner_approval } },
  { id: "three-stage-release", pass: JSON.stringify(actual.stage_ids) === JSON.stringify(expected.stage_ids), expected: expected.stage_ids, actual: actual.stage_ids },
  { id: "t2-fail-closed", pass: actual.t2_decision === expected.t2_decision, expected: expected.t2_decision, actual: actual.t2_decision },
  { id: "t3-fail-closed", pass: actual.t3_decision === expected.t3_decision, expected: expected.t3_decision, actual: actual.t3_decision },
  { id: "unknown-claim-rejected", pass: actual.t3_rejected_claim === expected.t3_rejected_claim, expected: expected.t3_rejected_claim, actual: actual.t3_rejected_claim },
  { id: "synthetic-only", pass: actual.provider_calls === expected.provider_calls && actual.real_world_actions === expected.real_world_actions, expected: { provider_calls: expected.provider_calls, real_world_actions: expected.real_world_actions }, actual: { provider_calls: actual.provider_calls, real_world_actions: actual.real_world_actions } },
  { id: "policy-citations-present", pass: actual.policy_citation_counts.every((count) => count > 0), expected: "all stages cited", actual: actual.policy_citation_counts },
  { id: "audit-records-present", pass: actual.audit_record_count > 0, expected: true, actual: actual.audit_record_count },
];
const result = {
  schema_version: "1.0",
  verification_type: "LOCAL_TECHNICAL_SCENARIO_ASSERTION_CHECK",
  generated_at: new Date().toISOString(),
  expected,
  actual,
  assertions,
  status: assertions.every((assertion) => assertion.pass) ? "PASS" : "FAIL",
  limitation: "This verifier checks the technical fixture and generated artifacts locally. It is not Owner approval, institutional validation or third-party certification.",
};
await writeJson(outputPath, result);
console.log(JSON.stringify(result, null, 2));
if (result.status !== "PASS") process.exitCode = 1;
