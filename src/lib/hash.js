import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { canonicalJson } from "./canonical.js";

export function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Object(value) {
  return sha256Text(canonicalJson(value));
}

export async function sha256File(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

