import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const manifest = JSON.parse(
  readFileSync("docs/athena/accounting-integration-sources.json", "utf8"),
);
for (const entry of [...manifest.prerequisite_artifacts, ...manifest.ordered_source_drafts]) {
  const hash = createHash("sha256").update(readFileSync(entry.path)).digest("hex");
  assert.equal(hash, entry.sha256, `Release source changed: ${entry.path}`);
}
assert.equal(manifest.managed_artifact_last_tag, "0034_athena_financial_documents");
console.log("Accounting release source hashes match; this does not verify live migration state.");
