/**
 * Lookahead timescale on the live schedule page (Marshall, Nov 5): each 1 to 6 week window fits the screen, and
 * the timescale stretches or compresses like Primavera, by dragging the date header sideways or with the
 * Compress, Fit and Expand buttons. The page HTML stays script-free; this redraws only the lookahead section and
 * keeps its picks (window, grouping, code filters, full screen).
 */
export type LookZoom = Partial<Record<number, number>>;

type Win = { w: number; days: number; scale: number; pad: number };

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 6;
const STEP = 1.25;
const MIN_TIMELINE = 300;
const clamp = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

function windows(section: HTMLElement): Win[] {
  const out = new Map<number, Win>();
  section.querySelectorAll<HTMLElement>(".cpm-law[data-w]").forEach((el) => {
    const w = Number(el.dataset.w);
    if (!out.has(w))
      out.set(w, { w, days: Number(el.dataset.days), scale: Number(el.dataset.scale), pad: Number(el.dataset.pad ?? 0) });
  });
  return [...out.values()].filter((x) => x.days > 0 && x.scale > 0);
}

/** The lookahead window on screen now, or null when the tab is hidden. */
function visibleWindow(section: HTMLElement): HTMLElement | null {
  return [...section.querySelectorAll<HTMLElement>(".cpm-law")].find((el) => el.offsetParent !== null) ?? null;
}

/** Zoom that fits every window's timeline beside the frozen table, or null when nothing is on screen. */
export function fitZoom(section: HTMLElement): LookZoom | null {
  const law = visibleWindow(section);
  const scroll = law?.querySelector<HTMLElement>(".cpm-scroll");
  const left = law?.querySelector<HTMLElement>(".cpm-head .cpm-l");
  if (!scroll || !left || scroll.clientWidth < 50) return null;
  // On a narrow screen the timeline keeps a readable width and the table scrolls sideways as the fallback.
  const room = Math.max(MIN_TIMELINE, scroll.clientWidth - left.getBoundingClientRect().width - 2);
  const zoom: LookZoom = {};
  for (const x of windows(section)) zoom[x.w] = clamp((room - x.pad) / (x.days * x.scale));
  return zoom;
}

function scaled(zoom: LookZoom, k: number): LookZoom {
  const out: LookZoom = {};
  for (const [w, z] of Object.entries(zoom)) out[Number(w)] = clamp((z ?? 1) * k);
  return out;
}

/** Inputs keep their state across a redraw: the same ids come back in the new HTML. */
export function saveState(section: HTMLElement) {
  const checked = [...section.querySelectorAll<HTMLInputElement>("input[id]")].map((i) => [i.id, i.checked] as const);
  const selects = [...section.querySelectorAll<HTMLSelectElement>("select[id]")].map((s) => [s.id, s.value] as const);
  const scroll = visibleWindow(section)?.querySelector<HTMLElement>(".cpm-scroll");
  return { checked, selects, top: scroll?.scrollTop ?? 0, left: scroll?.scrollLeft ?? 0, frac: scroll && scroll.scrollWidth ? scroll.scrollLeft / scroll.scrollWidth : 0 };
}

export function restoreState(section: HTMLElement, st: ReturnType<typeof saveState>) {
  for (const [id, on] of st.checked) {
    const el = section.querySelector<HTMLInputElement>(`input[id="${CSS.escape(id)}"]`);
    if (el) el.checked = on;
  }
  for (const [id, v] of st.selects) {
    const el = section.querySelector<HTMLSelectElement>(`select[id="${CSS.escape(id)}"]`);
    if (el) el.value = v;
  }
  const scroll = visibleWindow(section)?.querySelector<HTMLElement>(".cpm-scroll");
  if (scroll) {
    scroll.scrollTop = st.top;
    scroll.scrollLeft = Math.round(st.frac * scroll.scrollWidth);
  }
}

/**
 * Wires the lookahead in `root` (the page embed). `render(zoom)` returns the section's new inner HTML. Returns a
 * cleanup function. Fits on start and on resize until the member zooms by hand; Fit returns to fitting.
 */
export function attachLookaheadZoom(
  root: HTMLElement,
  render: (zoom: LookZoom, only: { w: number; g: string } | null) => string,
): () => void {
  const sectionOf = () => root.querySelector<HTMLElement>('.ath-panel[data-tab="l"]');
  if (!sectionOf()) return () => {};
  root.setAttribute("data-cpm-js", "");
  let zoom: LookZoom = {};
  let fitting = true;
  let frame = 0;
  let pending: LookZoom | null = null;
  let only: { w: number; g: string } | null = null;
  const draw = (z: LookZoom) => {
    const section = sectionOf();
    if (!section) return;
    const st = saveState(section);
    section.innerHTML = render(z, only);
    restoreState(section, st);
    if (drag) section.querySelector(".cpml")?.classList.add("cpml-drag");
    zoom = z;
  };
  const schedule = (z: LookZoom) => {
    pending = z;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (pending) draw(pending);
      pending = null;
    });
  };
  const refit = () => {
    const section = sectionOf();
    if (!section || !fitting) return;
    const z = fitZoom(section);
    if (!z) return;
    const same = Object.entries(z).every(([w, v]) => Math.abs((zoom[Number(w)] ?? 1) - (v ?? 1)) < 0.01);
    if (!same) schedule(z);
  };

  // Drag on the date header: right stretches the timescale, left compresses it and brings the end date in.
  let drag: { x: number; width: number; zoom: LookZoom } | null = null;
  const onDown = (e: PointerEvent) => {
    const t = e.target as Element | null;
    const head = t?.closest?.(".cpml .cpm-head .cpm-t");
    if (!head || e.button !== 0) return;
    const law = head.closest<HTMLElement>(".cpm-law");
    const w = Number(law?.dataset.w);
    const x = windows(sectionOf()!).find((v) => v.w === w);
    if (!x) return;
    e.preventDefault();
    drag = { x: e.clientX, width: x.days * x.scale * (zoom[w] ?? 1), zoom: { ...windowsZoom() } };
    only = { w, g: law?.dataset.g ?? "" };
    head.closest(".cpml")?.classList.add("cpml-drag");
  };
  const windowsZoom = (): LookZoom => {
    const out: LookZoom = {};
    for (const x of windows(sectionOf()!)) out[x.w] = zoom[x.w] ?? 1;
    return out;
  };
  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    fitting = false;
    const k = Math.max(0.15, (drag.width + (e.clientX - drag.x)) / drag.width);
    schedule(scaled(drag.zoom, k));
  };
  const onUp = () => {
    if (!drag) return;
    drag = null;
    only = null;
    cancelAnimationFrame(frame);
    frame = 0;
    draw(pending ?? zoom);
    pending = null;
  };
  const onClick = (e: MouseEvent) => {
    const b = (e.target as Element | null)?.closest?.<HTMLElement>("[data-cpml-zoom]");
    if (!b || !root.contains(b)) return;
    const kind = b.dataset.cpmlZoom;
    if (kind === "fit") {
      fitting = true;
      zoom = {};
      refit();
    } else {
      fitting = false;
      schedule(scaled(windowsZoom(), kind === "in" ? STEP : 1 / STEP));
    }
  };
  // A new window, grouping or full screen changes the room the timeline has.
  const onChange = (e: Event) => {
    const id = (e.target as Element | null)?.id ?? "";
    if (/^(cpml-w|cpml-fs|ath-tab-)/.test(id)) requestAnimationFrame(refit);
  };
  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(refit, 120);
  };
  root.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  window.addEventListener("resize", onResize);
  requestAnimationFrame(refit);
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(resizeTimer);
    root.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    root.removeEventListener("click", onClick);
    root.removeEventListener("change", onChange);
    window.removeEventListener("resize", onResize);
    root.removeAttribute("data-cpm-js");
  };
}
