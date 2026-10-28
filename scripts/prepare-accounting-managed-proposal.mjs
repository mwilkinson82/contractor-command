// Produces unregistered review artifacts only. Never writes a migration directory,
// connects to a database, allocates managed history, or changes remote state.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const folder = "docs/athena/managed-accounting-proposal";
const sha = (body) => createHash("sha256").update(body).digest("hex");
const sources = JSON.parse(readFileSync("docs/athena/accounting-integration-sources.json", "utf8"));
const entries = sources.ordered_source_drafts;
for (const entry of entries) assert.equal(sha(readFileSync(entry.path)), entry.sha256, entry.path);
const header =
  "-- UNREGISTERED LOCAL PROPOSAL. Requires explicit release approval and supported Lovable verification.\n";
const specs = entries.slice(0, 5).map((entry, i) => ({
  key: ["purchase_orders", "ap", "ap_references", "receipts", "ap_snapshot"][i],
  file: `0${i + 1}-${["purchase-orders", "ap", "ap-references", "receipts", "ap-snapshot"][i]}.proposed.sql`,
  source: entry.path,
  source_sha256: entry.sha256,
  execution: "transactional",
  body:
    header +
    "SET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '60s';\n" +
    readFileSync(entry.path, "utf8"),
}));
const billing = entries[5];
const billingSql = readFileSync(billing.path, "utf8");
const indexLines = billingSql.split("\n").filter((line) => line.startsWith("CREATE INDEX "));
assert.equal(indexLines.length, 3);
for (const [i, line] of indexLines.entries())
  specs.push({
    key: ["billing_allocation_index", "billing_reversal_index", "billing_document_index"][i],
    file: `06${["a", "b", "c"][i]}-billing-index.proposed.sql`,
    source: billing.path,
    source_sha256: billing.sha256,
    execution: "nontransactional_single_statement",
    body: header + line.replace("CREATE INDEX ", "CREATE INDEX CONCURRENTLY ") + "\n",
  });
specs.push({
  key: "billing_snapshot",
  file: "07-billing-snapshot.proposed.sql",
  source: billing.path,
  source_sha256: billing.sha256,
  execution: "transactional",
  body:
    header +
    "SET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '60s';\n" +
    billingSql
      .split("\n")
      .filter((line) => !line.startsWith("CREATE INDEX "))
      .join("\n"),
});
const manifest = {
  status: "unregistered_local_proposal_not_authorized_for_application",
  baseline_repository_tag: sources.managed_artifact_last_tag,
  baseline_live_state:
    "unverified; actual next managed identities must be allocated through supported Lovable lane",
  prerequisites: sources.prerequisite_artifacts,
  index_runner_contract:
    "Each concurrent index is a single command outside a transaction. Set 5s lock and 60s statement timeouts separately on the disposable/approved runner session; inspect validity after any uncertain result. No fallback to blocking builds is approved.",
  function_runner_contract:
    "Each transactional proposal requires one transaction supplied by the runner; SQL has no outer BEGIN/COMMIT. Do not strip/rewrite source without rehash/review.",
  steps: specs.map((spec, i) => ({
    order: i + 1,
    key: spec.key,
    path: join(folder, spec.file),
    sha256: sha(spec.body),
    source: spec.source,
    source_sha256: spec.source_sha256,
    execution: spec.execution,
    managed_identity: null,
    depends_on: i === 0 ? ["verified_prerequisites"] : [specs[i - 1].key],
  })),
};
const outputs = [
  ...specs.map((spec) => [join(folder, spec.file), spec.body]),
  [join(folder, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n"],
];
mkdirSync(folder, { recursive: true });
for (const [path, body] of outputs) {
  if (existsSync(path))
    assert.equal(
      readFileSync(path, "utf8"),
      body,
      `Frozen proposal differs: ${path}; review and deliberately replace it before regenerating`,
    );
  else writeFileSync(path, body);
}
console.log(
  "Nine ordered proposal artifacts/hash manifest prepared and verified; no migration registered or database contacted.",
);
