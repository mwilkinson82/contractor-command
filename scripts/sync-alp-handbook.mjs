import { access, copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const sourceFlagIndex = process.argv.indexOf("--source");
const sourceRoot = path.resolve(
  repositoryRoot,
  sourceFlagIndex >= 0 && process.argv[sourceFlagIndex + 1]
    ? process.argv[sourceFlagIndex + 1]
    : "../alp-hand-book",
);

const sourceContentDirectory = path.join(sourceRoot, "src/components/handbook/content");
const targetContentDirectory = path.join(repositoryRoot, "src/components/handbook/content");
const syncedAssets = ["professional-contractor-control-loop.png"];
const excludedContentFiles = new Set(["PlaceholderChapter.tsx"]);

await access(path.join(sourceRoot, "package.json"));
await access(sourceContentDirectory);
await mkdir(targetContentDirectory, { recursive: true });

const sourceContentFiles = (await readdir(sourceContentDirectory)).filter(
  (file) => file.endsWith(".tsx") && !excludedContentFiles.has(file),
);
for (const file of sourceContentFiles) {
  await copyFile(path.join(sourceContentDirectory, file), path.join(targetContentDirectory, file));
}

for (const asset of syncedAssets) {
  const sourceAsset = path.join(sourceRoot, "src/assets", asset);
  const targetAsset = path.join(repositoryRoot, "src/assets", asset);
  await access(sourceAsset);
  await copyFile(sourceAsset, targetAsset);
}

console.log(
  `Synced ${sourceContentFiles.length} handbook content files and ${syncedAssets.length} shared asset from ${sourceRoot}.`,
);
