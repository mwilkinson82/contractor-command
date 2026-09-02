import { describe, expect, it } from "vitest";
import { upsertResendCapture } from "@/lib/resend/capture";
import { allowedCorsOrigin } from "@/lib/resend/cors";
import { shouldSkipResendCapture } from "@/lib/resend/never-email";
import { RESEND_SEGMENT_IDS } from "@/lib/resend/segments";

describe("never-email / never-import", () => {
  it("skips the locked never-email addresses", () => {
    expect(shouldSkipResendCapture({ email: "bryan@bettencourtconstruction.com" })).toBe(true);
    expect(shouldSkipResendCapture({ email: "NAV@fiveriversig.com" })).toBe(true);
    expect(shouldSkipResendCapture({ email: "roberto@vegadevelopment.net" })).toBe(true);
  });

  it("skips Pro-Build / ProBuild / Pro Build in email, name, or company", () => {
    expect(shouldSkipResendCapture({ email: "lead@pro-build.com" })).toBe(true);
    expect(shouldSkipResendCapture({ email: "lead@probuild.io" })).toBe(true);
    expect(shouldSkipResendCapture({ email: "owner@example.com", company: "Pro Build" })).toBe(true);
    expect(
      shouldSkipResendCapture({ email: "owner@example.com", firstName: "Pat", lastName: "ProBuild" }),
    ).toBe(true);
  });

  it("does not skip other *Builders* companies", () => {
    expect(shouldSkipResendCapture({ email: "sam@abcbuilders.com", company: "ABC Builders" })).toBe(false);
    expect(shouldSkipResendCapture({ email: "pat@example.com", company: "Pro Builders" })).toBe(false);
    expect(shouldSkipResendCapture({ email: "miragliotta310@gmail.com" })).toBe(false);
  });
});

describe("marketing CORS origins", () => {
  it("allows the Vale / ALP marketing hosts and localhost preview", () => {
    expect(allowedCorsOrigin("https://marshallwilkinson.com")).toBe("https://marshallwilkinson.com");
    expect(allowedCorsOrigin("https://www.alpcontractorcircle.com")).toBe(
      "https://www.alpcontractorcircle.com",
    );
    expect(allowedCorsOrigin("https://app.alpcontractorcircle.com")).toBe(
      "https://app.alpcontractorcircle.com",
    );
    expect(allowedCorsOrigin("https://alphandbook.com")).toBe("https://alphandbook.com");
    expect(allowedCorsOrigin("https://alpsalestraining.com")).toBe("https://alpsalestraining.com");
    expect(allowedCorsOrigin("https://www.alpoverwatch.com")).toBe("https://www.alpoverwatch.com");
    expect(allowedCorsOrigin("http://localhost:5173")).toBe("http://localhost:5173");
  });

  it("rejects lookalike hosts", () => {
    expect(allowedCorsOrigin("https://evilmarshallwilkinson.com")).toBeNull();
    expect(allowedCorsOrigin("https://example.com")).toBeNull();
  });
});

describe("upsertResendCapture", () => {
  it("returns ok without calling Resend for never-email addresses", async () => {
    const calls: string[] = [];
    const result = await upsertResendCapture(
      { email: "bryan@bettencourtconstruction.com", segment: "field_notes", source: "test" },
      {
        apiKey: "re_test",
        fetch: async (url) => {
          calls.push(String(url));
          return new Response("{}", { status: 500 });
        },
      },
    );
    expect(result).toEqual({
      ok: true,
      skipped: true,
      contactId: null,
      segment: "field_notes",
    });
    expect(calls).toHaveLength(0);
  });

  it("creates a contact and adds the Field Notes segment by default", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const result = await upsertResendCapture(
      {
        email: "new.lead@example.com",
        source: "https://marshallwilkinson.com/field-notes",
        source_url: "https://marshallwilkinson.com/field-notes",
        magnet: "field-notes",
        firstName: "Pat",
      },
      {
        apiKey: "re_test",
        fetch: async (url, init) => {
          const parsed = init?.body ? JSON.parse(String(init.body)) : null;
          calls.push({ url: String(url), method: init?.method ?? "GET", body: parsed });
          return new Response(JSON.stringify({ id: "contact_123" }), { status: 200 });
        },
      },
    );

    expect(result).toEqual({ ok: true, contactId: "contact_123", segment: "field_notes" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.resend.com/contacts");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toEqual({
      email: "new.lead@example.com",
      first_name: "Pat",
      segments: [{ id: RESEND_SEGMENT_IDS.field_notes }],
      properties: {
        source: "https://marshallwilkinson.com/field-notes",
        source_url: "https://marshallwilkinson.com/field-notes",
        magnet: "field-notes",
      },
    });
  });

  it("updates an existing contact and adds them to the Circle segment", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const result = await upsertResendCapture(
      {
        email: "miragliotta310@gmail.com",
        segment: "circle",
        source: "stripe",
        magnet: "circle",
      },
      {
        apiKey: "re_test",
        fetch: async (url, init) => {
          const method = init?.method ?? "GET";
          calls.push({ url: String(url), method });
          if (method === "POST" && String(url).endsWith("/contacts")) {
            return new Response(JSON.stringify({ message: "Contact already exists" }), { status: 409 });
          }
          if (method === "PATCH") {
            return new Response(JSON.stringify({ id: "contact_existing" }), { status: 200 });
          }
          if (method === "POST" && String(url).includes("/segments/")) {
            return new Response(JSON.stringify({ id: "contact_existing" }), { status: 200 });
          }
          return new Response("{}", { status: 500 });
        },
      },
    );

    expect(result).toEqual({ ok: true, contactId: "contact_existing", segment: "circle" });
    expect(calls.map((c) => c.method)).toEqual(["POST", "PATCH", "POST"]);
    expect(calls[2]?.url).toBe(
      `https://api.resend.com/contacts/contact_existing/segments/${RESEND_SEGMENT_IDS.circle}`,
    );
  });
});
