#!/usr/bin/env node
import path from "node:path";
import { calculateMetrics } from "./lib/metrics.js";
import { METADATA_ONLY_PUBLIC_BUNDLE, STRICT_LOCAL_SNAPSHOTS } from "./lib/knowledge-base.js";
import { runFixture } from "./lib/orchestrator.js";
import { verifyRun } from "./lib/verifier.js";
import { answerPolicyQuestion } from "./lib/policy-adviser.js";
import { writeJson } from "./lib/io.js";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]?.replace(/^--/, "");
    options[key] = rest[index + 1];
  }
  return { command, options };
}

function required(options, key) {
  if (!options[key]) throw new Error(`Missing --${key}`);
  return path.resolve(options[key]);
}

function sourceVerificationMode(options) {
  const value = options["source-verification"] ?? "strict";
  if (value === "strict") return STRICT_LOCAL_SNAPSHOTS;
  if (value === "metadata-only") return METADATA_ONLY_PUBLIC_BUNDLE;
  throw new Error("--source-verification must be strict or metadata-only");
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const sourcesPath = path.resolve("knowledge-base/sources.json");
  const claimsPath = path.resolve("knowledge-base/claims.json");

  if (command === "run") {
    const result = await runFixture({
      fixturePath: required(options, "fixture"),
      outputDir: required(options, "out"),
      sourcesPath,
      claimsPath,
      sourceVerificationMode: sourceVerificationMode(options),
    });
    console.log(JSON.stringify({ status: "RUN_COMPLETE", run_id: result.run.run_id, manifest: result.manifest }, null, 2));
    return;
  }

  if (command === "verify") {
    const receipt = await verifyRun({
      runDir: required(options, "run"),
      oraclePath: required(options, "oracle"),
      outputPath: required(options, "out"),
      sourcesPath,
      claimsPath,
      fixturePath: required(options, "fixture"),
      sourceVerificationMode: sourceVerificationMode(options),
    });
    console.log(JSON.stringify(receipt.summary, null, 2));
    process.exitCode = receipt.status === "PASS" ? 0 : 1;
    return;
  }

  if (command === "metrics") {
    const result = await calculateMetrics({
      runDir: required(options, "run"),
      receiptPath: required(options, "receipt"),
      opportunitiesPath: required(options, "opportunities"),
      outputPath: required(options, "out"),
    });
    console.log(JSON.stringify(result.metrics, null, 2));
    return;
  }

  if (command === "advise") {
    const question = options.question;
    if (!question) throw new Error("Missing --question");
    const kb = await (await import("./lib/knowledge-base.js")).loadKnowledgeBase(
      sourcesPath,
      claimsPath,
      { sourceVerificationMode: sourceVerificationMode(options) },
    );
    const answer = answerPolicyQuestion({ question, kb });
    if (options.out) await writeJson(path.resolve(options.out), answer);
    console.log(JSON.stringify(answer, null, 2));
    return;
  }

  throw new Error("Usage: node src/cli.js <run|verify|metrics|advise> [options]");
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});

