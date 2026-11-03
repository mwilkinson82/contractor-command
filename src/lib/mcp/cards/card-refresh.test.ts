import { describe, expect, it } from "vitest";
import { emailCardHtml } from "./email-card";
import { renderHtml } from "./html";
import { sovCard } from "./structured";
import { cardWidgetHtml } from "./widget";
import { EMAIL_DRAFT_ONLY_RULE } from "../email-safety";

describe("email and SOV presentation", () => {
  it("keeps the email controls and confirmation bridge on a light card", () => {
    const html = emailCardHtml();
    expect(html).toContain("Approve and send");
    expect(html).toContain("document_email_delivery");
    expect(html).toContain("Open file link");
    expect(html).not.toContain("background:#1E3A5F;color:#FFFFFF;padding:14px 18px");
    expect(html).toContain(":focus-visible");
  });
  it("styles SOV specifically without losing values or the mobile table", () => {
    const card = sovCard({ job: "Example", rows: [], divisions: [], fee: null, totalDisplay: "$100.00", basis: null, audience: "internal", view: "lines" });
    const html = renderHtml(card);
    expect(html).toContain('data-presentation="sov"');
    expect(html).toContain("$100.00");
    expect(html).toContain('aria-label="Report table"');
    expect(cardWidgetHtml()).toContain('data-presentation="sov"');
  });
  it("routes supported saved attachments to review while retaining explicit confirmation", () => {
    expect(EMAIL_DRAFT_ONLY_RULE).toContain("payment_application_read");
    expect(EMAIL_DRAFT_ONLY_RULE).toContain("document_email_delivery action review");
    expect(EMAIL_DRAFT_ONLY_RULE).toContain("explicit confirmation");
    expect(EMAIL_DRAFT_ONLY_RULE).toContain("link-only");
  });
});
