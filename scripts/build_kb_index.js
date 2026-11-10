import path from "node:path";
import { readJson, writeJson } from "../src/lib/io.js";

const root = path.resolve(import.meta.dirname, "..");
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(root, "knowledge-base/retrieval-index.json");
const sources = await readJson(path.join(root, "knowledge-base/sources.json"));
const claims = await readJson(path.join(root, "knowledge-base/claims.json"));
const tags = {};
for (const claim of claims.claims) {
  for (const tag of claim.tags) {
    tags[tag] ??= [];
    tags[tag].push({ claim_id: claim.id, source_id: claim.source_id });
  }
}
for (const values of Object.values(tags)) values.sort((left, right) => left.claim_id.localeCompare(right.claim_id));
await writeJson(output, {
  schema_version: "1.0",
  generated_at: new Date().toISOString(),
  retrieval_mode: "EXACT_METADATA_TAG_OVERLAP",
  vectorization: "NOT_IMPLEMENTED",
  semantic_ranking: "NOT_IMPLEMENTED",
  source_byte_verification: "METADATA_ONLY_PUBLIC_BUNDLE",
  source_records: sources.sources.map((source) => ({
    id: source.id,
    title: source.title,
    issuer: source.issuer,
    official_url: source.official_url,
    version_or_page_updated: source.version ?? source.page_updated ?? null,
    retrieved_at: source.retrieved_at,
    actual_sha256: source.actual_sha256,
    scope: source.scope,
    admission: source.admission,
    redistribution: source.redistribution,
  })),
  tag_index: tags,
  counts: {
    source_records: sources.sources.length,
    admitted_claims: claims.claims.filter((claim) => claim.status === "ADMITTED").length,
    supporting_uae_sources: new Set(claims.claims.filter((claim) => claim.status === "ADMITTED" && claim.source_id.startsWith("SRC-UAE-")).map((claim) => claim.source_id)).size,
  },
});
console.log(`WROTE ${output}`);
