import { defaultParseSearch } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { submittalRecordSearch } from "./submittal-record-search";

describe("submittal upload return search", () => {
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
