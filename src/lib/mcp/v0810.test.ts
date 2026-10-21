import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ATHENA_SERVER_ICONS, ATHENA_VERSION, brandJsonRpcPayload } from "./server-info-branding";
import { tiaResult } from "./living";
import { emailContact, EMAIL_CONTACT_RULE } from "./contacts";
import { EMAIL_TO_LABEL_REQUIRED, sovRequiredTop } from "./visible";
import { siteIconResponse } from "@/lib/site-icons";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory()
      ? files(p)
      : p.endsWith(".ts") && !p.endsWith(".test.ts")
        ? [p]
        : [];
  });
}

describe("0.8.10", () => {
  it("version is 0.8.10 or later", () => expect(ATHENA_VERSION).toMatch(/^0\.8\.1[0-9]$/));

  it("fragnet, never fragment: delay result wording and tool schema", () => {
    const t = tiaResult({
      fragnet: "FRAG-01",
      prior_completion: "2027-06-04",
      updated_completion: "2027-06-19",
      fragnet_only_completion: "2027-06-11",
    })!;
    expect(t.fragnet).toBe("FRAG-01");
    expect(t.fragnet_only_cd).toBe(8);
    expect(t.math).toContain("Fragnet-only impact");
    expect(JSON.stringify(t)).not.toMatch(/fragment/i);
    // legacy saved key still reads, output says fragnet
    const legacy = tiaResult({
      fragment: "FRAG-02",
      prior_completion: "2027-06-04",
      updated_completion: "2027-06-10",
      fragment_only_completion: "2027-06-08",
    } as never)!;
    expect(legacy.fragnet).toBe("FRAG-02");
    expect(legacy.math).toContain("Fragnet-only impact");
    const manifest = readFileSync(".lovable/mcp/manifest.json", "utf8");
    expect(manifest).not.toMatch(/fragment/i);
    expect(readFileSync("src/lib/mcp/tools/living-tools.ts", "utf8")).toContain(
      "Delay fragnet result",
    );
  });

  it("no Athena output string, description or REQUIRED line says fragment", () => {
    for (const f of files("src/lib/mcp")) {
      const quoted = readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && !/legacy/.test(l));
      for (const l of quoted) expect(l, f).not.toMatch(/["'`][^"'`]*fragment/i);
    }
  });

  it("To: is the first structured field and the first rendered line inside the email card", () => {
    const known = emailContact({
      name: "Dana Ruiz",
      role: "PM",
      company: "Owner Co",
      email: "dana@owner.co",
    } as never).structured.email_card;
    expect(known.placement).toBe("inside_card_first_line");
    expect(known.fields[0]).toMatchObject({
      key: "to",
      label: "To:",
      value: "dana@owner.co",
      order: 1,
    });
    expect(known.fields[1].label).toBe("Subject:");
    expect(known.rendered_text.split("\n")[0]).toBe("To: dana@owner.co");
    const unknown = emailContact(null).structured.email_card;
    expect(unknown.fields[0]).toMatchObject({ key: "to", label: "To:", value: "", blank: true });
    expect(unknown.rendered_text.startsWith("To: ")).toBe(true);
    expect(EMAIL_TO_LABEL_REQUIRED).toMatch(/first line of the card itself/);
    expect(EMAIL_TO_LABEL_REQUIRED).toMatch(/never put To: outside the card/i);
    expect(EMAIL_CONTACT_RULE).toMatch(/Inside the card itself/);
    expect(sovRequiredTop([], "To: a@b.co")).toContain(
      '"To:" as the first line inside the card itself',
    );
  });

  it("serverInfo icons: absolute app.meetathena.io PNGs, all small, the same on both domains", () => {
    for (const i of ATHENA_SERVER_ICONS) {
      expect(i.src.startsWith("https://app.meetathena.io/brand/athena/")).toBe(true);
      expect(i.mimeType).toBe("image/png");
      expect(i.src).not.toContain("512");
    }
    const init = {
      jsonrpc: "2.0",
      id: 1,
      result: { serverInfo: { name: "athena", version: ATHENA_VERSION } },
    };
    const a = brandJsonRpcPayload(init, [1]).value as {
      result: { serverInfo: { icons: unknown } };
    };
    expect(a.result.serverInfo.icons).toEqual(
      ATHENA_SERVER_ICONS.map((i) => ({ ...i, sizes: [...i.sizes] })),
    );
  });

  it("icon PNGs: served on both hosts, under 13 KB, with CORS on GET and OPTIONS; hub favicon unchanged", async () => {
    for (const host of ["app.meetathena.io", "app.alpcontractorcircle.com"]) {
      for (const i of ATHENA_SERVER_ICONS) {
        const path = new URL(i.src).pathname;
        const r = siteIconResponse(new Request(`https://${host}${path}`))!;
        expect(r.status, `${host}${path}`).toBe(200);
        expect(r.headers.get("content-type")).toBe("image/png");
        expect(r.headers.get("access-control-allow-origin")).toBe("*");
        expect(r.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
        const bytes = new Uint8Array(await r.arrayBuffer());
        expect(bytes.length).toBeLessThan(13_000);
        expect([...bytes.slice(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
        const o = siteIconResponse(new Request(`https://${host}${path}`, { method: "OPTIONS" }))!;
        expect(o.status).toBe(204);
        expect(o.headers.get("access-control-allow-origin")).toBe("*");
      }
    }
    const hubFav = siteIconResponse(
      new Request("https://app.alpcontractorcircle.com/favicon.ico"),
    )!;
    const athFav = siteIconResponse(new Request("https://app.meetathena.io/favicon.ico"))!;
    expect(hubFav.headers.get("access-control-allow-origin")).toBeNull();
    expect(new Uint8Array(await hubFav.arrayBuffer())).not.toEqual(
      new Uint8Array(await athFav.arrayBuffer()),
    );
    expect(
      siteIconResponse(
        new Request("https://app.alpcontractorcircle.com/favicon.ico", { method: "OPTIONS" }),
      ),
    ).toBeNull();
  });
});

import { CPM_GANTT_SPEC, DELAY_CALLOUT_COLOR } from "./living";
import { isAppHandoff } from "@/lib/consent-loading";

describe("0.8.10 CPM Gantt spec + desktop return", () => {
  it("cpm_activities sends the Gantt spec right after the Tie line", () => {
    const src = readFileSync("src/lib/mcp/tools/living-tools.ts", "utf8");
    expect(src).toMatch(/`Tie: \$\{tie\.line\}`\] : \[\]\),\s*\.\.\.CPM_GANTT_SPEC,/);
    expect(CPM_GANTT_SPEC[0]).toBe("Show these activities as a schedule.");
    expect(CPM_GANTT_SPEC).toHaveLength(3);
    const all = CPM_GANTT_SPEC.join("\n");
    expect(all).not.toMatch(/#[0-9A-Fa-f]{3,8}/);
    expect(all).not.toMatch(/fragment/i);
  });
  it("delay callout color comes from one constant", () => {
    expect(DELAY_CALLOUT_COLOR).toBe("red #DC2626");
    expect(CPM_GANTT_SPEC.join("\n")).not.toContain(DELAY_CALLOUT_COLOR);
  });
  it("desktop app returns keep a Return link", () => {
    expect(isAppHandoff("codex://oauth/callback?code=x")).toBe(true);
    expect(isAppHandoff("cursor://anysphere.cursor-mcp/oauth/callback?code=x")).toBe(true);
    expect(isAppHandoff("http://localhost:1455/callback?code=x")).toBe(true);
    expect(isAppHandoff("http://127.0.0.1:33418/cb?code=x")).toBe(true);
    expect(isAppHandoff("https://chatgpt.com/connector_platform_oauth_redirect?code=x")).toBe(
      false,
    );
    expect(isAppHandoff("https://claude.ai/api/mcp/auth_callback?code=x")).toBe(false);
    expect(isAppHandoff("not a url")).toBe(false);
  });
});
