import { retrieveClaims } from "./knowledge-base.js";

const TAG_RULES = [
  { tags: ["privacy", "data_governance", "synthetic_data"], terms: ["privacy", "personal data", "data protection", "confidentiality"] },
  { tags: ["resilience", "crisis", "public_service", "proactive"], terms: ["resilience", "crisis", "continuity", "public service", "heat", "cooling"] },
  { tags: ["responsible_ai", "transparency", "human_oversight", "accountability"], terms: ["oversight", "accountability", "transparent", "responsible ai", "human review", "human acceptance"] },
  { tags: ["risk_management", "ai_strategy"], terms: ["risk", "ai adoption", "deployment", "operating model"] },
  { tags: ["coordination", "institutional_responsibility"], terms: ["responsibility", "authority", "coordination", "mandate", "who can"] },
  { tags: ["cybersecurity", "evidence"], terms: ["cyber", "incident", "evidence", "audit", "reporting"] },
];

function normalizedQuestion(question) {
  return question.trim().replace(/\s+/g, " ");
}

export function inferPolicyTags(question) {
  const normalized = normalizedQuestion(question).toLowerCase();
  const tags = new Set();
  for (const rule of TAG_RULES) {
    if (rule.terms.some((term) => normalized.includes(term))) {
      for (const tag of rule.tags) tags.add(tag);
    }
  }
  return [...tags].sort();
}

function hasSectorMandateQuestion(question) {
  const normalized = question.toLowerCase();
  return ["mandate", "legally require", "must reopen", "authorized to reopen", "legal authority"].some((term) => normalized.includes(term));
}

export function answerPolicyQuestion({ question, kb, questionId = "POLICY-QUERY-001" }) {
  const normalized = normalizedQuestion(question);
  const matchedTags = inferPolicyTags(normalized);
  const citations = retrieveClaims(kb, matchedTags);
  const directMandateQuestion = hasSectorMandateQuestion(normalized);
  const sourceStatus = kb.verification.status;
  const gaps = [
    "The admitted source set is limited and does not constitute a complete UAE legal or operational corpus.",
    "Metadata-only mode does not reverify excluded source bytes at runtime.",
  ];
  if (directMandateQuestion || /cooling|heat|reopen|service availability/i.test(normalized)) {
    gaps.push("No admitted source establishes a heat/public-cooling operating mandate or authority to reopen a real service.");
  }

  const answer = citations.length
    ? "The admitted records provide scoped governance guidance that supports evidence preservation, privacy, human oversight, accountability and resilience controls. They do not establish legal authority for this synthetic coordinator or authorize a real service action."
    : "No admitted claim matched the question. The system cannot provide a sourced policy explanation from the current register and must escalate for human review.";

  return {
    schema_version: "1.0",
    question_id: questionId,
    agent: "Policy Adviser Agent",
    implementation_status: "IMPLEMENTED_AND_VERIFIED_IN_LOCAL_DETERMINISTIC_RUN",
    execution_mode: "DETERMINISTIC_EXACT_METADATA_TAG_OVERLAP",
    input: { question: normalized },
    retrieval: {
      matched_tags: matchedTags,
      citation_count: citations.length,
      citations,
      source_verification_status: sourceStatus,
    },
    output: {
      answer,
      policy_gaps: gaps,
      evidence_sufficiency: citations.length ? "SUFFICIENT_FOR_SCOPED_GUIDANCE_ONLY" : "INSUFFICIENT_ESCALATE",
      legal_conclusion: false,
      real_world_authority: false,
      human_review_status: "REQUIRED_NOT_PERFORMED",
      decision_status: citations.length ? "ADVISORY_ONLY" : "ESCALATE_EVIDENCE_INSUFFICIENT",
    },
    boundaries: [
      "This is not legal advice.",
      "This role does not claim UAE institutional authority.",
      "No hidden chain-of-thought is emitted; only cited claims, scoped reasons and explicit gaps are recorded.",
    ],
  };
}
