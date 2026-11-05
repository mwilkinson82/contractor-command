/**
 * Timescale drag on the main Schedule tab (Marshall, Nov 5): the same Primavera feel as the lookahead. Grab the
 * date header and drag right to stretch the days, left to compress them and bring the end date in; Compress,
 * Fit and Expand do the same on touch. The page HTML stays script-free; this redraws only the Gantt views, so the
 * view, layout, sort, filters, columns and full screen all stay as the member set them.
 */
import { restoreState, saveState } from "./cpm-lookahead-zoom";

const STEP = 1.25;
const MIN_TIMELINE = 300;
/** The page's own bounds: px per day (see scheduleScale) and the Gantt's 360 px minimum width. */
const MIN_SCALE = 0.3;
const MAX_SCALE = 60;
const MIN_WIDTH = 360;
/** Closest the grabbed point counts from the left edge, so a grab right beside the table can't jump the scale. */
const MIN_GRAB = 120;

const shownView = (gantt: HTMLElement) =>
  [...gantt.querySelectorAll<HTMLElement>(".cpm-views > .cpmv")].find((el) => el.offsetParent !== null) ?? null;

function measure(view: HTMLElement | null) {
  const scroll = view?.querySelector<HTMLElement>(".cpm-scroll");
  const left = view?.querySelector<HTMLElement>(".cpm-head .cpm-l");
  const days = Number(view?.dataset.days);
  const base = Number(view?.dataset.base);
  if (!scroll || !left || !(days > 0) || !(base > 0) || scroll.clientWidth < 50) return null;
  const leftW = left.getBoundingClientRect().width;
  // Below this zoom the timeline would sit at its minimum width and stop following the drag.
  const lo = Math.max(MIN_SCALE / base, MIN_WIDTH / (days * base));
  const hi = MAX_SCALE / base;
  return { scroll, leftW, days, base, clamp: (z: number) => Math.max(lo, Math.min(hi, z)), room: Math.max(MIN_TIMELINE, scroll.clientWidth - leftW - 2) };
}

/**
 * Wires the Schedule tab in `root` (the page embed). `render(zoom, only)` returns the Gantt views' new HTML, only
 * the view named `only` while a drag runs. Returns a cleanup function.
 */
export function attachScheduleZoom(root: HTMLElement, render: (zoom: number, only: string | null) => string): () => void {
  const ganttOf = () => root.querySelector<HTMLElement>('.ath-panel[data-tab="s"] #cpm-gantt');
  if (!ganttOf()?.querySelector(".cpm-views")) return () => {};
  root.setAttribute("data-cpm-js", "");
  let zoom = 1;
  let fitting = false;
  let frame = 0;
  let pending: { z: number; left: number | null } | null = null;
  let only: string | null = null;

  const draw = (z: number, left: number | null) => {
    const gantt = ganttOf();
    const views = gantt?.querySelector<HTMLElement>(".cpm-views");
    if (!gantt || !views) return;
    const st = saveState(views);
    const top = shownView(gantt)?.querySelector<HTMLElement>(".cpm-scroll")?.scrollTop ?? 0;
    views.innerHTML = render(z, only);
    restoreState(views, st);
    const scroll = shownView(gantt)?.querySelector<HTMLElement>(".cpm-scroll");
    if (scroll) {
      scroll.scrollTop = top;
      if (left !== null) scroll.scrollLeft = Math.max(0, left);
    }
    zoom = z;
  };
  const schedule = (z: number, left: number | null) => {
    pending = { z, left };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (pending) draw(pending.z, pending.left);
      pending = null;
    });
  };
  // Fit puts the whole job (or the view's window) beside the table.
  const fit = () => {
    const gantt = ganttOf();
    const mm = gantt && measure(shownView(gantt));
    if (!mm) return;
    const z = mm.clamp(mm.room / (mm.days * mm.base));
    if (Math.abs(z - zoom) / zoom >= 0.005) draw(z, 0);
  };

  // Drag on the date header: the left edge of the screen stays put and the grabbed date follows the pointer.
  let drag: { x: number; grab: number; left: number; zoom: number; clamp: (z: number) => number } | null = null;
  const onDown = (e: PointerEvent) => {
    const head = (e.target as Element | null)?.closest?.("#cpm-gantt .cpm-head .cpm-t");
    if (!head || e.button !== 0) return;
    const gantt = ganttOf();
    const view = gantt && shownView(gantt);
    const mm = measure(view);
    if (!gantt || !view || !mm) return;
    e.preventDefault();
    const rect = mm.scroll.getBoundingClientRect();
    drag = { x: e.clientX, grab: Math.max(MIN_GRAB, e.clientX - rect.left - mm.leftW), left: mm.scroll.scrollLeft, zoom, clamp: mm.clamp };
    only = view.dataset.view ?? null;
    gantt.classList.add("cpm-drag");
  };
  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    fitting = false;
    const k = Math.max(0.02, (drag.grab + (e.clientX - drag.x)) / drag.grab);
    const z = drag.clamp(drag.zoom * k);
    schedule(z, drag.left * (z / drag.zoom));
  };
  const onUp = () => {
    if (!drag) return;
    const last = pending ?? { z: zoom, left: null };
    const scroll = ganttOf() && shownView(ganttOf()!)?.querySelector<HTMLElement>(".cpm-scroll");
    drag = null;
    only = null;
    cancelAnimationFrame(frame);
    frame = 0;
    pending = null;
    draw(last.z, last.left ?? scroll?.scrollLeft ?? null);
    ganttOf()?.classList.remove("cpm-drag");
  };
  const onClick = (e: MouseEvent) => {
    const b = (e.target as Element | null)?.closest?.<HTMLElement>("[data-cpm-zoom]");
    if (!b || !root.contains(b)) return;
    const kind = b.dataset.cpmZoom;
    if (kind === "fit") {
      fitting = true;
      fit();
      return;
    }
    fitting = false;
    const gantt = ganttOf();
    const mm = gantt && measure(shownView(gantt));
    if (!mm) return;
    const z = mm.clamp(zoom * (kind === "in" ? STEP : 1 / STEP));
    // Keep the date at the middle of the screen in place.
    const mid = mm.scroll.scrollLeft + mm.room / 2;
    draw(z, mid * (z / zoom) - mm.room / 2);
  };
  // A new view or full screen changes the room; only a fitted schedule follows it.
  const onChange = (e: Event) => {
    const id = (e.target as Element | null)?.id ?? "";
    if (fitting && /^(cpm-v-|cpm-fs|ath-tab-)/.test(id)) requestAnimationFrame(() => fit());
  };
  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    if (fitting) resizeTimer = window.setTimeout(() => fit(), 120);
  };
  root.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  window.addEventListener("resize", onResize);
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
