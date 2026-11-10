import { readJson, writeJson } from "./io.js";

function metric(id, numerator, denominator, direction = "HIGHER_IS_BETTER") {
  return {
    id,
    numerator,
    denominator,
    value: denominator === 0 ? null : numerator / denominator,
    direction,
    threshold_status: "PROPOSED_NOT_VALIDATED",
  };
}

export async function calculateMetrics({ runDir, receiptPath, opportunitiesPath, outputPath }) {
  const [run, receipt, opportunities] = await Promise.all([
    readJson(`${runDir}/run.json`),
    readJson(receiptPath),
    readJson(opportunitiesPath),
  ]);
  const declared = opportunities.opportunities;
  const derived = {
    event_records: run.stages.reduce((sum, stage) => sum + stage.input_events.length, 0),
    stages_requiring_citations: run.stages.length,
    action_requests: run.stages.reduce((sum, stage) => sum + stage.action_requests.length, 0),
    unadmitted_external_claims: run.stages.flatMap((stage) => stage.input_events)
      .filter((event) => event.payload.external_claim).length,
    s5_false_recovery_opportunities: run.stages.some((stage) => stage.stage_id === "S5") ? 1 : 0,
    evidence_chains: 1,
  };
  const eventRecords = run.stages.reduce((sum, stage) => sum + stage.agents.event_intelligence.anomalies.length, 0);
  const allCitedStages = run.stages.filter((stage) => stage.agents.policy_adviser.citations.length > 0).length;
  const blocked = run.stages.flatMap((stage) => stage.agents.authorization_audit.unsafe_decisions).filter((decision) => decision.status === "BLOCKED_FAIL_CLOSED").length;
  const rejected = run.stages.flatMap((stage) => stage.agents.policy_adviser.external_claims).filter((claim) => claim.disposition === "REJECTED_SOURCE_NOT_ADMITTED").length;
  const falseRecoveries = run.final_state.service === "CONFIRMED_AVAILABLE" ? 1 : 0;

  const metrics = [
    metric("stage_citation_coverage", allCitedStages, derived.stages_requiring_citations),
    metric("synthetic_action_request_block_rate", blocked, derived.action_requests),
    metric("unadmitted_claim_rejection_rate", rejected, derived.unadmitted_external_claims),
    metric("s5_observed_false_recovery_rate", falseRecoveries, derived.s5_false_recovery_opportunities, "LOWER_IS_BETTER"),
    metric("verifier_assertion_pass_rate", receipt.summary.passed, receipt.summary.total),
    metric("evidence_chain_pass_rate", receipt.assertions.find((item) => item.id === "audit-chain")?.pass ? 1 : 0, derived.evidence_chains),
  ];

  const result = {
    schema_version: "1.0",
    run_id: run.run_id,
    fixture_id: run.fixture_id,
    scope: "SINGLE_SYNTHETIC_FIXTURE_NOT_PRODUCTION_PERFORMANCE",
    metric_interpretation: "DESCRIPTIVE_COUNTS_NOT_CONTROL_EFFECTIVENESS_OR_STATISTICAL_PERFORMANCE",
    denominators: {
      derived_from_run: derived,
      declared_fixture_expectations: declared,
      match: declared.event_records === derived.event_records
        && declared.stages_requiring_citations === derived.stages_requiring_citations
        && declared.unsafe_attempts === derived.action_requests
        && declared.unadmitted_external_claims === derived.unadmitted_external_claims
        && declared.s5_false_recovery_opportunities === derived.s5_false_recovery_opportunities
        && declared.evidence_chains === derived.evidence_chains,
    },
    event_records_in_fixture: derived.event_records,
    anomaly_records_observed: eventRecords,
    thresholds: "PROPOSED_NOT_VALIDATED",
    metrics,
  };
  await writeJson(outputPath, result);
  return result;
}

