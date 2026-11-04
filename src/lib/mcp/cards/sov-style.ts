import { CARD } from "./palette";

/** SOV cards keep their values and actions; the base card style already gives them the clean look. */
export const sovCss = `
.card[data-presentation="sov"] .mark{display:none}
.card[data-presentation="sov"] h1{font-size:18px}
.card[data-presentation="sov"] .kpis{padding:12px 14px}
.card[data-presentation="sov"] td{border-bottom:1px solid ${CARD.rule}}
`;
