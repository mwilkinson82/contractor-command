import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const spec = JSON.parse(readFileSync("supabase/storage/athena-documents.json", "utf8"));
const migration = readFileSync("supabase/migrations/20261031120000_athena_file_upload.sql", "utf8");

describe("athena-documents bucket is created outside the migration", () => {
  it("keeps the file-upload migration free of storage.buckets writes", () => {
    expect(migration).not.toMatch(/(INSERT\s+INTO|UPDATE)\s+storage\.buckets/i);
  });

  it("keeps the bucket spec private, 100 MB, no bucket MIME list (the app checks types)", () => {
    expect(spec).toEqual({
      id: "athena-documents",
      name: "athena-documents",
      public: false,
      file_size_limit: 104857600,
      allowed_mime_types: null,
    });
  });
});
