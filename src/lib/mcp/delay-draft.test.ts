import { describe, expect, it } from "vitest";
import { delayDraft } from "./delay-draft";
import type { EmailDraft } from "./email-safety";
const draft: EmailDraft = {
  to: null,
  cc: [],
  subject: "Delay notice · QA",
  body: "Dear Project Manager,\nSwitchgear is delayed.",
  link: null,
  attachment: null,
};
const pat = {
  name: "Pat Kim",
  role: "PM",
  email: "pat@example.com",
  company: "Fictional GC",
  source: "saved deadline",
};
describe("delay notice saved recipient", () => {
  it("uses the saved contact and exposes an honest unsent draft", () => {
    const filled = delayDraft(draft, [pat]);
    expect(filled.draft).toMatchObject({
      to: "pat@example.com",
      body: "Hi Pat,\nSwitchgear is delayed.",
    });
    expect(filled.contact).toMatchObject({ name: "Pat Kim", known: true });
    expect(draft.to).toBeNull();
  });
  it("does not substitute a different recipient or a named greeting", () => {
    expect(delayDraft({ ...draft, to: "other@example.com" }, [pat]).draft).toEqual({
      ...draft,
      to: "other@example.com",
    });
    expect(delayDraft({ ...draft, body: "Dear Alex,\nA delay." }, [pat]).draft.body).toBe(
      "Dear Alex,\nA delay.",
    );
  });
  it("asks for a missing contact, and never guesses between two PMs", () => {
    for (const contacts of [[], [pat, { ...pat, name: "Alex Jones", email: "alex@example.com" }]]) {
      const result = delayDraft(draft, contacts);
      expect(result.draft.to).toBeNull();
      expect(result.contact).toMatchObject({
        known: false,
        ask: "Who should this go to? (name and email)",
      });
    }
  });
  it("leaves non-notice drafts untouched", () => {
    const ordinary = { ...draft, subject: "Shop drawings", body: "Hi Team," };
    expect(delayDraft(ordinary, [pat])).toEqual({ draft: ordinary, contact: null });
  });
  it("uses an explicitly supplied real name without inventing its email or claiming a saved contact", () => {
    const result = delayDraft(draft, [], "Pat Kim");
    expect(result.draft).toMatchObject({ to: null, body: "Hi Pat,\nSwitchgear is delayed." });
    expect(result.contact).toMatchObject({
      name: "Pat Kim",
      email: null,
      ask: "What's Pat Kim's email?",
    });
    expect(delayDraft(draft, [], "Project Manager").draft.body).toBe(draft.body);
  });
});
