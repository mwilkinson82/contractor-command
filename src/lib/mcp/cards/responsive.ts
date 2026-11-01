import { ALERT, BLUE, GRAY, NAVY, cssColor } from "./palette";

/** Shared by the ChatGPT widget and the finished HTML used by native cards. */
export function responsiveCardCss(hasAlerts: boolean): string {
  const navy = cssColor(NAVY, "#1E3A5F");
  const blue = cssColor(BLUE, "#1E5FED");
  const gray = cssColor(GRAY, "#6B7280");
  const red = cssColor(ALERT, "#DC2626");
  return `@media (max-width:520px){
.card,.card *{box-sizing:border-box}
.card{min-width:0;max-width:100%;margin:0 auto}
.card header{padding:14px 12px}
.card h1{font-size:20px;overflow-wrap:anywhere}
.card .body{padding:12px;min-width:0}
.card .eyebrow{display:table}
.card .kpi{min-width:0;max-width:100%;overflow-wrap:anywhere}
.card .table-wrap{overflow:visible}
.card .table-wrap table,.card .table-wrap tbody{display:block;width:100%}
.card .table-wrap thead{display:none}
.card .table-wrap tr{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;margin:0 0 12px;padding:12px;border:1px solid ${gray};border-radius:10px;color:${navy}}
.card .table-wrap td,.card .table-wrap tr.alert td{display:block;min-width:0;width:auto;padding:0;border:0;text-align:left;white-space:normal;overflow-wrap:anywhere}
.card .table-wrap td.num{white-space:nowrap;overflow-wrap:normal}
.card .table-wrap td:first-child{grid-column:1/-1}
.card .table-wrap td[data-label]::before{display:block;content:attr(data-label);margin-bottom:3px;color:${gray};font-size:12px;font-weight:400}
.card .table-wrap td:first-child::before,.card .table-wrap td.blank{display:none}
${hasAlerts ? `.card .table-wrap tr.alert{border-color:${red};border-left-width:3px}` : ""}
.card .table-wrap tr.callout{border-left:3px solid ${blue}}
.card .table-wrap .flag-head{display:inline-block;max-width:100%;padding:3px 8px;border-radius:5px;font-size:11px;line-height:1.4;vertical-align:top}
.card .table-wrap .flag-body{margin-top:8px;padding:0;color:${navy}}
}`;
}
