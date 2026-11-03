import { GRAY, NAVY, WHITE } from "./palette";

/** Restrained presentation scoped to SOV cards; values and actions remain unchanged. */
export const sovCss = `
#app>.card[data-presentation="sov"]{border-top:1px solid ${GRAY}55}
.card[data-presentation="sov"]{border-color:${GRAY}55}
.card[data-presentation="sov"] header{background:${WHITE};color:${NAVY};border-bottom:1px solid ${GRAY}33;padding:18px 20px 14px}
.card[data-presentation="sov"] .mark{display:none}
.card[data-presentation="sov"] h1{font-size:18px}
.card[data-presentation="sov"] .job{color:${GRAY};opacity:1}
.card[data-presentation="sov"] .body{padding:16px 20px}
.card[data-presentation="sov"] .kpi{border:0;padding:3px 0;min-width:0}
.card[data-presentation="sov"] th{background:${GRAY}12;color:${NAVY};border-bottom:1px solid ${GRAY}55}
.card[data-presentation="sov"] td{border-bottom:1px solid ${GRAY}33}
@media(max-width:520px){.card[data-presentation="sov"] header,.card[data-presentation="sov"] .body{padding:14px 16px}}
`;
