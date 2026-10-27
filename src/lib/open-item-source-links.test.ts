import { describe, expect, it } from "vitest";
import { gmailThreadUrl, gmailThreadUrls } from "./open-item-source-links";
import { esc, renderReportBody } from "./report-pages";
import { signSiblingLinks } from "../components/athena/ReportPage";

const thread = "0123456789abcdef";
const gmail = `https://mail.google.com/mail/u/0/#all/${thread}`;
const row = (next_action?: string, check_key = "manual:fixture") => ({
  id: "fixture-item",
  action: "Await equipment information",
  owner: 'QA <Supplier> "one"',
  check_key,
  next_action,
});
const page = (next_action?: string, check_key?: string) =>
  renderReportBody({ page: "items", items: [row(next_action, check_key)] });

describe("saved Gmail thread destinations", () => {
  it.each([
    gmail,
    `https://mail.google.com/mail/u/2/#inbox/${thread}`,
    `https://mail.google.com/mail/#sent/${thread}`,
    `https://mail.google.com/mail/u/?authuser=qa%40example.com#all/${thread}`,
    `https://mail.google.com/mail/u/0/?authuser=1#all/FMfcgzQfQASyntheticThreadReference12345`,
  ])("preserves a recognized thread address exactly: %s", (url) => {
    expect(gmailThreadUrl(url)).toBe(url);
  });

  it.each([
    `http://mail.google.com/mail/u/0/#all/${thread}`,
    `https://mail.google.com.evil.example/mail/u/0/#all/${thread}`,
    `https://mail.google.com@evil.example/mail/u/0/#all/${thread}`,
    `https://user@mail.google.com/mail/u/0/#all/${thread}`,
    `https://mail.google.com:443/mail/u/0/#all/${thread}`,
    `https://mail.google.com/mail/u/0/#all`,
    `https://mail.google.com/mail/u/0/#settings/general`,
    `https://mail.google.com/mail/u/0/#drafts/${thread}`,
    `https://mail.google.com/mail/u/0/?compose=${thread}`,
    `https://mail.google.com/mail/u/0/?redirect=https://evil.example#all/${thread}`,
    `https://mail.google.com/url?url=https://evil.example#all/${thread}`,
    `https://mail.google.com/mail/u/#all/${thread}`,
    `https://mail.google.com/mail/u/0/?authuser=1&authuser=2#all/${thread}`,
    `${gmail}?other=value`,
    `${gmail}%0a`,
    `${gmail}%`,
    `javascript:${gmail}`,
    `https://mail.google.com/mail/u/0/#all/short`,
  ])("keeps malformed, deceptive or non-thread addresses as text: %s", (url) => {
    expect(gmailThreadUrl(url)).toBeNull();
    expect(page(url)).not.toContain("<a ");
  });

  it("extracts multiple saved threads, removes prose punctuation and deduplicates", () => {
    const second = `https://mail.google.com/mail/u/1/#sent/${thread}`;
    expect(gmailThreadUrls(`Source: (${gmail}). Again ${gmail}; and <${second}>.`)).toEqual([
      gmail,
      second,
    ]);
    expect(gmailThreadUrls(`https://evil.example/?next=${gmail}`)).toEqual([]);
  });
});

describe("Open items page source links", () => {
  it("preserves the saved text, escapes it and adds an accessible mobile email action", () => {
    const detail = `<img src=x onerror=alert(1)> Source: ${gmail}`;
    const html = page(detail);
    expect(html).toContain(esc(detail));
    expect(html).not.toContain("<img");
    expect(html).toContain(`href="${gmail}"`);
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain('aria-label="Open email for QA &lt;Supplier&gt; &quot;one&quot;"');
    expect(html).toContain("min-height:44px");
    expect(html).toContain(">Open email</a>");
    expect(signSiblingLinks(html, "synthetic-board-token")).toBe(html);
  });

  it("numbers distinct email actions and leaves reminders without a source informational", () => {
    expect(page(`${gmail} ${gmail.replace("/0/", "/1/")}`)).toContain(">Open email 2</a>");
    expect(page()).not.toContain("<a ");
    expect(page("Confirm the delivery date")).not.toContain("<a ");
    expect(page(gmail, "setup:equipment")).not.toContain("<a ");
  });

  it("does not infer submittal relationships or destinations from follow-up text", () => {
    for (const detail of [
      "Await supplier response; submittal SUB-101, record 11111111-1111-4111-8111-111111111111",
      "https://app.meetathena.io/r/job/11111111-1111-4111-8111-111111111111/submittal/SUB-101",
    ]) {
      const html = page(detail);
      expect(html).toContain(esc(detail));
      expect(html).not.toContain("<a ");
      expect(html).not.toContain("Open submittal");
    }
  });
});
