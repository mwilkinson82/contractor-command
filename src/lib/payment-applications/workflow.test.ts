import { describe, it, expect } from "vitest";
import { defaultParseSearch } from "@tanstack/react-router";
import {
  applicationUrl,
  applicationTarget,
  carryCertificate,
  emptyApplication,
  type SavedApplication,
} from "./workflow";
import { applicationFixture } from "./fixtures";
import { calculateApplication } from "./model";
import { boardSignInReturn } from "../board-sign-in";
const job = "00000000-0000-4000-8000-000000000001",
  id = "00000000-0000-4000-8000-000000000002";
describe("exact application links and provenance", () => {
  it("survives actual router numeric search serialization and sign-in return", () => {
    const url = applicationUrl(job, id, 4, true);
    const search = defaultParseSearch("?" + url.split("?")[1]);
    expect((search as Record<string, unknown>).version).toBe(4);
    expect(applicationTarget(search)).toEqual({ id, version: 4, download: true });
    expect(boardSignInReturn(url)).toBe(url);
  });
  it("rejects incomplete, invalid and unrelated destinations without substituting a record", () => {
    for (const q of [
      { version: 1 },
      { application_id: "wrong" },
      { application_id: id, version: 0 },
      { application_id: id, version: 1.5 },
      { application_id: id, version: "1e2" },
      { download: "https://elsewhere.invalid" },
    ])
      expect(() => applicationTarget(q)).toThrow();
    expect(boardSignInReturn("//elsewhere.invalid")).toBeUndefined();
  });
  it("starts missing inputs unknown and carries only an actual exact saved certificate", () => {
    const a = applicationFixture();
    const b = emptyApplication(a.snapshot);
    expect(b.lines[0].work_cents).toBeNull();
    expect(b.prior_certified_net_cents).toBeNull();
    a.state = "certified";
    a.certification = {
      amount_cents: 1200000,
      date: "2026-02-01",
      source: "Actual partial certificate",
    };
    const s: SavedApplication = {
      application_id: id,
      version: 2,
      latest_version: 2,
      body: a,
      calculation: calculateApplication(a),
      billing_version: 2,
      history: [],
      recorded_at: "2026-02-01",
    };
    const next = carryCertificate(b, s);
    expect(next.prior_certified_net_cents).toBe(1200000);
    expect(next.lines[0].prior_stored_cents).toBe(500000);
    expect(next.lines[0].work_cents).toBeNull();
    expect(() => carryCertificate(b, { ...s, latest_version: 3 })).toThrow();
  });
});
