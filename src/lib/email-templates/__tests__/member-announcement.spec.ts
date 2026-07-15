import React from "react";
import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";
import { template } from "../member-announcement";

async function renderAnnouncement(body: string) {
  return render(
    React.createElement(template.component, {
      firstName: "Sam",
      headline: "Thursday field note",
      body,
      signoff: "— Marshall",
    }),
  );
}

describe("member announcement email", () => {
  it("uses a natural greeting when a member name is unavailable", async () => {
    const html = await render(
      React.createElement(template.component, {
        headline: "Thursday field note",
        body: "The member update goes here.",
      }),
    );

    expect(html).toContain("Hi there —");
    expect(html).not.toContain("Hey —");
  });

  it("uses the ALP app-tier narrative and wordmark structure", async () => {
    const html = await renderAnnouncement("The member update goes here.");

    expect(html).toContain("Member operating brief");
    expect(html).toContain("Contractor Circle / Member note");
    expect(html).toContain("ALP Contractor Circle");
    expect(html).toContain("— an ALP product");
    expect(html).toContain("Build the company behind the projects.");
    expect(html).toContain("background-color:#FAF9F5");
    expect(html).toContain("border-left:3px solid #D97757");
  });

  it("renders formatted text, lists, links, and hosted images", async () => {
    const html = await renderAnnouncement(`
## Daily Project WIP

This is **important** and *ready to use*.

- Review the WIP
- Assign an owner

[Open the Hub](https://app.alpcontractorcircle.com)

![WIP worksheet](https://example.com/wip.gif)
`);

    expect(html).toContain("<h2");
    expect(html).toContain("<strong");
    expect(html).toContain("<em");
    expect(html).toContain("<ul");
    expect(html).toContain('href="https://app.alpcontractorcircle.com"');
    expect(html).toContain('src="https://example.com/wip.gif"');
    expect(html).toContain('alt="WIP worksheet"');
  });

  it("does not render raw HTML or unsafe image and link protocols", async () => {
    const html = await renderAnnouncement(`
<script>alert("no")</script>

[Unsafe link](javascript:alert("no"))

![Unsafe image](javascript:alert("no"))
`);

    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('src="javascript:');
  });
});
