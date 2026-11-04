/** Shared by injected report bodies and standalone share documents. No page-level clipping. */
export const REPORT_SURFACE_CSS = `
.ath-report-surface{min-width:0;max-width:100%;overflow-wrap:anywhere}
.ath-report-surface *{box-sizing:border-box;min-width:0}
.ath-report-surface img{max-width:100%;height:auto}
.ath-report-surface .ath-report-table-scroll{max-width:100%;overflow-x:auto;overscroll-behavior-x:contain}
.ath-report-surface .ath-report-table-scroll:focus-visible,.ath-report-surface .ath-cpm-scroll:focus-visible{outline:2px solid #1E5FED;outline-offset:3px}
.ath-report-surface .ath-report-table-scroll table{min-width:36rem}
.ath-report-surface .ath-report-table-scroll th{overflow-wrap:normal;word-break:normal;white-space:nowrap}
.ath-report-surface .ath-report-amount{white-space:nowrap;overflow-wrap:normal}
.ath-report-surface .ath-report-tile{container-type:inline-size;flex-basis:14rem!important}
.ath-report-surface .ath-report-page{max-width:1440px;margin:0 auto;padding:24px clamp(16px,3vw,40px) 40px;font:14px/1.55 "Archivo",Arial,system-ui,sans-serif}
.ath-report-surface .ath-report-title{font-size:clamp(22px,2.6vw,30px);line-height:1.2;font-weight:700;letter-spacing:-.02em}
.ath-report-surface .ath-field-page{font-family:"Archivo",Arial,system-ui,sans-serif!important}
@media(min-width:760px){.ath-report-surface .ath-field-wide{max-width:1440px!important;padding:24px clamp(16px,3vw,40px) 40px!important}.ath-report-surface .ath-field-wide .ath-field-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;align-items:start;margin:0 0 16px}.ath-report-surface .ath-field-wide .ath-field-grid>section>section{margin:0!important}}
@media(min-width:1200px){.ath-report-surface .ath-record-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,420px);gap:20px;align-items:start}}
.ath-report-surface .ath-report-tile-value{font-size:clamp(16px,8cqi,20px)!important;white-space:nowrap;overflow-wrap:normal}
`;

export function reportSurface(body: string): string {
  return `<style>${REPORT_SURFACE_CSS}</style><div class="ath-report-surface">${body}</div>`;
}
