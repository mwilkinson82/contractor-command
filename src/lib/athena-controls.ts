/**
 * One control style for Athena's working surfaces: the schedule toolbar and the estimating workspace.
 * Marshall (Nov 5): controls must read as buttons (hover, pressed, focus), sit inside the surface they drive,
 * and look designed as one piece, not a block of buttons dropped on top. Works without scripts: every state
 * is CSS on native inputs, labels, selects and <details>, so the share page (no scripts) can use it too.
 *
 * Pieces
 * - .ath-seg: segmented control for picking one view. Radio <input class="ath-sr"> + <label> pairs.
 * - .ath-ibtn: square icon button. Give it aria-label and data-tip (the hover tip).
 * - .ath-menu: a <details> menu; .ath-menu-btn is its summary, .ath-menu-box the panel.
 * - .ath-chip: a filter chip around a <select> (caret drawn by .ath-caret), or a toggle around a checkbox.
 *   An active filter (any value but "") gets a navy outline; add .ath-pick for a picker that is never "off".
 */
export const CTL = {
  ink: "#1E3A5F",
  ink2: "#4D6480",
  muted: "#6B7280",
  line: "#DFE7F0",
  lineStrong: "#C9D5E4",
  soft: "#F4F7FB",
  hover: "#EAF0F8",
  pressed: "#1E3A5F",
  focus: "#2563EB",
} as const;

export const ICONS = {
  /** Rectangle with arrows out of the top-right and bottom-left corners. */
  expand: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9"/></svg>`,
  collapse: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 6.5h-4v-4M9.5 6.5l4-4M2.5 9.5h4v4M6.5 9.5l-4 4"/></svg>`,
  columns: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M6 2.5v11M10 2.5v11"/></svg>`,
  layout: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2.5 4h11M2.5 8h7M2.5 12h4"/></svg>`,
  sort: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3v10M2.5 10.5 5 13l2.5-2.5M11 13V3M8.5 5.5 11 3l2.5 2.5"/></svg>`,
  caret: `<svg class="ath-caret" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4 5 6.5 7.5 4"/></svg>`,
  check: `<svg class="ath-check" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.2 5 8.5l4.5-5"/></svg>`,
} as const;

/** The control CSS, scoped under one selector so it never leaks into the host page. */
export function athenaControlsCss(scope: string): string {
  const s = scope;
  const c = CTL;
  return `
${s} .ath-sr{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
${s} .ath-seg{display:inline-flex;gap:2px;padding:3px;border-radius:10px;background:${c.soft};border:1px solid ${c.line};max-width:100%;overflow-x:auto;scrollbar-width:none;flex:0 1 auto}
${s} .ath-seg::-webkit-scrollbar{display:none}
${s} .ath-seg label{display:inline-flex;flex:0 0 auto;align-items:center;height:28px;padding:0 12px;border-radius:7px;color:${c.ink2};font-weight:600;font-size:12.5px;white-space:nowrap;cursor:pointer;user-select:none;transition:background .12s,color .12s,box-shadow .12s}
${s} .ath-seg label:hover{background:#fff;color:${c.ink};box-shadow:0 1px 2px rgba(30,58,95,.10)}
${s} .ath-seg .ath-sr:checked+label{background:${c.pressed};color:#fff;box-shadow:0 1px 3px rgba(30,58,95,.28)}
${s} .ath-seg .ath-sr:focus-visible+label{outline:2px solid ${c.focus};outline-offset:1px}
${s} .ath-ibtn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;border:1px solid ${c.line};background:#fff;color:${c.ink};cursor:pointer;flex:0 0 auto;transition:background .12s,border-color .12s,box-shadow .12s}${s} button.ath-ibtn{min-height:0;padding:0;font:inherit;font-weight:600}${s} .ath-ibtn svg{flex:none}
${s} .ath-ibtn:hover{background:${c.hover};border-color:${c.lineStrong};box-shadow:0 1px 3px rgba(30,58,95,.12)}
${s} .ath-ibtn:active{box-shadow:none;background:${c.line}}
${s} .ath-ibtn:focus-visible,${s} .ath-sr:focus-visible+.ath-ibtn,${s} .ath-menu-btn:focus-visible{outline:2px solid ${c.focus};outline-offset:2px}
${s} [data-tip]:hover::after{content:attr(data-tip);position:absolute;z-index:20;top:calc(100% + 6px);right:0;padding:4px 8px;border-radius:6px;background:${c.ink};color:#fff;font-size:11.5px;font-weight:600;white-space:nowrap;pointer-events:none}
${s} .ath-menu{position:relative;flex:0 0 auto}
${s} .ath-menu>summary{list-style:none}
${s} .ath-menu>summary::-webkit-details-marker{display:none}
${s} .ath-menu-btn{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 10px;border-radius:8px;border:1px solid ${c.line};background:#fff;color:${c.ink};font-weight:600;font-size:12.5px;white-space:nowrap;cursor:pointer;transition:background .12s,border-color .12s,box-shadow .12s}
${s} .ath-menu-btn:hover{background:${c.hover};border-color:${c.lineStrong};box-shadow:0 1px 3px rgba(30,58,95,.12)}
${s} .ath-menu-btn small{color:${c.muted};font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
${s} .ath-menu[open]>.ath-menu-btn,${s} .ath-menu[open]>.ath-ibtn{background:${c.hover};border-color:${c.lineStrong}}
${s} .ath-menu-box{position:absolute;z-index:12;top:calc(100% + 6px);left:0;display:grid;gap:2px;min-width:220px;max-width:min(340px,calc(100vw - 32px));padding:6px;background:#fff;border:1px solid ${c.line};border-radius:10px;box-shadow:0 10px 28px rgba(30,58,95,.16)}
${s} .ath-menu-end .ath-menu-box{left:auto;right:0}
${s} .ath-menu-box>a,${s} .ath-menu-box>label{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:7px;color:${c.ink};font-weight:600;text-decoration:none;cursor:pointer}
${s} .ath-menu-box>a:hover,${s} .ath-menu-box>label:hover{background:${c.hover}}
${s} .ath-menu-box>a[aria-current]{background:${c.soft};box-shadow:inset 3px 0 0 ${c.pressed}}
${s} .ath-menu-box small{display:block;color:${c.muted};font-weight:500}
${s} .ath-menu-box input[type=checkbox]{accent-color:${c.pressed};margin:0}
${s} .ath-menu-title{padding:4px 9px 2px;color:${c.muted};font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
${s} .ath-chip{position:relative;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border-radius:999px;border:1px solid ${c.line};background:#fff;color:${c.ink};font-weight:600;font-size:12.5px;white-space:nowrap;cursor:pointer;flex:0 0 auto;transition:background .12s,border-color .12s,box-shadow .12s}
${s} .ath-chip:hover{background:${c.hover};border-color:${c.lineStrong}}
${s} .ath-chip>span{flex:none;color:${c.muted};font-weight:600}
${s} .ath-chip select{appearance:none;-webkit-appearance:none;border:0;background:transparent;font:inherit;color:inherit;padding:0 16px 0 0;margin:0;min-width:0;cursor:pointer;max-width:200px;text-overflow:ellipsis;field-sizing:content}
${s} .ath-chip select:focus{outline:none}
${s} .ath-chip:focus-within{outline:2px solid ${c.focus};outline-offset:2px}
${s} .ath-chip .ath-caret{position:absolute;right:10px;pointer-events:none;color:${c.ink2}}
${s} .ath-chip:not(.ath-pick):has(option:not([value=""]):checked){border-color:${c.pressed};box-shadow:inset 0 0 0 1px ${c.pressed};background:${c.soft}}
${s} .ath-chip:has(select:disabled){opacity:.55;cursor:default}
${s} .ath-tabs{display:flex;gap:4px;border-bottom:1px solid ${c.line};margin:0 0 14px;overflow-x:auto;scrollbar-width:none}
${s} .ath-tabs::-webkit-scrollbar{display:none}
${s} .ath-tabs label{display:inline-flex;align-items:center;gap:6px;padding:10px 14px;margin-bottom:-1px;border-bottom:3px solid transparent;border-radius:8px 8px 0 0;color:${c.ink2};font-weight:700;font-size:14px;white-space:nowrap;cursor:pointer;transition:background .12s,color .12s}
${s} .ath-tabs label:hover{background:${c.hover};color:${c.ink}}
${s} .ath-tabs label small{color:${c.muted};font-weight:600;font-size:11.5px}
${s} .ath-tog .ath-check{display:none}
${s} .ath-tog:has(input:checked){background:${c.soft};border-color:${c.lineStrong}}
${s} .ath-tog:has(input:checked) .ath-check{display:block;color:${c.pressed}}
${s} .ath-tog:has(input:focus-visible){outline:2px solid ${c.focus};outline-offset:2px}
`;
}
