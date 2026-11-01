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
.ath-report-surface .ath-report-tile-value{font-size:clamp(16px,8cqi,20px)!important;white-space:nowrap;overflow-wrap:normal}
`;

export function reportSurface(body: string): string {
  return `<style>${REPORT_SURFACE_CSS}</style><div class="ath-report-surface">${body}</div>`;
}
