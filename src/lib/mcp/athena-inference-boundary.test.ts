import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import ts from "typescript";
import { ESLint } from "eslint";

const hubPaths = [
  "src/routes/api/ask.ts",
  "src/routes/api/contract-scan.ts",
  "src/routes/api/owner-plays.ts",
  "src/routes/api/sop-backlog.ts",
  "src/routes/api/sop-draft.ts",
  "src/lib/scheduler/intel-build-draft.functions.ts",
];
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(`${dir}/${e.name}`)
      : /\.(ts|tsx|js)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)
        ? [`${dir}/${e.name}`]
        : [],
  );
}
describe("Athena-only inference boundary", () => {
  it("has no direct key, SDK inference or gateway access in Athena, including transitive source imports", () => {
    const seen = new Set<string>();
    function visit(file: string) {
      if (seen.has(file)) return;
      seen.add(file);
      expect(file).not.toBe(resolve("src/lib/ai-gateway.ts"));
      const source = readFileSync(file, "utf8");
      for (const imported of ts.preProcessFile(source, true, true).importedFiles) {
        const name = imported.fileName;
        if (!name.startsWith(".") && !name.startsWith("@/")) continue;
        const base = name.startsWith("@/")
          ? resolve("src", name.slice(2))
          : resolve(dirname(file), name);
        const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`].find(
          (p) => /\.(ts|tsx|js)$/.test(p) && existsSync(p),
        );
        if (target) visit(target);
      }
    }
    for (const file of files("src/lib/mcp")) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(
        /LOVABLE_API_KEY|ai-gateway|from ["'](?:ai|@ai-sdk\/)/,
      );
      visit(resolve(file));
    }
  });
  it("rejects adding the shared gateway to an Athena module", async () => {
    const result = await new ESLint().lintText(
      'import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";',
      { filePath: "src/lib/mcp/inference-probe.ts" },
    );
    expect(result[0].messages.some((m) => m.ruleId === "no-restricted-imports")).toBe(true);
  });
  it.each(hubPaths)("keeps the Hub gateway path allowed: %s", async (path) => {
    const source = readFileSync(path, "utf8");
    expect(source).toContain('from "@/lib/ai-gateway"');
    expect(source).toContain("process.env.LOVABLE_API_KEY");
    const result = await new ESLint().lintText(source, { filePath: path });
    expect(result[0].messages.filter((m) => m.ruleId === "no-restricted-imports")).toEqual([]);
  });
});
