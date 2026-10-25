import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubmittalRecordPayload } from "@/lib/submittal-record-page";

const m = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  refs: [] as { current: unknown }[],
  refCursor: 0,
}));
// Render the real form and its handlers without a DOM. State slots persist
// across explicit rerenders, matching BoardSignIn.test.ts.
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = m.cursor++;
    if (!(index in m.slots)) m.slots[index] = initial;
    return [m.slots[index], (value: unknown) => (m.slots[index] = value)];
  },
  useRef: (initial: unknown) => {
    const index = m.refCursor++;
    if (!(index in m.refs)) m.refs[index] = { current: initial };
    return m.refs[index];
  },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { SubmittalPieceUpload } from "./SubmittalPieceUpload";

const payload = {
  page: "submittal",
  job_id: "11111111-1111-4111-8111-111111111111",
  number: "08 11 13-001",
  current: {
    id: "fictional",
    number: "08 11 13-001",
    revision: 0,
    transmittal_number: 5,
    spec_section: "08 11 13",
    title: "Hollow Metal Doors",
    submittal_type: "product_data",
    status: "in_review",
    ball_in_court: "architect",
    package_items: [
      {
        id: "piece-1",
        kind: "product_data",
        source_party: "Marshall",
        status: "open",
      },
    ],
  },
} as SubmittalRecordPayload;

type Element = ReactElement<Record<string, unknown>>;
function nodes(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...nodes(node.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<Record<string, unknown>>(node)) return text(node.props.children as ReactNode);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}
function render() {
  m.cursor = 0;
  m.refCursor = 0;
  return SubmittalPieceUpload({ payload, onSaved: () => undefined });
}
function button(label: string) {
  return nodes(render()).find((node) => node.type === "button" && text(node) === label);
}
function fileInput() {
  return nodes(render()).find((node) => node.type === "input" && node.props.type === "file")!;
}
function sourceInput() {
  return nodes(render()).find((node) => node.type === "input" && node.props.maxLength === 120)!;
}
function pieceSelect() {
  return nodes(render()).find((node) => node.type === "select")!;
}
function change(node: Element, value: unknown) {
  (node.props.onChange as (event: unknown) => void)({ target: value });
}

beforeEach(() => {
  m.slots = [];
  m.cursor = 0;
  m.refs = [];
  m.refCursor = 0;
});

describe("package piece upload control", () => {
  it("hides the native file input and opens it from Choose PDF", () => {
    const input = fileInput();
    expect(input.props.className).toBe("sr-only");
    expect(input.props.accept).toBe(".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv");
    expect(input.props["aria-labelledby"]).toBe("received-file-label");
    const choose = button("Choose PDF")!;
    expect(choose.props.type).toBe("button");
    expect(choose.props.className).toContain("bg-[#1E5FED]");
    expect(choose.props.className).toContain("text-white");
    expect(choose.props.className).toContain("rounded");
    const click = vi.fn();
    m.refs[0].current = { click };
    (choose.props.onClick as () => void)();
    expect(click).toHaveBeenCalledOnce();
  });

  it("keeps Store disabled until a file is chosen and, for a new piece, the source is filled", () => {
    const store = () => button("Store and attach piece")!;
    expect(store().props.disabled).toBe(true);
    expect(text(render())).toContain("Choose a PDF and enter the source to turn this on.");

    change(fileInput(), { files: [new File(["fictional"], "source.pdf")] });
    expect(text(render())).toContain("source.pdf (9 B)");
    expect(text(render())).not.toContain("Choose a PDF and enter the source");
    expect(text(render())).toContain("Enter the source to turn this on.");
    expect(store().props.disabled).toBe(true);

    change(sourceInput(), { value: "   " });
    expect(store().props.disabled).toBe(true);
    expect(text(render())).toContain("Enter the source to turn this on.");

    change(sourceInput(), { value: "Marshall" });
    expect(store().props.disabled).toBe(false);
    expect(text(render())).not.toContain("to turn this on.");

    change(sourceInput(), { value: "" });
    change(fileInput(), { files: [] });
    change(sourceInput(), { value: "Marshall" });
    expect(store().props.disabled).toBe(true);
    expect(text(render())).toContain("Choose a PDF to turn this on.");
    expect(text(render())).not.toContain("enter the source");
  });

  it("does not require source when attaching to a listed piece", () => {
    change(pieceSelect(), { value: "piece-1" });
    expect(button("Store and attach piece")!.props.disabled).toBe(true);
    expect(text(render())).toContain("Choose a PDF to turn this on.");
    expect(text(render())).not.toContain("enter the source");

    const pdf = new File([new Uint8Array(1536)], "cut.pdf");
    change(fileInput(), { files: [pdf] });
    expect(text(render())).toContain("cut.pdf (1.5 KB)");
    expect(button("Store and attach piece")!.props.disabled).toBe(false);
    expect(text(render())).not.toContain("to turn this on.");
  });

  it("stays disabled while storing and shows no missing-field hint once the form is complete", () => {
    change(fileInput(), { files: [new File(["fictional"], "source.pdf")] });
    change(sourceInput(), { value: "Marshall" });
    m.slots[5] = true;
    const storing = button("Storing…")!;
    expect(storing.props.disabled).toBe(true);
    expect(button("Choose PDF")!.props.disabled).toBe(true);
    expect(text(render())).not.toContain("to turn this on.");
  });
});
