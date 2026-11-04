// The picker is a real button on every device, not the browser's bare "Choose File" text.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { AddProgressPhotos } from "./AddProgressPhotos";

describe("AddProgressPhotos picker", () => {
  it("shows a Select photo button over a hidden file input when replacing", () => {
    const html = renderToStaticMarkup(
      createElement(AddProgressPhotos, {
        jobId: "j1",
        date: "2026-11-03",
        onSaved: () => {},
        replaces: {
          id: "p1",
          taken_on: "2026-11-03",
          area: "Interior office / ceiling",
          work: null,
          client_safe: true,
        },
      }),
    );
    expect(html).toMatch(/<button[^>]*class="pp-pick"[^>]*>Select photo<\/button>/);
    expect(html).toMatch(/<input[^>]*class="pp-file-input"[^>]*type="file"/);
    expect(html).toContain("No photo picked yet");
    expect(html).not.toMatch(/type="file"[^>]*multiple/);
  });
});
