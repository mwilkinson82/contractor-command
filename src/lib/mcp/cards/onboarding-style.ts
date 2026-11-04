import { CARD } from "./palette";

/** Scoped to onboarding: a roomier version of the base card. */
const c = CARD;
export const onboardingCss = `
.card[data-presentation="onboarding"]{border-radius:16px}
.card[data-presentation="onboarding"] header{padding:24px 24px 18px}
.card[data-presentation="onboarding"] .mark{color:${c.action};margin:0 0 10px}
.card[data-presentation="onboarding"] h1{font-size:26px;line-height:1.18;letter-spacing:-.025em;max-width:480px}
.card[data-presentation="onboarding"] .job{font-size:14px;line-height:1.5;margin:10px 0 0}
.card[data-presentation="onboarding"] .body{padding:6px 24px 22px}
.card[data-presentation="onboarding"] h2{font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin:20px 0 8px;color:${c.muted}}
.card[data-presentation="onboarding"] ul{list-style:none;margin:0;padding:0}
.card[data-presentation="onboarding"] li{margin:7px 0;line-height:1.5}
.card[data-presentation="onboarding"] .framed{margin:18px 0 0;padding:14px 16px;background:${c.soft};border:1px solid ${c.line};border-radius:12px}
.card[data-presentation="onboarding"] .framed h2{padding:0;border:0;margin:0 0 8px;color:${c.action}}
.card[data-presentation="onboarding"] .framed ul{padding:0}
.card[data-presentation="onboarding"] .framed li{margin:5px 0;font-weight:600}
.card[data-presentation="onboarding"] .chip{border-radius:8px;padding:7px 10px}
.card[data-presentation="onboarding"] .ask{margin:18px 0 0}
.card[data-presentation="onboarding"] .next{font-size:14px;line-height:1.5}
@media(max-width:480px){.card[data-presentation="onboarding"] header{padding:20px 18px 16px}.card[data-presentation="onboarding"] .body{padding:4px 18px 18px}.card[data-presentation="onboarding"] h1{font-size:23px}}
`;
