import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { readJson } from "./io.js";
import { sha256File, sha256Object } from "./hash.js";

const ADMITTED = "ADMITTED_FOR_SCOPED_CLAIMS";
export const STRICT_LOCAL_SNAPSHOTS = "STRICT_LOCAL_SNAPSHOTS";
export const METADATA_ONLY_PUBLIC_BUNDLE = "METADATA_ONLY_PUBLIC_BUNDLE";

export async function loadKnowledgeBase(
  sourcesPath,
  claimsPath,
  { sourceVerificationMode = STRICT_LOCAL_SNAPSHOTS } = {},
) {
  const sourceRegister = await readJson(sourcesPath);
  const claimRegister = await readJson(claimsPath);
  const sources = new Map(sourceRegister.sources.map((source) => [source.id, source]));
  const errors = [];

  if (![STRICT_LOCAL_SNAPSHOTS, METADATA_ONLY_PUBLIC_BUNDLE].includes(sourceVerificationMode)) {
    errors.push(`Unsupported source verification mode ${sourceVerificationMode}`);
  }
  errors.push(...validateSourceMetadata(sourceRegister));
  if (sourceVerificationMode === STRICT_LOCAL_SNAPSHOTS) {
    errors.push(...await validateSourceSnapshots(sourceRegister, sourcesPath));
  }

  const claimIds = new Set();
  for (const claim of claimRegister.claims) {
    if (claimIds.has(claim.id)) errors.push(`duplicate claim id ${claim.id}`);
    claimIds.add(claim.id);
    const source = sources.get(claim.source_id);
    if (!source) {
      errors.push(`${claim.id} references missing source ${claim.source_id}`);
    } else if (source.admission !== ADMITTED) {
      errors.push(`${claim.id} references non-admitted source ${claim.source_id}`);
    }
    if (claim.status !== "ADMITTED") errors.push(`${claim.id} has unsupported status ${claim.status}`);
    if (!claim.locator || !claim.paraphrase || !claim.applicability) {
      errors.push(`${claim.id} is missing locator, paraphrase or applicability`);
    }
  }

  if (errors.length) {
    throw new Error(`Knowledge base admission failed: ${errors.join("; ")}`);
  }

  return {
    sourceRegister,
    claimRegister,
    sources,
    digest: sha256Object({ sourceRegister, claimRegister }),
    verification: {
      mode: sourceVerificationMode,
      status: sourceVerificationMode === STRICT_LOCAL_SNAPSHOTS
        ? "RAW_SOURCE_BYTES_VERIFIED"
        : "RAW_SOURCE_VERIFICATION_NOT_PERFORMED_IN_PUBLIC_BUNDLE",
      raw_source_bytes_verified: sourceVerificationMode === STRICT_LOCAL_SNAPSHOTS,
      source_metadata_records_checked: sourceRegister.sources.length,
      admitted_source_records: sourceRegister.sources.filter((source) => source.admission === ADMITTED).length,
    },
  };
}

export function retrieveClaims(kb, tags) {
  const tagSet = new Set(tags);
  return kb.claimRegister.claims
    .filter((claim) => claim.status === "ADMITTED")
    .filter((claim) => claim.tags.some((tag) => tagSet.has(tag)))
    .map((claim) => {
      const source = kb.sources.get(claim.source_id);
      return {
        claim_id: claim.id,
        source_id: claim.source_id,
        source_title: source.title,
        official_url: source.official_url,
        actual_sha256: source.actual_sha256,
        source_verification_status: kb.verification.status,
        locator: claim.locator,
        paraphrase: claim.paraphrase,
        applicability: claim.applicability,
      };
    });
}

export function isAdmittedSource(kb, sourceId) {
  return kb.sources.get(sourceId)?.admission === ADMITTED;
}

export function validateSourceMetadata(sourceRegister) {
  const errors = [];
  const sourceIds = new Set();
  for (const source of sourceRegister.sources) {
    if (sourceIds.has(source.id)) errors.push(`duplicate source id ${source.id}`);
    sourceIds.add(source.id);
    if (!source.issuer || !source.title || !source.scope || !source.retrieved_at) {
      errors.push(`${source.id} is missing issuer, title, scope or retrieved_at`);
    }
    if (!source.official_url?.startsWith("https://")) errors.push(`${source.id} has invalid official_url`);
    if (!/^[a-f0-9]{64}$/.test(source.actual_sha256)) errors.push(`${source.id} has invalid actual_sha256`);
    if (!Number.isInteger(source.byte_size) || source.byte_size <= 0) errors.push(`${source.id} has invalid byte_size`);
    if (!source.content_type) errors.push(`${source.id} has no content_type`);
    if (!source.snapshot_status) errors.push(`${source.id} has no snapshot_status`);
    if (!source.license || !source.redistribution) errors.push(`${source.id} has no license or redistribution disposition`);
    if (!Array.isArray(source.supported_claims) || !Array.isArray(source.unresolved)) {
      errors.push(`${source.id} must list supported_claims and unresolved items`);
    }
  }
  return errors;
}

export async function validateSourceSnapshots(sourceRegister, sourcesPath) {
  const errors = [];
  const projectRoot = path.resolve(path.dirname(sourcesPath), "..");

  for (const source of sourceRegister.sources) {
    const validSnapshot = source.snapshot_status !== "UNAVAILABLE";
    if (!validSnapshot) {
      if (source.admission === ADMITTED) errors.push(`${source.id} cannot be admitted without a valid local snapshot`);
      continue;
    }
    if (!source.local_snapshot) {
      errors.push(`${source.id} has no local_snapshot`);
      continue;
    }
    const snapshotPath = path.resolve(projectRoot, source.local_snapshot);
    const relative = path.relative(projectRoot, snapshotPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      errors.push(`${source.id} snapshot escapes project root`);
      continue;
    }
    try {
      const [actualHash, metadata, bytes] = await Promise.all([
        sha256File(snapshotPath),
        stat(snapshotPath),
        readFile(snapshotPath),
      ]);
      if (actualHash !== source.actual_sha256) errors.push(`${source.id} snapshot hash mismatch`);
      if (source.byte_size !== undefined && metadata.size !== source.byte_size) errors.push(`${source.id} byte_size mismatch`);
      const detectedType = detectContentType(bytes, snapshotPath);
      if (source.content_type && detectedType !== source.content_type) errors.push(`${source.id} content_type mismatch`);
    } catch (error) {
      errors.push(`${source.id} snapshot unavailable: ${error.code ?? error.message}`);
    }
  }
  return errors;
}

function detectContentType(bytes, filePath) {
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  const prefix = bytes.subarray(0, 4096).toString("utf8").toLowerCase();
  if (prefix.includes("<!doctype html") || prefix.includes("<html")) return "text/html";
  if (path.extname(filePath) === ".json") return "application/json";
  return "application/octet-stream";
}

