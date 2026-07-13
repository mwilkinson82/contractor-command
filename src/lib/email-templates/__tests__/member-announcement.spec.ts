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
