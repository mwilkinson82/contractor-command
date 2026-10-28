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
const proposal = JSON.parse(
  readFileSync("docs/athena/managed-accounting-proposal/manifest.json", "utf8"),
);
for (const entry of proposal.steps) {
  assert.equal(
    createHash("sha256").update(readFileSync(entry.path)).digest("hex"),
    entry.sha256,
    entry.path,
  );
  assert.equal(
    createHash("sha256").update(readFileSync(entry.source)).digest("hex"),
    entry.source_sha256,
    entry.source,
  );
}
assert.equal(manifest.managed_artifact_last_tag, "0034_athena_financial_documents");
console.log(
  "Accounting release sources and nine proposed SQL hashes match; this does not verify live migration state.",
);
