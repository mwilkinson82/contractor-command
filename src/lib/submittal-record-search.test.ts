import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { submittalRecordSearch } from "./submittal-record-search";
import { submittalUploadUrl } from "./mcp/submittal-record-url";

describe("submittal upload return search", () => {
  it("emits the router's final upload URL without a normalization redirect", () => {
    const href = submittalUploadUrl(
      "https://app.meetathena.io/r/job/11111111-1111-4111-8111-111111111111/submittals?t=fictional",
      "05 12 00-001",
    )!;
    const url = new URL(href);
    expect(defaultStringifySearch(submittalRecordSearch(defaultParseSearch(url.search)))).toBe(
      url.search,
    );
    expect(url.searchParams.get("t")).toBe("fictional");
    expect(url.hash).toBe("#upload");
    expect(submittalRecordSearch(defaultParseSearch(url.search)).upload).toBe("1");
  });
  it("keeps the upload request and token after the real router decodes numeric query values", () => {
    expect(submittalRecordSearch(defaultParseSearch("?upload=1&t=fictional&open=package"))).toEqual(
      {
        upload: "1",
        t: "fictional",
        open: "package",
      },
    );
  });
  it("does not turn any other decoded numeric or boolean value into an upload request", () => {
    expect(submittalRecordSearch({ upload: true, t: "fictional" })).toEqual({ t: "fictional" });
    expect(submittalRecordSearch({ upload: 0 })).toEqual({});
  });
});
