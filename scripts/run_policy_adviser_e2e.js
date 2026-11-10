import path from "node:path";
import { loadKnowledgeBase } from "../src/lib/knowledge-base.js";
import { answerPolicyQuestion } from "../src/lib/policy-adviser.js";
import { writeJson, writeText } from "../src/lib/io.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const EVIDENCE = process.env.EVIDENCE_DIR
  ? path.resolve(process.env.EVIDENCE_DIR)
  : path.resolve(ROOT, "evidence/agent/policy-adviser");
const question = "What privacy, oversight and resilience controls should a synthetic public-service continuity prototype use during an extreme-heat event, and does the admitted UAE source set establish authority to reopen the service after power returns?";

const kb = await loadKnowledgeBase(
  path.join(ROOT, "knowledge-base/sources.json"),
  path.join(ROOT, "knowledge-base/claims.json"),
  { sourceVerificationMode: "METADATA_ONLY_PUBLIC_BUNDLE" },
);
const actual = answerPolicyQuestion({ question, kb, questionId: "POLICY-QUERY-RESCUE-001" });
const expected = {
  retrieval_mode: "DETERMINISTIC_EXACT_METADATA_TAG_OVERLAP",
  citation_count_positive: true,
  legal_conclusion: false,
  human_review_status: "REQUIRED_NOT_PERFORMED",
  decision_status: "ADVISORY_ONLY",
  source_verification_status: "RAW_SOURCE_VERIFICATION_NOT_PERFORMED_IN_PUBLIC_BUNDLE",
};
const assertions = [
  { id: "retrieval-mode", pass: actual.execution_mode === expected.retrieval_mode, expected: expected.retrieval_mode, actual: actual.execution_mode },
  { id: "citations-present", pass: actual.retrieval.citation_count > 0, expected: expected.citation_count_positive, actual: actual.retrieval.citation_count },
  { id: "no-legal-conclusion", pass: actual.output.legal_conclusion === expected.legal_conclusion, expected: expected.legal_conclusion, actual: actual.output.legal_conclusion },
  { id: "human-review-required", pass: actual.output.human_review_status === expected.human_review_status, expected: expected.human_review_status, actual: actual.output.human_review_status },
  { id: "advisory-only", pass: actual.output.decision_status === expected.decision_status, expected: expected.decision_status, actual: actual.output.decision_status },
  { id: "metadata-only-boundary", pass: actual.retrieval.source_verification_status === expected.source_verification_status, expected: expected.source_verification_status, actual: actual.retrieval.source_verification_status },
  { id: "sector-authority-gap-recorded", pass: actual.output.policy_gaps.some((gap) => gap.includes("operating mandate")), expected: true, actual: actual.output.policy_gaps },
];
const result = {
  schema_version: "1.0",
  execution_type: "LOCAL_POLICY_ADVISER_END_TO_END",
  generated_at: new Date().toISOString(),
  input: { question },
  expected,
  actual,
  assertions,
  status: assertions.every((assertion) => assertion.pass) ? "PASS" : "FAIL",
  limitation: "This is a deterministic local function over metadata-only claims; it is not a generative model, legal opinion or third-party certification.",
};
await writeJson(path.join(EVIDENCE, "policy-adviser-e2e.json"), result);
await writeJson(path.join(EVIDENCE, "policy-adviser-input.json"), result.input);
await writeJson(path.join(EVIDENCE, "policy-adviser-output.json"), actual);
const auditRecord = {
  event_id: "AGENT-QUERY-RESCUE-001",
  timestamp: result.generated_at,
  scenario_stage: "POLICY_QUERY",
  input_reference: "AGENT_EXECUTION_EVIDENCE/policy-adviser-input.json",
  retrieved_source_ids: actual.retrieval.citations.map((citation) => citation.source_id),
  policy_reference: actual.retrieval.citations.map((citation) => ({ claim_id: citation.claim_id, locator: citation.locator })),
  agent_output: actual.output,
  decision_status: actual.output.decision_status,
  human_review_status: actual.output.human_review_status,
};
await writeText(path.join(EVIDENCE, "policy-adviser-audit.jsonl"), `${JSON.stringify(auditRecord)}\n`);
console.log(JSON.stringify(result, null, 2));
