import { describe, expect, it } from "vitest";
import { renderProposalDocument } from "./proposal-page";
import { customerProposal } from "./proposal";
import { openProposalShare } from "../selection-proposal-share.server";
import { willowCreekTypeE } from "./__fixtures__/willow-creek-type-e";

const token = "A".repeat(43);
const payload = (mutate?: (b: ReturnType<typeof willowCreekTypeE>) => void) => {
  const b = willowCreekTypeE();
  mutate?.(b);
  return {
    company: "ALP Construction",
    job_name: "Willow Creek Community Center — Electrical",
    expires_at: "2026-11-18T00:00:00.000Z",
    board_version: 2,
    proposal: customerProposal(b, 2),
  };
};

describe("customer proposal page", () => {
  it("renders a side-by-side comparison with totals, per-unit differences and photos, and no product links", () => {
    const html = renderProposalDocument(
      payload((b) => {
        b.selections[0].options.better.product_url = "https://lighting.example.com/cpanl";
      }),
    );
    expect(html).toContain("<h1>Willow Creek lighting options</h1>");
    expect(html).toContain("$48,500.00");
    expect(html).toContain("Your base price");
    expect(html).toContain("+$336.00 upgrade");
    expect(html).toContain("+$1,686.00 upgrade");
    // Per-unit difference, with the line total under it.
    expect(html).toContain("+$56.00");
    expect(html).toContain("per ea · +$336.00 for all 6 ea");
    expect(html).toContain("CPANL 2X4 ALO6 SWW7 M2");
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain("6 ea in every package");
    // Contractors mark up materials: no maker or store link, and no link of any kind, reaches the customer.
    expect(html).not.toContain("lighting.example.com/cpanl");
    expect(html).not.toMatch(/<a\s/);
    expect(html).not.toMatch(/homedepot\.com|platt\.com/);
    expect(html).not.toContain("Photo not available");
    // Before a contract a choice sets the proposal price; it is never called a change order.
    expect(html).toContain("its total becomes your proposal price");
    expect(html).not.toMatch(/change order/i);
    // The contractor's brand leads; Athena is small in the corner.
    expect(html).toContain('<div class="co-name">ALP Construction</div>');
    expect(html).toContain("Powered by Athena");
    expect(html).toContain("family=Inter");
    expect(html).not.toMatch(
      /69\.97|109\.99|271\.33|Retail list|Confirm count|Illustrative test base/,
    );
  });

  it("says change order only once the job is under contract", () => {
    const html = renderProposalDocument({ ...payload(), under_contract: true });
    expect(html).toContain(
      "Your contract includes Good. Choosing another package approves the difference as a change order to your contract, and you see any added time before you sign.",
    );
    expect(html).not.toContain("proposal price");
  });

  it("allows only Google Fonts besides https photos", async () => {
    const res = await openProposalShare(token, "GET", async () => ({
      ...payload(),
      under_contract: false,
    }));
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("style-src 'unsafe-inline' https://fonts.googleapis.com");
    expect(csp).toContain("font-src https://fonts.gstatic.com");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).not.toContain("script-src");
  });

  it("escapes every customer-visible field", () => {
    const html = renderProposalDocument(
      payload((b) => {
        b.proposal.title = "<script>alert(1)</script>";
        b.selections[0].options.good.description = '"><img src=x onerror=alert(1)>';
      }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });

  it("marks the package the customer chose", () => {
    const b = willowCreekTypeE();
    b.accepted = {
      tier: "better",
      board_version: 2,
      total_cents: 4_883_600,
      recorded_on: "2026-11-04",
      recorded_by: "00000000-0000-4000-8000-000000000901",
      evidence: "Email",
    };
    const html = renderProposalDocument({ ...payload(), proposal: customerProposal(b, 2) });
    expect(html).toContain("You chose Better");
    expect(html).toContain("Chosen on November 4, 2026.");
    expect(html).toContain('<span class="tag rec">Your choice</span>');
    expect(html).not.toContain("Ready to choose?");
    expect(html).not.toContain("Email");
  });

  it("serves links by hash only and refuses unknown, expired or unexpected data", async () => {
    const seen: string[] = [];
    const ok = await openProposalShare(token, "GET", async (h) => {
      seen.push(h);
      return payload();
    });
    expect(ok.status).toBe(200);
    expect(seen[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(ok.headers.get("x-robots-tag")).toBe("noindex");
    expect((await openProposalShare("short", "GET", async () => payload())).status).toBe(404);
    expect((await openProposalShare(token, "GET", async () => null)).status).toBe(410);
    expect(
      (
        await openProposalShare(token, "HEAD", async () => {
          throw new Error("must not look up");
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await openProposalShare(token, "GET", async () => {
          throw new Error("down");
        })
      ).status,
    ).toBe(503);
    const leaky = payload() as unknown as {
      proposal: { selections: { options: { good: Record<string, unknown> } }[] };
    };
    leaky.proposal.selections[0].options.good.cost_cents = 6997;
    const refused = await openProposalShare(token, "GET", async () => leaky);
    expect(refused.status).toBe(503);
    expect(await refused.text()).not.toContain("6997");
  });
});
