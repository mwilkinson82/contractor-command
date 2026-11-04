import { CARD } from "./palette";

/** Shared by the ChatGPT widget and the finished HTML used by native cards. */
export function responsiveCardCss(hasAlerts: boolean): string {
  const c = CARD;
  return `@media (max-width:520px){
.card,.card *{box-sizing:border-box}
.card{min-width:0;max-width:100%;margin:0 auto}
.card header{padding:14px 14px 12px}
.card h1{font-size:19px}
.card .body{padding:12px 14px;min-width:0}
.card .eyebrow{display:table}
.card .kpis{padding:12px}
.card .kpi{flex-basis:40%}
.card .kpi{min-width:0;max-width:100%}
.card .table-wrap{overflow:visible}
.card .table-wrap table,.card .table-wrap tbody{display:block;width:100%}
.card .table-wrap thead{display:none}
.card .table-wrap tr{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px 14px;margin:0 0 10px;padding:12px;border:1px solid ${c.line};border-radius:10px;color:${c.ink}}
.card .table-wrap td,.card .table-wrap tr.alert td{display:block;min-width:0;width:auto;padding:0;border:0;text-align:left;white-space:normal;overflow-wrap:break-word;box-shadow:none;background:transparent}
.card .table-wrap td.num{white-space:nowrap}
.card .table-wrap td:first-child,.card .table-wrap td.long{grid-column:1/-1}
.card .table-wrap td[data-label]::before{display:block;content:attr(data-label);margin-bottom:2px;color:${c.muted};font-size:11px;font-weight:600}
.card .table-wrap td:first-child::before,.card .table-wrap td.blank{display:none}
${hasAlerts ? `.card .table-wrap tr.alert{border-color:${c.alertLine};background:${c.alertSoft};box-shadow:inset 3px 0 0 ${c.alertInk}}` : ""}
.card .table-wrap tr.callout{border-left:3px solid ${c.action}}
.card .table-wrap .flag-head{display:inline-block;max-width:100%;padding:0;font-size:11px;line-height:1.4;vertical-align:top}
.card .table-wrap .flag-body{margin-top:4px;padding:0;color:${c.ink}}
}`;
}
