import { BLUE, GRAY, NAVY, WHITE } from "./palette";

/** Scoped to onboarding. Other Athena cards retain their existing presentation. */
export const onboardingCss = `
.card[data-presentation="onboarding"]{border:1px solid ${NAVY}26;border-top:4px solid ${BLUE};border-radius:18px;box-shadow:0 8px 28px ${NAVY}0a}
.card[data-presentation="onboarding"] header{background:${WHITE};color:${NAVY};padding:24px 24px 18px;border-bottom:1px solid ${NAVY}14}
.card[data-presentation="onboarding"] .mark{color:${BLUE};font-size:11px;letter-spacing:.16em;font-weight:750;margin:0 0 10px;text-transform:uppercase}
.card[data-presentation="onboarding"] h1{margin:0;font-size:28px;line-height:1.16;letter-spacing:-.025em;max-width:460px}
.card[data-presentation="onboarding"] .job{color:${GRAY};font-size:14px;line-height:1.5;margin:10px 0 0}
.card[data-presentation="onboarding"] .body{padding:6px 24px 22px}
.card[data-presentation="onboarding"] h2{font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin:20px 0 8px;color:${GRAY}}
.card[data-presentation="onboarding"] ul{list-style:none;margin:0;padding:0}
.card[data-presentation="onboarding"] li{margin:7px 0;line-height:1.5}
.card[data-presentation="onboarding"] .framed{margin:18px 0 0;padding:14px 16px;background:${NAVY}06;border:1px solid ${NAVY}14;border-radius:12px}
.card[data-presentation="onboarding"] .framed h2{padding:0;border:0;margin:0 0 8px;color:${BLUE}}
.card[data-presentation="onboarding"] .framed ul{padding:0}
.card[data-presentation="onboarding"] .framed li{margin:5px 0;font-weight:600}
.card[data-presentation="onboarding"] .chip{border:1px solid ${NAVY}26;border-radius:8px;padding:7px 10px;font-size:13px;background:${WHITE};margin:0 6px 6px 0}
.card[data-presentation="onboarding"] .ask{background:${BLUE}08;border-left:3px solid ${BLUE};border-radius:0 10px 10px 0;margin:18px 0 0;padding:12px 14px}
.card[data-presentation="onboarding"] .ask strong{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:${BLUE}}
.card[data-presentation="onboarding"] .ask p{margin:5px 0 0}
.card[data-presentation="onboarding"] .next{font-size:14px;line-height:1.5;border-top:1px solid ${NAVY}14;padding-top:14px;margin-top:18px}
@media(max-width:480px){.card[data-presentation="onboarding"] header{padding:20px 18px 16px}.card[data-presentation="onboarding"] .body{padding:4px 18px 18px}.card[data-presentation="onboarding"] h1{font-size:25px}}
`;
