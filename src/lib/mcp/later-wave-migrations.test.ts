import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrations = [
  [
    48,
    "0048_schedule_control_privacy",
    "5666d6a39c5e20ef0d72c45b4d626470481cdbab9dbeadbdbb44bf62e7fe5c3e",
  ],
  [
    49,
    "0049_supplier_buyout_workflows",
    "b9a807be600664d62ab9d58ea36b30f82fc5d91c7469f066bcaa4615ce8e1468",
  ],
  [
    50,
    "0050_daily_capture_create_only",
    "f3efa079d3f65c66089b70dedcecd14cfa4f2c7c0da419b96a37ad3092e4a033",
  ],
  [
    51,
    "0051_post_lock_access_recheck",
    "8f0490f4a1204b26eb21278fe3d5971ad87985c34cd8334acabafca9054a3dfb",
  ],
] as const;

describe("later-wave migration registration", () => {
  it("follows the accounting closure migrations in dependency order with exact reviewed SQL", () => {
    const journal = JSON.parse(readFileSync("drizzle/migrations/meta/_journal.json", "utf8"));
    expect(journal.entries.find((e: { idx: number }) => e.idx === 47).tag).toBe(
      "0047_release_completion_runner_checkpoint",
    );
    for (const [idx, tag, hash] of migrations) {
      expect(journal.entries[idx]).toMatchObject({ idx, tag, version: "7" });
      expect(journal.entries[idx].when).toBeGreaterThan(journal.entries[idx - 1].when);
      expect(
        createHash("sha256")
          .update(readFileSync("drizzle/migrations/" + tag + ".sql"))
          .digest("hex"),
      ).toBe(hash);
    }
  });

  it("retains the custom snapshot chain without changing inherited schema metadata", () => {
    let previous = JSON.parse(readFileSync("drizzle/migrations/meta/0047_snapshot.json", "utf8"));
    for (const [idx] of migrations) {
      const current = JSON.parse(
        readFileSync(
          "drizzle/migrations/meta/" + String(idx).padStart(4, "0") + "_snapshot.json",
          "utf8",
        ),
      );
      expect(current.prevId).toBe(previous.id);
      expect(current.id).not.toBe(previous.id);
      const { id: _currentId, prevId: _currentPrevious, ...currentSchema } = current;
      const { id: _previousId, prevId: _previousPrevious, ...previousSchema } = previous;
      expect(currentSchema).toEqual(previousSchema);
      previous = current;
    }
  });
});
