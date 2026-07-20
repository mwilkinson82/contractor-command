import { describe, expect, it } from "vitest";
import { isEmbeddableReplayUrl } from "@/lib/library";

describe("isEmbeddableReplayUrl", () => {
  it.each([
    "https://www.loom.com/embed/22d11e96c7084343b7160092a53575b9",
    "https://www.tella.tv/video/vid_example/embed?b=0",
    "https://us06web.zoom.us/clips/embed/example",
    "https://iframe.videodelivery.net/example",
    "https://drive.google.com/file/d/example/preview",
  ])("accepts supported training embeds", (url) => {
    expect(isEmbeddableReplayUrl(url)).toBe(true);
  });

  it("keeps non-embed share pages external", () => {
    expect(
      isEmbeddableReplayUrl(
        "https://video.alpcontractorcircle.com/video/the-contractor-growth-myth-9gdz",
      ),
    ).toBe(false);
  });

  it("keeps Google Drive share pages external until they use the preview URL", () => {
    expect(isEmbeddableReplayUrl("https://drive.google.com/file/d/example/view?usp=sharing")).toBe(
      false,
    );
  });
});
