import { describe, expect, it } from "vitest";
import {
  brandChanges,
  companyInitials,
  draftFrom,
  nameChanged,
  profileSaveError,
  setupSteps,
  validateProfile,
  type CompanyProfile,
} from "./account-profile";
import { accountLinkCard, accountSection, accountUrl } from "./mcp/tools/account-tools";
import { inviteEmailNote } from "@/components/account/athena-team-section";

const saved: CompanyProfile = {
  id: "c1",
  name: "Ridgeline Electric",
  logo_url: null,
  license_number: "TECL 31415",
  contact_name: null,
  contact_phone: "(512) 555-0142",
  website: null,
  address: null,
};

describe("company profile on the account page", () => {
  it("only sends fields that changed, so a save never blanks what another tool set", () => {
    const d = { ...draftFrom(saved), website: "ridgelineelectric.com" };
    expect(brandChanges(saved, d)).toEqual({ website: "ridgelineelectric.com" });
    expect(nameChanged(saved, d)).toBe(false);
  });
  it("sends an emptied field as blank so the database clears it", () => {
    expect(brandChanges(saved, { ...draftFrom(saved), license_number: "  " })).toEqual({
      license_number: "",
    });
  });
  it("checks the name, phone and website in plain words", () => {
    expect(validateProfile({ ...draftFrom(saved), name: " " })).toBe("Enter your company name.");
    expect(validateProfile({ ...draftFrom(saved), contact_phone: "call me" })).toMatch(/digits/);
    expect(validateProfile({ ...draftFrom(saved), website: "not a site" })).toMatch(/website/);
    expect(validateProfile({ ...draftFrom(saved), address: "x".repeat(301) })).toMatch(
      /Address is too long/,
    );
    expect(validateProfile(draftFrom(saved))).toBeNull();
  });
  it("turns database errors into owner-facing messages", () => {
    expect(profileSaveError("MCP_BAD:Only a company Owner can change the company profile.")).toBe(
      "Only the company Owner can change the company profile.",
    );
    expect(profileSaveError("MCP_BAD:Keep the address under 300 characters.")).toBe(
      "Keep the address under 300 characters.",
    );
    expect(profileSaveError("network")).toMatch(/didn't save/);
  });
  it("makes logo initials from the company name", () => {
    expect(companyInitials("Ridgeline Electric Co")).toBe("RE");
    expect(companyInitials("")).toBe("A");
  });
  it("counts setup steps, with payments shown but not yet counted", () => {
    const steps = setupSteps({
      profile: { ...saved, logo_url: "https://x.example/logo.png" },
      members: 1,
      pending: 1,
    });
    expect(steps.map((s) => [s.id, s.done, !!s.soon])).toEqual([
      ["profile", true, false],
      ["team", true, false],
      ["payments", false, true],
    ]);
    expect(setupSteps({ profile: saved, members: 1, pending: 0 })[0].done).toBe(false);
  });
});

describe("account_link chat tool", () => {
  it("maps what the member says to an account section", () => {
    expect(accountSection("invite")).toBe("team");
    expect(accountSection("Permissions")).toBe("team");
    expect(accountSection("logo")).toBe("company");
    expect(accountSection("get_paid")).toBe("payments");
    expect(accountSection(undefined)).toBe("overview");
    expect(accountSection("something else")).toBe("overview");
  });
  it("links to the signed-in account page with no token in it", () => {
    expect(accountUrl("overview")).toBe("https://app.meetathena.io/account");
    expect(accountUrl("team")).toBe("https://app.meetathena.io/account#team");
    const card = JSON.stringify(accountLinkCard("team"));
    expect(card).toContain("https://app.meetathena.io/account#team");
    expect(card).toContain("no password needed");
    expect(card).not.toMatch(/token=|code=/);
  });
});

describe("invite email note", () => {
  it("never claims an email went out when it didn't", () => {
    expect(inviteEmailNote("sent", "Dana", "dana@x.example")).toContain("We emailed");
    expect(inviteEmailNote("off", "Dana", "dana@x.example")).toContain("app.meetathena.io/login");
    expect(inviteEmailNote("failed", "Dana", "dana@x.example")).toContain("didn't go out");
    expect(inviteEmailNote("off", "Dana", "dana@x.example")).not.toContain("We emailed");
  });
});
