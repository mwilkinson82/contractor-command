import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const root = process.env.ATHENA_AP_CONTRACT_DIR;
if (!root) throw new Error("Set ATHENA_AP_CONTRACT_DIR to a disposable local test directory.");
const revision = "1318fa2a94d7710d8d521093269f099e4e76893a";
const files = [
  [
    "job-cost-submission.schema-draft.sql",
    "submissions.sql",
    "ba37b300a41e8e4f44e0a16c672faa1875389bb6cd4d91659ca9c43070f876ea",
  ],
  [
    "ap-reconciliation-snapshot.schema-draft.sql",
    "snapshot.sql",
    "a25517349efbc2f301341af41e54adcc4ee71fd7df061a20e6c1e9b50dc76f33",
  ],
];
await mkdir(root, { recursive: true });
await Promise.all(
  files.map(async ([source, target, expected]) => {
    const response = await fetch(
      `https://raw.githubusercontent.com/mwilkinson82/contractor-command/${revision}/docs/athena/${source}`,
      { signal: AbortSignal.timeout(30000) },
    );
    if (!response.ok) throw new Error(`Pinned producer fetch failed: ${response.status}`);
    const body = await response.text();
    if (createHash("sha256").update(body).digest("hex") !== expected)
      throw new Error("Pinned AP contract hash mismatch.");
    await writeFile(join(root, target), body);
  }),
);
console.log(`Pinned AP producer ${revision} fetched and verified for synthetic tests only.`);
