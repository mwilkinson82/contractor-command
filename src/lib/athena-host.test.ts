import { afterEach, describe, expect, it } from "vitest";
import { athenaAppOrigin, DEFAULT_ATHENA_APP_ORIGIN, isLovableHost } from "@/lib/athena-host";
import { isAthenaHost } from "@/lib/site-icons";

describe("athena host helpers", () => {
  const prev = process.env.ATHENA_APP_ORIGIN;
  afterEach(() => {
    if (prev === undefined) delete process.env.ATHENA_APP_ORIGIN;
    else process.env.ATHENA_APP_ORIGIN = prev;
  });

  it("defaults the Athena origin to app.meetathena.io", () => {
    delete process.env.ATHENA_APP_ORIGIN;
    expect(athenaAppOrigin()).toBe(DEFAULT_ATHENA_APP_ORIGIN);
    expect(DEFAULT_ATHENA_APP_ORIGIN).toBe("https://app.meetathena.io");
  });

  it("honours ATHENA_APP_ORIGIN without a trailing slash", () => {
    process.env.ATHENA_APP_ORIGIN = "https://staging.meetathena.io/";
    expect(athenaAppOrigin()).toBe("https://staging.meetathena.io");
  });

  it("classifies hosts", () => {
    expect(isLovableHost("contractor-command.lovable.app")).toBe(true);
    expect(isLovableHost("app.meetathena.io")).toBe(false);
    expect(isAthenaHost("app.meetathena.io")).toBe(true);
    expect(isAthenaHost("app.alpcontractorcircle.com")).toBe(false);
  });
});
