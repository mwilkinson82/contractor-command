import { describe, expect, it } from "vitest";
import { NO_PM_EMAIL_NOTE, pmNearMatches, pmReachable, pmSetupNext } from "./pm-setup";
import { jobsResponseText } from "./jobs-response";
import { jobCreatedText } from "./tools/workflow-tools";

const team = [
  { name: "Marshall", role: "owner" },
  { name: "Athena Reviewer", role: "pm" },
  { name: "Sam Ortiz", role: "pm" },
];

describe("a PM Athena can email", () => {
  it("counts a teammate PM or a contact with an email, never a bare name", () => {
    expect(pmReachable({ pm_user_id: "u1" })).toBe(true);
    expect(pmReachable({ pm_is_member: true })).toBe(true);
    expect(pmReachable({ pm_email: "sam@example.com" })).toBe(true);
    expect(pmReachable({ pm_email: null })).toBe(false);
    expect(pmReachable({ pm_email: "not an email" })).toBe(false);
  });

  it("finds the teammate the member meant by whole words", () => {
    expect(pmNearMatches("Marshall Wilkinson", team)).toEqual([team[0]]);
    expect(pmNearMatches("sam", team)).toEqual([team[2]]);
    expect(pmNearMatches("Marsh", team)).toEqual([]);
    expect(pmNearMatches("Marshall", team)).toEqual([]);
    expect(pmNearMatches("", team)).toEqual([]);
  });
});

describe("after the PM is saved", () => {
  it("confirms a teammate PM plainly, with where the emails go", () => {
    const r = pmSetupNext(
      { pm: "Marshall", pm_email: "marshall@example.com", pm_is_member: true },
      team,
    );
    expect(r.lines).toEqual([
      "Marshall is the job's PM. Client approvals and notices email marshall@example.com.",
    ]);
    expect(r.guidance).toEqual([]);
  });

  it("asks whether a typed full name was the teammate, instead of keeping an emailless contact", () => {
    const r = pmSetupNext(
      { pm: "Marshall Wilkinson", pm_email: null, pm_is_member: false },
      team,
      "Marshall Wilkinson",
    );
    expect(r.lines).toEqual([NO_PM_EMAIL_NOTE]);
    expect(r.guidance[0]).toContain("Did you mean Marshall?");
    expect(r.guidance[0]).toContain('pm "Marshall"');
  });

  it("offers the teammates when no PM is named, and says the owner gets the emails meanwhile", () => {
    const r = pmSetupNext({ pm: null, pm_email: null, pm_is_member: false }, team);
    expect(r.lines).toEqual([NO_PM_EMAIL_NOTE]);
    expect(r.guidance[0]).toContain("Marshall, Athena Reviewer, Sam Ortiz");
    const t = jobCreatedText({
      jobNumber: "2811",
      companyName: "ALP Construction",
      jobName: "Test",
      pm: null,
      pmLines: r.lines,
    });
    expect(t).toContain("Ask who the PM is before anything else");
    expect(t).toContain("email the company owner");
  });

  it("accepts a contact PM with an email as reachable", () => {
    const r = pmSetupNext(
      { pm: "Dana Fox", pm_email: "dana@example.com", pm_is_member: false },
      team,
    );
    expect(r.lines[0]).toContain("email dana@example.com");
    expect(r.guidance).toEqual([]);
  });
});

describe("jobs list", () => {
  it("flags each job with no PM and says where its emails go", () => {
    const text = jobsResponseText(
      [
        {
          name: "ALP Construction",
          jobs: [
            { job_number: "2810", name: "Willow Creek", no_pm: false },
            { job_number: "2811", name: "Cedar Hall", no_pm: true },
            { job_number: "2812", name: null, no_pm: true },
          ],
        },
      ],
      { jobs: 3, companies: 1 },
      false,
    );
    expect(text).toContain("**No PM set:** 2 jobs.");
    expect(text).toContain("Job 2811 · No PM set");
    expect(text).not.toContain("Job 2810 · No PM set");
  });

  it("adds nothing when every job has a PM", () => {
    const text = jobsResponseText(
      [{ name: "ALP", jobs: [{ job_number: "1", name: "A" }] }],
      { jobs: 1, companies: 1 },
      false,
    );
    expect(text).not.toContain("No PM");
  });
});
