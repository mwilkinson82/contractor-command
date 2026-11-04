import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { PDFDocument, rgb } from "pdf-lib";
import { takeoffCardHtml } from "../cards/takeoff-card";
import { bytesToBase64 } from "../estimating-sheet";
import { renderPdfiumPage } from "../pdf-renderer";
import { calibrate } from "./geometry";
import { renderTile, tileGrid } from "./pdf";
import { measurementStatus, type EngineSnapshot } from "./state";
import { hostWorkflowSection } from "./host-workflow";
describe("private viewer fixture", () => {
  it("prepares the real resource with known geometry and a host bridge for browser interaction checks", async () => {
    const doc = await PDFDocument.create(),
      page = doc.addPage([720, 360]);
    page.drawRectangle({
      x: 72,
      y: 72,
      width: 540,
      height: 216,
      borderWidth: 2,
      borderColor: rgb(0.4, 0.4, 0.4),
    });
    for (const x of [0.2, 0.4, 0.6])
      page.drawCircle({ x: x * 720, y: 252, size: 7, color: rgb(0.4, 0.4, 0.4) });
    const bytes = await doc.save();
    const png = await renderPdfiumPage(bytes, 0);
    const tiles = tileGrid(720, 360);
    const tilePngs: string[] = [];
    for (const tile of tiles)
      tilePngs.push(
        "data:image/png;base64," + bytesToBase64((await renderTile(bytes, 0, tile)).png),
      );
    // E-100 is page 2 so C1.0 is the first stored sheet, as on the job where E1 opened C1.0.
    const source = "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      space = { source_id: source, source_hash: "a".repeat(64), page: 2, width: 720, height: 360 };
    const cal = {
      ...calibrate(space, {
        region: "Main plan",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        version: 1,
        reference: {
          points: [
            { x: 0.1, y: 0.2 },
            { x: 0.85, y: 0.2 },
          ],
          distance: 75,
          unit: "ft",
        },
        method: "estimator",
        confidence: "high",
        confirmed: true,
      }),
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      source_id: source,
      page: 2,
      width: 720,
      height: 360,
    };
    const lines = [
      {
        id: "line-1",
        line_no: 1,
        item: "Fictional light fixtures",
        unit: "EA",
        qty: 999,
        sheet: "E-100",
        basis: "measured",
        confidence: "low",
        math: "Historical input",
        inputs: [],
      },
      {
        id: "line-2",
        line_no: 2,
        item: "Fictional conduit",
        unit: "LF",
        qty: 999,
        sheet: "E-100",
        basis: "measured",
        confidence: "low",
        math: "Historical input",
        inputs: [],
      },
      {
        id: "line-3",
        line_no: 3,
        item: "Fictional overlapping fixture",
        unit: "EA",
        qty: 999,
        sheet: "E-100",
        basis: "measured",
        confidence: "low",
        math: "Historical input",
        inputs: [],
      },
    ];
    const geometry = [
      {
        id: "00000000-0000-4000-8000-000000000011",
        geometry_id: "00000000-0000-4000-8000-000000000001",
        version: 1,
        line_id: "line-1",
        source_id: source,
        page: 2,
        calibration_id: null,
        shape: {
          kind: "pins",
          points: [
            { x: 0.2, y: 0.3 },
            { x: 0.4, y: 0.3 },
            { x: 0.6, y: 0.3 },
          ],
        },
        measured: 3,
        unit: "EA",
        status: "proposed",
        source: "athena",
        created_at: "2026-10-23T00:00:00Z",
        created_by: "fictional",
        evidence: { confidence: 0.6, verification: "raster-ink-and-topology" },
      },
      {
        id: "00000000-0000-4000-8000-000000000012",
        geometry_id: "00000000-0000-4000-8000-000000000002",
        version: 1,
        line_id: "line-2",
        source_id: source,
        page: 2,
        calibration_id: cal.id,
        shape: {
          kind: "polyline",
          points: [
            { x: 0.1, y: 0.2 },
            { x: 0.85, y: 0.2 },
          ],
        },
        measured: 75,
        unit: "LF",
        status: "accepted",
        source: "estimator",
        created_at: "2026-10-23T00:00:00Z",
        created_by: "fictional",
        evidence: {},
      },
      {
        id: "00000000-0000-4000-8000-000000000013",
        geometry_id: "00000000-0000-4000-8000-000000000003",
        version: 1,
        line_id: "line-3",
        source_id: source,
        page: 2,
        calibration_id: null,
        shape: { kind: "pins", points: [{ x: 0.2, y: 0.3 }] },
        measured: 1,
        unit: "EA",
        status: "proposed",
        source: "athena",
        created_at: "2026-10-23T00:00:00Z",
        created_by: "fictional",
        evidence: {},
      },
    ];
    const state = {
      available: true,
      takeoff_version: 1,
      lines,
      geometry,
      calibrations: [cal],
      passes: [],
      gaps: [],
    } as unknown as EngineSnapshot;
    const sc = {
      available_sources: [
        {
          id: source,
          filename: "Fictional reference drawing.pdf",
          revision: 1,
          sheets: ["C1.0", "E-100"],
        },
      ],
      card: {
        title: "E-100 · Drawing takeoff",
        job: "2701 · Fictional verification job",
        kpis: [
          { label: "Accepted", value: "1" },
          { label: "Proposals", value: "1" },
          { label: "Unlocated", value: "1" },
        ],
        sections: [hostWorkflowSection()],
      },
      engine: { ...state, summary: measurementStatus(state) },
      context: {
        job_number: "2701",
        company_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        source_id: source,
        sheet: "E-100",
      },
      source: {
        id: source,
        filename: "Fictional reference drawing.pdf",
        sheet: "E-100",
        page: 2,
        revision: 1,
        content_hash: "a".repeat(64),
      },
      space,
      tiles,
      preview: "data:image/png;base64," + bytesToBase64(png!),
    };
    const json = JSON.stringify(sc).replace(/</g, "\\u003c");
    const tileJson = JSON.stringify(tilePngs);
    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private Athena takeoff verification</title><style>body{font:14px system-ui;margin:16px;background:#eee}button{padding:10px;margin:4px}iframe{display:block;border:0;width:100%;height:1200px;background:white}#frame{max-width:1100px;margin:auto}pre{white-space:pre-wrap}</style><h1>Private fixture · no production connection</h1><button id="phone">Phone (390px)</button><button id="desktop">Desktop (1100px)</button><button id="narrow">Narrow chat (700px)</button><button id="fail">Fail next save</button><div id="frame"><iframe id="viewer" title="Athena measured takeoff" sandbox="allow-scripts allow-same-origin"></iframe></div><h2>Observed host requests</h2><pre id="calls"></pre><script>var sc=${json},tilePngs=${tileJson.replace(/</g, "\\u003c")},fullSource=sc.source,frame=document.getElementById('viewer'),fail=false;if(location.search.includes('no-sheet')){delete sc.source;delete sc.context.source_id;delete sc.context.sheet}function result(id,data){frame.contentWindow.postMessage({jsonrpc:'2.0',id:id,result:data},location.origin)}document.getElementById('phone').onclick=function(){document.getElementById('frame').style.maxWidth='390px'};document.getElementById('desktop').onclick=function(){document.getElementById('frame').style.maxWidth='1100px'};document.getElementById('narrow').onclick=function(){document.getElementById('frame').style.maxWidth='700px'};document.getElementById('fail').onclick=function(){fail=true};window.addEventListener('message',function(e){if(e.source!==frame.contentWindow)return;var m=e.data;if(m.method==='ui/initialize')result(m.id,{protocolVersion:'2026-07-28',hostCapabilities:{serverTools:{},openLinks:{},message:{}},hostContext:{displayMode:'inline',availableDisplayModes:['inline','fullscreen']}});if(m.method==='ui/notifications/initialized')frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:sc}},location.origin);if(m.method==='ui/notifications/size-changed')frame.style.height=m.params.height+'px';if(m.method==='ui/request-display-mode'){document.getElementById('calls').textContent+=JSON.stringify(m)+'\\n';document.getElementById('frame').style.maxWidth=m.params.mode==='fullscreen'?'1100px':'700px';result(m.id,{mode:m.params.mode})}if(m.method==='ui/message'){document.getElementById('calls').textContent+=JSON.stringify(m)+'\\n';result(m.id,{})}if(m.method==='tools/call'){document.getElementById('calls').textContent+=JSON.stringify(m.params)+'\\n';if(fail){fail=false;result(m.id,{isError:true,content:[{type:'text',text:'The geometry changed. Reload before saving.\\n<!doctype html><html><style>body{color:red}</style>Internal HTML fallback</html>'}]});return}var a=m.params.arguments;if(a.operation==='list'&&a.sheet==='E-100'){sc.source=fullSource;sc.context.source_id=fullSource.id;sc.context.sheet=fullSource.sheet}if(a.operation==='tile'&&a.viewer_tile_only){result(m.id,{structuredContent:{source_id:sc.source.id,source_hash:sc.source.content_hash,sheet:sc.source.sheet,tiles:a.tile_indices.map(function(index){return Object.assign({},sc.tiles[index],{png:tilePngs[index]})})}});return}var g=sc.engine.geometry.find(function(g){return g.geometry_id===a.geometry_id});if(g&&a.operation==='accept'){g.status='accepted';g.version++}if(g&&a.operation==='reject'){g.status='rejected';g.version++}sc.engine.summary.lines[0].status=g&&g.status==='accepted'?'accepted':'proposed';sc.engine.summary.lines[0].accepted=g&&g.status==='accepted'?3:null;sc.engine.summary.lines[0].proposed=g&&g.status==='accepted'?null:3;if(a.operation==='crop')sc.crop={png:sc.preview,point:a.crop_point};result(m.id,{structuredContent:sc,content:[{type:'text',text:'Fixture result'}]})}});frame.srcdoc=${JSON.stringify(takeoffCardHtml()).replace(/</g, "\\u003c")};</script>`;
    mkdirSync("artifacts/takeoff", { recursive: true });
    writeFileSync("artifacts/takeoff/viewer-resource.html", takeoffCardHtml());
    writeFileSync("artifacts/takeoff/viewer.html", html);
    writeFileSync("artifacts/takeoff/viewer-sc.json", JSON.stringify(sc, null, 2));
    expect(html).toContain("no production connection");
    // Zoom detail must come from real per-tile renders, never the stretched page preview.
    expect(tilePngs).toHaveLength(tiles.length);
    expect(tilePngs.every((png) => png !== sc.preview)).toBe(true);
    expect(html).toContain("png:tilePngs[index]");
  });
});
