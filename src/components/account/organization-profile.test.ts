import React, { type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Company } from "@/hooks/use-company";

const m = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => void>,
  upsert: vi.fn(),
  from: vi.fn(),
  upload: vi.fn(),
  storage: vi.fn(),
  refetch: vi.fn(),
}));
// Same local hook-driving pattern as use-company.test.ts. Exercise real event handlers,
// pending operations and re-renders without a live session, browser or database.
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const i = m.cursor++;
    if (!(i in m.slots)) m.slots[i] = typeof initial === "function" ? initial() : initial;
    return [
      m.slots[i],
      (value: unknown) => {
        m.slots[i] = typeof value === "function" ? value(m.slots[i]) : value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const i = m.cursor++;
    return (m.slots[i] ??= { current: initial });
  },
  useEffect: (fn: () => unknown, deps: unknown[]) => {
    const i = m.cursor++;
    const previous = m.slots[i] as { deps: unknown[]; cleanup?: () => void } | undefined;
    if (!previous || deps.some((v, n) => v !== previous.deps[n]))
      m.effects.push(() => {
        previous?.cleanup?.();
        const cleanup = fn();
        m.slots[i] = { deps, cleanup: typeof cleanup === "function" ? cleanup : undefined };
      });
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: m.from, storage: { from: m.storage } },
}));
vi.mock("@/hooks/use-company", () => ({
  logoPublicUrl: (path: string | null) => (path ? `/logos/${path}` : null),
}));
import { OrganizationProfile, type OrganizationProfileProps } from "./organization-profile";
import { AthenaAccountLayout, type AthenaAccountLayoutProps } from "./athena-account-layout";

const company: Company = {
  id: "org-a",
  owner_user_id: "account-a",
  name: "AOP Consulting",
  address: "10 Oak St",
  greeting_icon: "wave",
  logo_path: "account-a/old.png",
  created_at: "",
  updated_at: "",
};
const props = (): OrganizationProfileProps => ({
  user: { id: "account-a", email: "owner@example.test" },
  company,
  loading: false,
  error: null,
  workspaceName: "ALP Construction",
  refetch: m.refetch,
});
type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function nodes(tree: ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!React.isValidElement(tree)) return [];
  const node = tree as Element;
  return [node, ...nodes(node.props.children)];
}
function text(tree: ReactNode): string {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return React.isValidElement(tree) ? text((tree as Element).props.children) : "";
}
function render(p = props()) {
  m.cursor = 0;
  m.effects = [];
  const tree = OrganizationProfile(p);
  m.effects.forEach((fn) => fn());
  return tree;
}
function button(tree: ReactNode, label: string) {
  const found = nodes(tree).find((node) => node.type === "button" && text(node).includes(label));
  expect(found, label).toBeDefined();
  return found as Element;
}
function click(node: Element) {
  (node.props.onClick as () => unknown)();
}
function input(tree: ReactNode, id: string) {
  const found = nodes(tree).find((node) => node.props.id === id);
  expect(found, id).toBeDefined();
  return found as Element;
}
function change(tree: ReactNode, id: string, value: string) {
  (input(tree, id).props.onChange as (event: unknown) => void)({ target: { value } });
}
function choose(tree: ReactNode, file: File) {
  (input(tree, "organization-logo").props.onChange as (event: unknown) => void)({
    target: { files: [file], value: "selected" },
  });
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
beforeEach(() => {
  m.slots = [];
  m.effects = [];
  m.cursor = 0;
  m.upsert.mockReset().mockResolvedValue({ error: null });
  m.upload.mockReset().mockResolvedValue({ error: null });
  m.from.mockReset().mockReturnValue({ upsert: m.upsert });
  m.storage.mockReset().mockReturnValue({ upload: m.upload });
  m.refetch.mockReset().mockResolvedValue(undefined);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.stubGlobal("window", {
    location: { hash: "", pathname: "/account", search: "" },
    history: { replaceState: vi.fn() },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});
afterEach(() => {
  for (const slot of m.slots) (slot as { cleanup?: () => void } | null)?.cleanup?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("explicit owner organization profile target", () => {
  it("shows the account organization separately from a different selected Athena workspace", () => {
    const tree = render();
    expect(text(tree)).toContain("Profile: AOP Consulting");
    expect(text(tree)).toContain("Athena workspace: ALP Construction");
    expect(text(tree)).toContain("Account: owner@example.test");
    expect(input(tree, "organization-name").props.value).toBe("AOP Consulting");
    expect(m.from).not.toHaveBeenCalled();
  });
  it("keeps the owner's explicit save target when workspace selection changes", async () => {
    change(render(), "organization-name", "  AOP Advisory  ");
    const tree = render({ ...props(), workspaceName: "Northline Builders" });
    expect(text(tree)).toContain("Athena workspace: Northline Builders");
    expect(input(tree, "organization-name").props.value).toBe("  AOP Advisory  ");
    click(button(tree, "Save organization profile"));
    await settle();
    expect(m.from).toHaveBeenCalledExactlyOnceWith("companies");
    expect(m.upsert).toHaveBeenCalledWith(
      {
        owner_user_id: "account-a",
        name: "AOP Advisory",
        address: "10 Oak St",
        greeting_icon: "wave",
        logo_path: "account-a/old.png",
      },
      { onConflict: "owner_user_id" },
    );
    expect(m.refetch).toHaveBeenCalledOnce();
  });
  it("starts a missing owner profile empty instead of copying the selected workspace name", async () => {
    const p = { ...props(), company: null };
    const tree = render(p);
    expect(input(tree, "organization-name").props.value).toBe("");
    expect(text(tree)).toContain("New organization profile");
    change(tree, "organization-name", "Harbor Advisory");
    click(button(render(p), "Save organization profile"));
    await settle();
    expect(m.upsert.mock.calls[0][0]).toMatchObject({
      owner_user_id: "account-a",
      name: "Harbor Advisory",
    });
  });
  it.each([
    { user: null },
    { loading: true },
    { error: "unavailable" },
    { company: { ...company, owner_user_id: "other-account" } },
  ])("does not expose editable fields or writes when scope is unavailable: %j", (override) => {
    const tree = render({ ...props(), ...override });
    expect(nodes(tree).filter((x) => x.type === "input")).toHaveLength(0);
    expect(m.from).not.toHaveBeenCalled();
    expect(m.upload).not.toHaveBeenCalled();
  });
  it("discards previous-identity drafts before a new signed-in account can edit or save", async () => {
    const old = render();
    change(old, "organization-name", "Private account A draft");
    render({ ...props(), user: null, company: null });
    click(button(old, "Save organization profile"));
    await settle();
    expect(m.from).not.toHaveBeenCalled();
    const next = {
      ...props(),
      user: { id: "account-b", email: "b@example.test" },
      company: { ...company, id: "org-b", owner_user_id: "account-b", name: "Harbor Consulting" },
    };
    render(next);
    const tree = render(next);
    expect(input(tree, "organization-name").props.value).toBe("Harbor Consulting");
    expect(text(tree)).not.toContain("Private account A draft");
  });
  it("cancel discards text and queued logo without any persistence", () => {
    change(render(), "organization-name", "Unsaved name");
    choose(render(), new File(["image"], "logo.png", { type: "image/png" }));
    click(button(render(), "Cancel changes"));
    const tree = render();
    expect(input(tree, "organization-name").props.value).toBe("AOP Consulting");
    expect(text(tree)).toContain("Unsaved changes discarded.");
    expect(m.upload).not.toHaveBeenCalled();
    expect(m.upsert).not.toHaveBeenCalled();
  });
  it("back discards edits and requests the existing overview route", () => {
    change(render(), "organization-address", "Unsaved address");
    click(button(render(), "Back to account"));
    expect(window.location.hash).toBe("overview");
    expect(input(render(), "organization-address").props.value).toBe("10 Oak St");
    expect(m.upsert).not.toHaveBeenCalled();
  });
  it("rejects an empty name before even a queued logo can upload", async () => {
    change(render(), "organization-name", "   ");
    choose(render(), new File(["image"], "logo.png", { type: "image/png" }));
    click(button(render(), "Save organization profile"));
    await settle();
    expect(text(render())).toContain("Organization name is required.");
    expect(m.upload).not.toHaveBeenCalled();
    expect(m.upsert).not.toHaveBeenCalled();
  });
  it.each([
    new File(["not an image"], "note.txt", { type: "text/plain" }),
    new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }),
  ])("rejects invalid logo input without persistence", (file) => {
    choose(render(), file);
    expect(text(render())).toMatch(/Choose an image|under 2 MB/);
    expect(m.upload).not.toHaveBeenCalled();
    expect(m.upsert).not.toHaveBeenCalled();
  });
  it("uploads only on explicit save to a new owner-scoped path, then saves that same path", async () => {
    choose(render(), new File(["image"], "logo.png", { type: "image/png" }));
    expect(m.upload).not.toHaveBeenCalled();
    click(button(render(), "Save organization profile"));
    await settle();
    const path = m.upload.mock.calls[0][0];
    expect(path).toMatch(/^account-a\/logo-[0-9a-f-]+\.png$/);
    expect(path).not.toBe(company.logo_path);
    expect(m.upsert.mock.calls[0][0]).toMatchObject({
      owner_user_id: "account-a",
      logo_path: path,
    });
  });
  it("keeps failed saves visible and drafts intact, without falsely claiming success", async () => {
    m.upsert.mockResolvedValue({ error: { message: "denied" } });
    change(render(), "organization-name", "Draft retained");
    click(button(render(), "Save organization profile"));
    await settle();
    const tree = render();
    expect(text(tree)).toContain("Could not confirm the profile save");
    expect(text(tree)).not.toContain("Organization profile saved.");
    expect(input(tree, "organization-name").props.value).toBe("Draft retained");
    expect(m.refetch).not.toHaveBeenCalled();
    expect(button(tree, "Save organization profile").props.disabled).toBe(false);
  });
  it("leaves the profile unchanged when logo upload fails", async () => {
    m.upload.mockResolvedValue({ error: { message: "upload unavailable" } });
    choose(render(), new File(["image"], "logo.png", { type: "image/png" }));
    click(button(render(), "Save organization profile"));
    await settle();
    expect(m.upsert).not.toHaveBeenCalled();
    expect(text(render())).toContain("Could not confirm the profile save");
    expect(company.logo_path).toBe("account-a/old.png");
  });
  it("does not discard or navigate away from an in-flight save", async () => {
    let finish: () => void = () => {};
    m.upsert.mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve({ error: null });
      }),
    );
    const tree = render();
    click(button(tree, "Save organization profile"));
    click(button(tree, "Cancel changes"));
    click(button(tree, "Back to account"));
    expect(window.location.hash).toBe("");
    expect(button(render(), "Saving…").props.disabled).toBe(true);
    finish();
    await settle();
    expect(text(render())).toContain("Organization profile saved.");
  });
  it("stops after upload if the signed-in identity changes, and prevents duplicate in-flight saves", async () => {
    let finish: () => void = () => {};
    m.upload.mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve({ error: null });
      }),
    );
    choose(render(), new File(["image"], "logo.png", { type: "image/png" }));
    const save = button(render(), "Save organization profile");
    click(save);
    click(save);
    expect(m.upload).toHaveBeenCalledOnce();
    render({ ...props(), user: null, company: null });
    finish();
    await settle();
    expect(m.upsert).not.toHaveBeenCalled();
  });
});

describe("account overview edit target", () => {
  it("names the owner organization on the edit card while retaining the selected workspace in the sidebar", () => {
    const p: AthenaAccountLayoutProps = {
      name: "Owner",
      email: "owner@example.test",
      companyName: "ALP Construction",
      organization: { name: "AOP Consulting", status: "ready" },
      plan: "Contractor Circle",
      seats: "2 of 5",
      teamLoading: false,
      teamError: false,
      canViewSupport: false,
      onSignOut: async () => {},
      profile: null,
      company: null,
      team: null,
      billing: null,
      projects: null,
      briefing: null,
      guide: null,
    };
    m.cursor = 0;
    m.effects = [];
    const tree = AthenaAccountLayout(p);
    const edit = button(tree, "ORGANIZATION PROFILE");
    expect(text(edit)).toContain("AOP Consulting");
    expect(text(edit)).not.toContain("ALP Construction");
    expect(text(tree)).toContain("ALP Construction");
    expect(text(tree)).not.toContain("Manage company profile");
  });
});
