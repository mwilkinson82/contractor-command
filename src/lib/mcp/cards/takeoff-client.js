(function () {
  "use strict";
  var root = document.getElementById("app"),
    status = document.getElementById("status"),
    ready = false,
    origin = null,
    host = {},
    hostContext = {},
    seq = 10,
    pending = new Map(),
    sc = null,
    localResult = false,
    busy = false,
    reading = false,
    zoom = 1,
    selectedLine = null,
    selectedCalibration = null,
    selectedGeometry = null,
    mode = "inspect",
    draft = [],
    holes = [],
    activeHole = -1,
    drag = null,
    selectedPoint = -1,
    observer,
    refreshDrawing = null,
    lastWidth = 0,
    statusFilter = "all";
  function node(tag, text, cls) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = String(text);
    if (cls) e.className = cls;
    return e;
  }
  function send(m) {
    window.parent.postMessage(
      Object.assign({ jsonrpc: "2.0" }, m),
      origin && origin !== "null" ? origin : "*",
    );
  }
  function size() {
    if (ready)
      send({
        method: "ui/notifications/size-changed",
        params: { height: Math.ceil(document.body.scrollHeight) },
      });
  }
  function button(label, fn, cls) {
    var b = node("button", label, cls);
    b.type = "button";
    b.disabled = busy;
    b.addEventListener("click", fn);
    return b;
  }
  function notice(text) {
    status.textContent = text;
    size();
  }
  function rpc(method, params, timeout) {
    return new Promise(function (resolve, reject) {
      var id = ++seq,
        timer = setTimeout(function () {
          pending.delete(id);
          reject(Error("No saved result was confirmed. Reload before retrying."));
        }, timeout || 90000);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      send({ id: id, method: method, params: params });
    });
  }
  function call(name, args) {
    if (!host.serverTools)
      return Promise.reject(
        Error("This host has not enabled measurement controls. Use the same operations in chat."),
      );
    return rpc("tools/call", { name: name, arguments: args });
  }
  function context() {
    return {
      job_number: sc.context.job_number,
      company_id: sc.context.company_id,
      source_id: sc.context.source_id,
      sheet: sc.context.sheet,
    };
  }
  function args(extra) {
    return Object.assign(context(), extra);
  }
  function failureText(result) {
    return (
      ((result && result.content) || [])
        .filter(function (c) {
          return c.type === "text" && typeof c.text === "string";
        })
        .map(function (c) {
          // Legacy error cards include an HTML fallback after their factual text.
          // A status label must never print that document's source to the member.
          return c.text.split(/<!doctype html/i)[0].trim();
        })
        .filter(Boolean)
        .join("\n")
        .slice(0, 2000) || "The operation was not confirmed. Reload before retrying."
    );
  }
  function takeoffData(result) {
    var data = result && result.structuredContent;
    if (!data || !data.engine) return null;
    var view = result._meta && result._meta["athena/takeoffView"];
    return Object.assign(
      {},
      data,
      view && typeof view.preview === "string" ? { preview: view.preview } : {},
    );
  }
  async function act(name, extra) {
    if (busy) return;
    busy = true;
    notice("Working…");
    try {
      var r = await call(name, args(extra));
      var data = takeoffData(r);
      if (!r || r.isError || !data) throw Error(failureText(r));
      localResult = true;
      sc = data;
      if (sc.saved_calibration && sc.saved_calibration.id)
        selectedCalibration = sc.saved_calibration.id;
      draft = [];
      holes = [];
      mode = "inspect";
      draw();
      notice("Saved result loaded.");
      return true;
    } catch (e) {
      notice(e.message);
      return false;
    } finally {
      busy = false;
      root.querySelectorAll("button").forEach(function (b) {
        b.disabled = false;
      });
      size();
    }
  }
  function readPasses(data, lineNo, calibration) {
    var line = data.engine.lines.find(function (l) {
      return l.line_no === lineNo;
    });
    if (!line) return [];
    var count = /^(ea|each)$/i.test(line.unit || "");
    return data.engine.passes.filter(function (p) {
      var s = p.pass_summary;
      return (
        p.source_id === data.source.id &&
        p.page === data.source.page &&
        s.line_no === lineNo &&
        s.takeoff_version === data.engine.takeoff_version &&
        s.source_hash === data.source.content_hash &&
        (count
          ? s.count_area && s.count_area.confirmed
          : calibration && s.calibration_id === calibration)
      );
    });
  }
  function freshReadArguments(data, lineNo, calibration) {
    var pass = readPasses(data, lineNo, calibration)[0];
    var line = data.engine.lines.find(function (l) {
      return l.line_no === lineNo;
    });
    if (!pass || !line)
      throw Error("Confirm the current plan area or calibration before starting a fresh read.");
    if (
      data.engine.geometry.some(function (g) {
        return (
          g.line_id === line.id &&
          g.source_id === data.source.id &&
          g.page === data.source.page &&
          g.status !== "rejected"
        );
      })
    )
      throw Error("Review or reject this line's geometry before starting a fresh read.");
    if (/^(ea|each)$/i.test(line.unit || ""))
      return {
        operation: "scope",
        source_id: data.source.id,
        sheet: data.source.sheet,
        line_no: lineNo,
        confirm: true,
        count_area: {
          name: pass.pass_summary.count_area.name,
          bounds: pass.pass_summary.count_area.bounds,
        },
      };
    return {
      operation: "propose",
      source_id: data.source.id,
      sheet: data.source.sheet,
      line_no: lineNo,
      calibration_id: calibration,
    };
  }
  function reviewableProposal(data, geometry) {
    return (
      geometry.status === "proposed" &&
      geometry.evidence &&
      geometry.evidence.verification === "raster-ink-and-topology" &&
      (!geometry.evidence.pass_id ||
        data.engine.passes.some(function (p) {
          return (
            p.pass_summary.pass_id === geometry.evidence.pass_id &&
            p.pass_summary.complete &&
            (geometry.shape.kind !== "pins" ||
              (p.pass_summary.count_area && p.pass_summary.count_area.confirmed))
          );
        }))
    );
  }
  function confirmBox(text, fn) {
    var old = root.querySelector(".confirmation");
    if (old) old.remove();
    var box = node("div", null, "confirmation");
    box.append(
      node("p", text),
      button(
        "Confirm",
        function () {
          box.remove();
          fn();
        },
        "primary",
      ),
      button("Cancel", function () {
        box.remove();
        size();
      }),
    );
    root.prepend(box);
    size();
  }
  function svgNode(tag, attrs) {
    var e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.keys(attrs || {}).forEach(function (k) {
      e.setAttribute(k, String(attrs[k]));
    });
    return e;
  }
  function validPoint(p) {
    return (
      p &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      p.x >= 0 &&
      p.x <= 1 &&
      p.y >= 0 &&
      p.y <= 1
    );
  }
  function rows() {
    return sc.engine.geometry
      .filter(function (g) {
        return (
          g.source_id === sc.context.source_id &&
          g.page === sc.source.page &&
          (statusFilter === "rejected" ? g.status === "rejected" : g.status !== "rejected") &&
          g.shape.kind !== "not_drawable"
        );
      })
      .sort(function (a, b) {
        return a.geometry_id.localeCompare(b.geometry_id);
      });
  }
  function currentCal() {
    var sel = root.querySelector("#calibration");
    return sc.engine.calibrations.find(function (c) {
      return c.id === (sel && sel.value);
    });
  }
  function previewValue(shape) {
    try {
      if (shape.kind === "pins") return shape.points.length + " EA";
      var c = currentCal();
      if (!c || !c.confirmed) return "Calibration needed";
      var p = shape.points,
        w = sc.space.width,
        h = sc.space.height,
        k = Number(c.feet_per_point);
      if (shape.kind === "polyline") {
        var l = 0;
        for (var i = 1; i < p.length; i++)
          l += Math.hypot((p[i].x - p[i - 1].x) * w, (p[i].y - p[i - 1].y) * h) * k;
        return l.toFixed(2) + " LF";
      }
      function area(a) {
        var v = 0;
        a.forEach(function (q, i) {
          var r = a[(i + 1) % a.length];
          v += q.x * r.y - r.x * q.y;
        });
        return (Math.abs(v) * w * h * k * k) / 2;
      }
      var a =
        shape.kind === "rect"
          ? Math.abs((p[1].x - p[0].x) * (p[1].y - p[0].y)) * w * h * k * k
          : area(p);
      (shape.holes || []).forEach(function (h) {
        a -= area(h);
      });
      if (shape.depth) {
        var d =
          shape.depth.value * { ft: 1, in: 1 / 12, m: 1 / 0.3048, mm: 1 / 304.8 }[shape.depth.unit];
        return ((a * d) / 27).toFixed(2) + " CY";
      }
      return a.toFixed(2) + " SF";
    } catch (_) {
      return "Complete the geometry";
    }
  }
  function draw() {
    refreshDrawing = null;
    if (!sc || !sc.engine) {
      root.replaceChildren(node("header", (sc && sc.card && sc.card.title) || "Drawing takeoff"));
      var fallback = node("main");
      if (sc && sc.card)
        (sc.card.sections || []).forEach(function (section) {
          fallback.append(node("h2", section.heading));
          (section.rows || []).forEach(function (r) {
            fallback.append(node("p", (r.cells || []).join(" · ")));
          });
        });
      else
        fallback.append(
          node(
            "p",
            "This result did not include a measured takeoff. The factual reply remains in the conversation.",
          ),
        );
      root.append(fallback);
      size();
      return;
    }
    root.replaceChildren();
    var head = node("header");
    head.append(node("p", "ATHENA", "brand"), node("h1", sc.card.title), node("p", sc.card.job));
    root.append(head);
    if ((hostContext.availableDisplayModes || []).includes("fullscreen"))
      head.append(
        button(
          hostContext.displayMode === "fullscreen" ? "Back to chat" : "Expand drawing workspace",
          async function () {
            var requested = hostContext.displayMode === "fullscreen" ? "inline" : "fullscreen";
            if (!(hostContext.availableDisplayModes || []).includes(requested)) return;
            try {
              var result = await rpc("ui/request-display-mode", { mode: requested }, 15000);
              hostContext.displayMode = result.mode;
              draw();
              notice(result.mode === requested ? "" : "The host kept the current display size.");
            } catch (_) {
              notice("The host could not expand this workspace. Your saved takeoff is unchanged.");
            }
          },
        ),
      );
    var main = node("main");
    root.append(main);
    var kpis = node("div", null, "kpis");
    (sc.card.kpis || []).forEach(function (k) {
      var d = node("div");
      d.append(node("span", k.label), node("strong", k.value));
      kpis.append(d);
    });
    main.append(kpis);
    var workflow = (sc.card.sections || []).find(function (section) {
      return section.heading === "Before your AI reads the drawings";
    });
    if (workflow && workflow.rows && workflow.rows[0])
      main.append(node("p", workflow.rows[0].cells.join(" "), "note"));
    function extraSections(target) {
      (sc.card.sections || [])
        .filter(function (section) {
          return section.heading !== "Measured takeoff";
        })
        .forEach(function (section) {
          var block = node("section");
          block.append(node("h2", section.heading));
          (section.rows || []).forEach(function (row) {
            var line = node(
              "div",
              null,
              "row" +
                (row.flag === "risk" || row.flag === "delay" || row.flag === "overdue"
                  ? " risk"
                  : ""),
            );
            if (row.flag) line.dataset.alert = row.flag;
            if (row.href) {
              line.append(
                button(row.cells[0] || "Open private file", function () {
                  openPrivateFile(row.href);
                }),
              );
            } else
              (row.cells || []).forEach(function (cell, i) {
                line.append(
                  node(
                    i === 0 ? "strong" : "p",
                    (section.columns && section.columns[i] ? section.columns[i] + ": " : "") + cell,
                  ),
                );
              });
            block.append(line);
          });
          target.append(block);
        });
    }
    function openPrivateFile(href) {
      var u;
      try {
        u = new URL(href);
      } catch (_) {
        return notice("The private file link is invalid.");
      }
      if (
        u.protocol !== "https:" ||
        !u.hostname.endsWith(".supabase.co") ||
        u.username ||
        u.password ||
        u.pathname.indexOf(
          "/storage/v1/object/sign/athena-files/" +
            sc.context.company_id +
            "/" +
            sc.context.job_id +
            "/",
        ) !== 0
      )
        return notice("Use the private download link in the conversation.");
      send({ id: ++seq, method: "ui/open-link", params: { url: u.href } });
    }
    if (!sc.source) {
      extraSections(main);
      main.append(
        node("p", "Choose a stored sheet. Saved quantities remain unlocated until measured."),
      );
      var pick = node("select"),
        sheetPick = node("select");
      pick.ariaLabel = "Stored drawing set";
      sheetPick.ariaLabel = "Sheet to measure";
      (sc.available_sources || []).forEach(function (s) {
        var o = node("option", s.filename + " · revision " + s.revision);
        o.value = s.id;
        pick.append(o);
      });
      function populate() {
        sheetPick.replaceChildren();
        var s = (sc.available_sources || []).find(function (s) {
          return s.id === pick.value;
        });
        ((s && s.sheets) || []).forEach(function (n) {
          var o = node("option", n);
          o.value = n;
          sheetPick.append(o);
        });
      }
      pick.addEventListener("change", populate);
      populate();
      main.append(
        pick,
        sheetPick,
        button("Open stored sheet", function () {
          act("takeoff_geometry", {
            operation: "list",
            source_id: pick.value,
            sheet: sheetPick.value,
          });
        }),
      );
      sc.engine.summary.lines.forEach(function (l) {
        main.append(node("p", "L" + l.line_no + " · " + l.item + " · " + l.status));
      });
      size();
      return;
    }
    main.append(
      node(
        "p",
        sc.source.filename + " · " + sc.source.sheet + " · revision " + sc.source.revision,
        "small",
      ),
      node("p", "Original preserved · dated versions only", "note small"),
    );
    var sourceTools = node("div", null, "tools"),
      sourceSelect = node("select"),
      sheetSelect = node("select");
    sourceSelect.ariaLabel = "Stored drawing revision";
    sheetSelect.ariaLabel = "Stored sheet";
    (sc.available_sources || []).forEach(function (s) {
      var o = node("option", s.filename + " · revision " + s.revision);
      o.value = s.id;
      sourceSelect.append(o);
    });
    sourceSelect.value = sc.source.id;
    function sheetOptions() {
      sheetSelect.replaceChildren();
      var s = (sc.available_sources || []).find(function (s) {
        return s.id === sourceSelect.value;
      });
      ((s && s.sheets) || [sc.source.sheet]).forEach(function (n) {
        var o = node("option", n);
        o.value = n;
        sheetSelect.append(o);
      });
      sheetSelect.value = sc.source.sheet;
    }
    sourceSelect.addEventListener("change", sheetOptions);
    sheetOptions();
    sourceTools.append(
      sourceSelect,
      sheetSelect,
      button("Open stored sheet", function () {
        act("takeoff_geometry", {
          operation: "list",
          source_id: sourceSelect.value,
          sheet: sheetSelect.value,
        });
      }),
    );
    main.append(sourceTools);
    var layout = node("div", null, "layout"),
      left = node("section"),
      right = node("section");
    layout.append(left, right);
    main.append(layout);
    var viewWidth = 1000,
      viewHeight = (1000 * sc.space.height) / sc.space.width;
    var tools = node("div", null, "tools"),
      viewport = node("div", null, "viewport"),
      surface = node("div", null, "surface"),
      img = node("img"),
      svg = svgNode("svg", {
        viewBox: "0 0 " + viewWidth + " " + viewHeight,
        preserveAspectRatio: "none",
        "aria-label": "Measured geometry on the stored sheet",
      });
    img.alt = "Original stored " + sc.source.sheet;
    if (
      typeof sc.preview === "string" &&
      /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sc.preview)
    )
      img.src = sc.preview;
    img.addEventListener("load", size);
    surface.append(img, svg);
    viewport.append(surface);
    viewport.tabIndex = 0;
    viewport.ariaLabel = "Drawing. Zoom then scroll to pan.";
    function setZoom(v) {
      zoom = Math.max(1, Math.min(8, v));
      surface.style.width = zoom * 100 + "%";
      if (svg.isConnected) overlay();
      size();
    }
    setZoom(zoom);
    tools.append(
      button("Zoom in", function () {
        setZoom(zoom + 0.5);
      }),
      button("Zoom out", function () {
        setZoom(zoom - 0.5);
      }),
      button("Fit", function () {
        setZoom(1);
      }),
    );
    var tileSelect = node("select");
    tileSelect.ariaLabel = "Readable 200 dpi tile";
    (sc.tiles || []).forEach(function (t) {
      var o = node("option", "200 dpi region " + (t.index + 1));
      o.value = t.index;
      tileSelect.append(o);
    });
    tools.append(
      tileSelect,
      button("Read region", function () {
        act("takeoff_geometry", { operation: "tile", tile_index: Number(tileSelect.value) });
      }),
    );
    left.append(tools, viewport);
    if (sc.tile && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sc.tile.png)) {
      var tileImg = svgNode("image", {
        href: sc.tile.png,
        x: sc.tile.bounds.x * viewWidth,
        y: sc.tile.bounds.y * viewHeight,
        width: sc.tile.bounds.width * viewWidth,
        height: sc.tile.bounds.height * viewHeight,
        preserveAspectRatio: "none",
      });
      svg.prepend(tileImg);
    }
    function chooseGeometry(id, index) {
      var g = rows().find(function (g) {
        return g.geometry_id === id;
      });
      if (!g) return;
      selectedGeometry = id;
      selectedPoint = index;
      var line = sc.engine.lines.find(function (l) {
        return l.id === g.line_id;
      });
      if (line) {
        selectedLine = String(line.line_no);
        lineSelect.value = selectedLine;
      }
      if (g.calibration_id) cal.value = g.calibration_id;
      selectedCalibration = cal.value;
      mode = "inspect";
      draft = [];
      holes = [];
      showSelected();
      showReadStatus();
    }
    function geometry(shape, color, fill, id, offset) {
      if (!shape || !Array.isArray(shape.points) || !shape.points.every(validPoint)) return;
      var ps = shape.points,
        unit = viewWidth / Math.max(1, surface.getBoundingClientRect().width);
      if (shape.kind === "pins")
        ps.forEach(function (p, i) {
          var c = svgNode("circle", {
            cx: p.x * viewWidth,
            cy: p.y * viewHeight,
            r: 8 * unit,
            stroke: color,
            fill: fill,
            "stroke-width": 1.3,
            "vector-effect": "non-scaling-stroke",
          });
          c.addEventListener("pointerdown", function (e) {
            if (id && mode === "inspect") {
              chooseGeometry(id, i);
              drag = { index: i };
              e.stopPropagation();
              svg.setPointerCapture(e.pointerId);
            }
          });
          svg.append(c);
          var number = svgNode("text", {
            x: p.x * viewWidth,
            y: p.y * viewHeight,
            "font-size": 10 * unit,
            "text-anchor": "middle",
            "dominant-baseline": "central",
            fill: fill === "#1E5FED" ? "white" : color,
            "pointer-events": "none",
          });
          number.textContent = String((offset || 0) + i + 1);
          svg.append(number);
        });
      else {
        var rings = [ps];
        if (shape.kind === "rect" && ps.length === 2)
          rings = [[ps[0], { x: ps[1].x, y: ps[0].y }, ps[1], { x: ps[0].x, y: ps[1].y }]];
        rings = rings.concat(shape.holes || []);
        var d = rings
          .map(function (r) {
            return (
              r
                .map(function (p, i) {
                  return (i ? "L" : "M") + p.x * viewWidth + " " + p.y * viewHeight;
                })
                .join(" ") + (shape.kind === "polyline" ? "" : " Z")
            );
          })
          .join(" ");
        var path = svgNode("path", {
          d: d,
          stroke: color,
          fill: shape.kind === "polyline" ? "none" : fill,
          "fill-opacity": 0.18,
          "fill-rule": "evenodd",
          "stroke-width": 2,
          "vector-effect": "non-scaling-stroke",
        });
        path.addEventListener("click", function (e) {
          if (id) {
            chooseGeometry(id, 0);
            overlay();
            e.stopPropagation();
          }
        });
        svg.append(path);
        if (id && id === selectedGeometry)
          [{ points: ps, hole: null }]
            .concat(
              (shape.holes || []).map(function (h, i) {
                return { points: h, hole: i };
              }),
            )
            .forEach(function (ring) {
              ring.points.forEach(function (p, i) {
                var c = svgNode("circle", {
                  cx: p.x * viewWidth,
                  cy: p.y * viewHeight,
                  r: 5 * unit,
                  fill: "white",
                  stroke: color,
                });
                c.addEventListener("pointerdown", function (e) {
                  drag = { index: i, hole: ring.hole };
                  selectedPoint = i;
                  e.stopPropagation();
                  svg.setPointerCapture(e.pointerId);
                });
                svg.append(c);
              });
            });
      }
    }
    function overlay() {
      svg.querySelectorAll("circle,path,text").forEach(function (e) {
        e.remove();
      });
      var pinNumbers = {};
      rows().forEach(function (g) {
        var offset = pinNumbers[g.line_id] || 0;
        geometry(
          g.shape,
          g.status === "rejected" ? "#6B7280" : "#1E5FED",
          g.status === "accepted" ? "#1E5FED" : "white",
          g.geometry_id,
          offset,
        );
        if (g.shape.kind === "pins") pinNumbers[g.line_id] = offset + g.shape.points.length;
        var p = g.shape.points[0],
          l = sc.engine.lines.find(function (l) {
            return l.id === g.line_id;
          });
        if (p) {
          var t = svgNode("text", {
            x:
              p.x * viewWidth +
              (11 * viewWidth) / Math.max(1, surface.getBoundingClientRect().width),
            y:
              p.y * viewHeight -
              (11 * viewWidth) / Math.max(1, surface.getBoundingClientRect().width),
            fill: "#1E3A5F",
            "font-size": (12 * viewWidth) / Math.max(1, surface.getBoundingClientRect().width),
          });
          t.textContent =
            "L" + (l && l.line_no) + " · " + Number(g.measured).toFixed(2) + " " + g.unit;
          svg.append(t);
        }
      });
      if (draft.length)
        geometry(
          { kind: mode === "calibrate" ? "polyline" : mode, points: draft, holes: holes },
          "#1E3A5F",
          "white",
          null,
        );
    }
    refreshDrawing = overlay;
    overlay();
    function pointAt(e) {
      var b = svg.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)),
        y: Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)),
      };
    }
    svg.addEventListener("click", function (e) {
      if (window.innerWidth < 768 || busy || mode === "inspect") return;
      var p = pointAt(e);
      if (activeHole >= 0) holes[activeHole].push(p);
      else if (mode === "rect" || mode === "calibrate") {
        if (draft.length === 2) draft = [];
        draft.push(p);
      } else draft.push(p);
      overlay();
      showPreview();
    });
    svg.addEventListener("pointermove", function (e) {
      if (!drag || window.innerWidth < 768 || busy) return;
      var g = rows().find(function (g) {
        return g.geometry_id === selectedGeometry;
      });
      if (!g) return;
      if (!draft.length) {
        draft = JSON.parse(JSON.stringify(g.shape.points));
        holes = JSON.parse(JSON.stringify(g.shape.holes || []));
        mode = g.shape.kind;
      }
      if (drag.hole != null) holes[drag.hole][drag.index] = pointAt(e);
      else draft[drag.index] = pointAt(e);
      overlay();
      showPreview();
    });
    svg.addEventListener("pointerup", function () {
      if (drag) {
        drag = null;
        showSelected();
      }
    });
    var edit = node("div", null, "desktop drawer"),
      lineSelect = node("select");
    lineSelect.ariaLabel = "Takeoff line";
    sc.engine.lines.forEach(function (l) {
      var o = node("option", "L" + l.line_no + " · " + l.item);
      o.value = l.line_no;
      lineSelect.append(o);
    });
    if (selectedLine) lineSelect.value = selectedLine;
    lineSelect.addEventListener("change", function () {
      reading = false;
      selectedLine = lineSelect.value;
      selectedGeometry = null;
      selectedPoint = -1;
      draft = [];
      holes = [];
      mode = "inspect";
      showSelected();
      overlay();
      showReadStatus();
    });
    selectedLine = lineSelect.value;
    var cal = node("select");
    cal.id = "calibration";
    cal.ariaLabel = "Calibration region";
    var empty = node("option", "Choose calibration");
    empty.value = "";
    cal.append(empty);
    sc.engine.calibrations
      .filter(function (c) {
        return c.source_id === sc.source.id && c.page === sc.source.page;
      })
      .forEach(function (c) {
        var o = node(
          "option",
          c.region + " · v" + c.version + (c.confirmed ? "" : " · unconfirmed"),
        );
        o.value = c.id;
        cal.append(o);
      });
    if (
      selectedCalibration !== null &&
      Array.from(cal.options).some(function (o) {
        return o.value === selectedCalibration;
      })
    )
      cal.value = selectedCalibration;
    else if (cal.options.length === 2) cal.selectedIndex = 1;
    selectedCalibration = cal.value;
    var modes = node("div", null, "tools");
    ["pins", "polyline", "polygon", "rect", "calibrate"].forEach(function (m) {
      modes.append(
        button(
          {
            pins: "Count pins",
            polyline: "Draw run",
            polygon: "Draw area",
            rect: "Rectangle",
            calibrate: "Calibrate",
          }[m],
          function () {
            mode = m;
            draft = [];
            holes = [];
            activeHole = -1;
            selectedGeometry = null;
            notice("Place " + m + " points on the sheet.");
            overlay();
          },
        ),
      );
    });
    var preview = node("p", null, "note");
    function showPreview() {
      preview.textContent =
        "Unsaved preview: " +
        (mode === "calibrate"
          ? draft.length + " of 2 reference points"
          : previewValue({ kind: mode, points: draft, holes: holes })) +
        " · Server confirms on save.";
    }
    cal.addEventListener("change", function () {
      reading = false;
      selectedCalibration = cal.value;
      showPreview();
      showReadStatus();
    });
    var detail = node("input");
    detail.placeholder = "Depth citation: detail or note";
    detail.ariaLabel = "Depth citation";
    var depthSource = node("select"),
      depthSheet = node("select"),
      depthUnit = node("select");
    depthSource.ariaLabel = "Depth source drawing";
    depthSheet.ariaLabel = "Depth citation sheet";
    depthUnit.ariaLabel = "Depth unit";
    (sc.available_sources || []).forEach(function (source) {
      var o = node("option", source.filename);
      o.value = source.id;
      depthSource.append(o);
    });
    depthSource.value = sc.source.id;
    function depthSheets() {
      depthSheet.replaceChildren();
      var source = (sc.available_sources || []).find(function (source) {
        return source.id === depthSource.value;
      });
      ((source && source.sheets) || [sc.source.sheet]).forEach(function (n) {
        var o = node("option", n);
        o.value = n;
        depthSheet.append(o);
      });
    }
    depthSource.addEventListener("change", depthSheets);
    depthSheets();
    ["in", "ft", "m", "mm"].forEach(function (u) {
      var o = node("option", u);
      o.value = u;
      depthUnit.append(o);
    });
    var depthValue = node("input");
    depthValue.type = "number";
    depthValue.min = "0";
    depthValue.placeholder = "Cited depth (CY only)";
    depthValue.ariaLabel = "Concrete depth";
    left.append(node("h2", "Choose takeoff line"), lineSelect, cal);
    edit.append(
      node("h2", "Locate work"),
      modes,
      preview,
      depthValue,
      depthUnit,
      depthSource,
      depthSheet,
      detail,
    );
    edit.append(
      button("Add opening", function () {
        if (mode !== "polygon" && mode !== "rect") return notice("Draw an area first.");
        holes.push([]);
        activeHole = holes.length - 1;
        notice("Place the opening vertices, then Finish opening.");
      }),
      button("Finish opening", function () {
        activeHole = -1;
        notice("Opening boundary completed. Server checks containment.");
      }),
      button("Undo point", function () {
        if (activeHole >= 0) holes[activeHole].pop();
        else draft.pop();
        overlay();
        showPreview();
      }),
    );
    edit.append(
      button(
        "Save geometry proposal",
        function () {
          var old = rows().find(function (g) {
              return g.geometry_id === selectedGeometry;
            }),
            shape = { kind: mode, points: draft, holes: holes };
          if (mode === "inspect" || mode === "calibrate" || !draft.length)
            return notice("Draw the geometry first.");
          var line = sc.engine.lines.find(function (l) {
            return l.line_no === Number(lineSelect.value);
          });
          if (line && /^cy$/i.test(line.unit || "")) {
            if (!(Number(depthValue.value) > 0) || !detail.value.trim())
              return notice("Cite the depth from this stored sheet before saving concrete volume.");
            shape.depth = {
              value: Number(depthValue.value),
              unit: depthUnit.value,
              source_id: depthSource.value || sc.source.id,
              sheet: depthSheet.value,
              detail: detail.value.trim(),
            };
          }
          act("takeoff_geometry", {
            operation: "save",
            line_no: Number(lineSelect.value),
            shape: shape,
            calibration_id: cal.value || undefined,
            geometry_id: old && old.geometry_id,
            expected_version: old ? old.version : 0,
          });
        },
        "primary",
      ),
    );
    var referenceUnit = node("select");
    referenceUnit.ariaLabel = "Reference distance unit";
    ["ft", "in", "m", "mm"].forEach(function (u) {
      var o = node("option", u);
      o.value = u;
      referenceUnit.append(o);
    });
    var distance = node("input"),
      region = node("input");
    distance.type = "number";
    distance.min = "0";
    distance.placeholder = "Known reference distance";
    distance.ariaLabel = "Known reference distance";
    region.placeholder = "Plan or detail name";
    region.ariaLabel = "Calibration region name";
    region.value = "Main plan";
    var bounds = node("div", null, "tools"),
      boundsInputs = {};
    [
      ["x", 0],
      ["y", 0],
      ["width", 1],
      ["height", 1],
    ].forEach(function (pair) {
      var label = node("label", "Region " + pair[0] + " (0–1)"),
        input = node("input");
      input.type = "number";
      input.min = "0";
      input.max = "1";
      input.step = ".01";
      input.value = pair[1];
      input.ariaLabel = "Calibration region " + pair[0];
      boundsInputs[pair[0]] = input;
      label.append(input);
      bounds.append(label);
    });
    edit.append(
      node("h2", "Plan or room area"),
      region,
      node(
        "p",
        "Counts need a confirmed area, not a scale. Choose Rectangle and mark the two opposite corners, or enter page bounds below. Calibration uses the same bounds with a separate distance reference.",
        "note small",
      ),
      button("Choose count area", function () {
        mode = "rect";
        draft = [];
        holes = [];
        selectedGeometry = null;
        overlay();
        showPreview();
        notice(
          "Mark two opposite corners around the entire plan or room to count, then confirm the count area.",
        );
      }),
      button("Confirm count area", function () {
        var areaBounds =
          mode === "rect" && draft.length === 2
            ? {
                x: Math.min(draft[0].x, draft[1].x),
                y: Math.min(draft[0].y, draft[1].y),
                width: Math.abs(draft[1].x - draft[0].x),
                height: Math.abs(draft[1].y - draft[0].y),
              }
            : {
                x: Number(boundsInputs.x.value),
                y: Number(boundsInputs.y.value),
                width: Number(boundsInputs.width.value),
                height: Number(boundsInputs.height.value),
              };
        var area = { name: region.value.trim(), bounds: areaBounds };
        if (!area.name || !(areaBounds.width > 0) || !(areaBounds.height > 0))
          return notice("Name the plan or room and choose its complete area.");
        var whole =
          areaBounds.x === 0 &&
          areaBounds.y === 0 &&
          areaBounds.width === 1 &&
          areaBounds.height === 1;
        confirmBox(
          "Confirm count area: " +
            area.name +
            (whole
              ? ". This is the WHOLE SHEET, including every plan and detail."
              : ". Only this boundary will be read; everything outside is excluded.") +
            " No quantity or scale is saved by this confirmation.",
          function () {
            act("takeoff_geometry", {
              operation: "scope",
              line_no: Number(lineSelect.value),
              count_area: area,
              confirm: true,
            });
          },
        );
      }),
      node("h2", "Confirm scale reference"),
      distance,
      referenceUnit,
      bounds,
      button("Confirm two-point calibration", function () {
        if (mode !== "calibrate" || draft.length !== 2 || !(Number(distance.value) > 0))
          return notice("Place exactly two reference points and enter their known distance.");
        var existing = sc.engine.calibrations.find(function (c) {
          return (
            c.source_id === sc.source.id && c.page === sc.source.page && c.region === region.value
          );
        });
        var reference = {
          points: draft.slice(),
          distance: Number(distance.value),
          unit: referenceUnit.value,
        };
        confirmBox(
          "Confirm that these two points are " +
            distance.value +
            " " +
            referenceUnit.value +
            " apart in " +
            region.value +
            ". Affected measurements will need acceptance again.",
          function () {
            act("sheet_calibrate", {
              operation: "save",
              region: region.value,
              bounds: {
                x: Number(boundsInputs.x.value),
                y: Number(boundsInputs.y.value),
                width: Number(boundsInputs.width.value),
                height: Number(boundsInputs.height.value),
              },
              reference: reference,
              confirm_reference: true,
              expected_version: existing ? existing.version : 0,
            });
          },
        );
      }),
    );
    left.append(
      edit,
      node(
        "p",
        "On a phone, zoom and review here; place or move geometry on a screen at least 768 px wide.",
        "note small",
      ),
    );
    if (sc.scale_lock && !sc.scale_lock.locked) {
      var scaleChoice = node("section", null, "panel");
      scaleChoice.append(node("h2", sc.scale_lock.question));
      scaleChoice.append(
        button("1 · Use a known dimension", function () {
          mode = "calibrate";
          draft = [];
          holes = [];
          overlay();
          notice(
            "Select the two ends of a known dimension, enter its length and confirm the reference below the sheet.",
          );
          edit.scrollIntoView({ block: "nearest" });
        }),
      );
      var stated = node("input");
      stated.ariaLabel = "Scale stated for this plan region";
      stated.placeholder = 'For example: 3/16" = 1\'-0"';
      if (sc.scale_lock.printed_scales.length === 1 && !sc.scale_lock.as_noted)
        stated.value = sc.scale_lock.printed_scales[0];
      scaleChoice.append(
        stated,
        button("2 · Use stated scale (true-size PDF)", function () {
          if (!stated.value.trim() || !region.value.trim())
            return notice("Name the plan region and its printed scale first.");
          var existing = sc.engine.calibrations.find(function (c) {
            return (
              c.source_id === sc.source.id && c.page === sc.source.page && c.region === region.value
            );
          });
          confirmBox(
            "Confirm this PDF is true size and " +
              stated.value +
              " applies to " +
              region.value +
              ". A separate dimension check is still needed before this is called Measured.",
            function () {
              act("sheet_calibrate", {
                operation: "save",
                region: region.value,
                bounds: {
                  x: Number(boundsInputs.x.value),
                  y: Number(boundsInputs.y.value),
                  width: Number(boundsInputs.width.value),
                  height: Number(boundsInputs.height.value),
                },
                stated_scale: stated.value.trim(),
                confirm_true_size: true,
                confirm_reference: true,
                expected_version: existing ? existing.version : 0,
              });
            },
          );
        }),
      );
      main.insertBefore(scaleChoice, layout);
    }
    var selected = node("div");
    function showSelected() {
      selected.replaceChildren();
      var g = rows().find(function (g) {
        return g.geometry_id === selectedGeometry;
      });
      if (!g) return;
      selected.append(
        node("h2", "Selected geometry"),
        node(
          "p",
          "Revision " +
            g.version +
            " · " +
            g.status +
            " · " +
            Number(g.measured).toFixed(2) +
            " " +
            g.unit,
        ),
      );
      if (g.status === "proposed")
        selected.append(
          button(
            "Accept proposal",
            function () {
              confirmBox(
                "Accept this exact geometry revision and its computed quantity? Review the sheet coverage and any pass uncertainties first.",
                function () {
                  act("takeoff_geometry", {
                    operation: "accept",
                    geometry_id: g.geometry_id,
                    expected_version: g.version,
                    confirm: true,
                  });
                },
              );
            },
            "primary",
          ),
        );
      selected.append(
        button("Measurement history", function () {
          act("takeoff_geometry", { operation: "history", geometry_id: g.geometry_id });
        }),
      );
      selected.append(
        button("Inspect selected pin or vertex", function () {
          act("takeoff_geometry", {
            operation: "crop",
            crop_point: g.shape.points[Math.max(0, selectedPoint)],
          });
        }),
      );
      if (sc.crop && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sc.crop.png)) {
        var crop = node("img", null, "crop");
        crop.src = sc.crop.png;
        crop.alt = "160 pixel crop from original sheet";
        selected.append(crop);
      }
      var reason = node("textarea");
      reason.placeholder = "Reason for rejecting or deleting";
      reason.ariaLabel = "Rejection reason";
      selected.append(
        reason,
        button("Reject geometry", function () {
          act("takeoff_geometry", {
            operation: "reject",
            geometry_id: g.geometry_id,
            expected_version: g.version,
            reason: reason.value,
          });
        }),
      );
      if (g.shape.kind === "pins" && g.shape.points.length > 1)
        selected.append(
          button("Delete selected pin", function () {
            if (selectedPoint < 0) return notice("Tap the specific pin to remove it.");
            if (!reason.value.trim()) return notice("Record why the pin is removed.");
            var shape = JSON.parse(JSON.stringify(g.shape));
            shape.points.splice(Math.max(0, selectedPoint), 1);
            act("takeoff_geometry", {
              operation: "save",
              line_no: sc.engine.lines.find(function (l) {
                return l.id === g.line_id;
              }).line_no,
              geometry_id: g.geometry_id,
              expected_version: g.version,
              shape: shape,
              reason: reason.value,
            });
          }),
        );
    }
    right.append(selected);
    showSelected();
    var filter = node("select");
    filter.ariaLabel = "Measurement status filter";
    ["all", "proposed", "accepted", "unlocated", "not_drawable", "holds_bid", "rejected"].forEach(
      function (s) {
        var o = node("option", s.replace("_", " "));
        o.value = s;
        filter.append(o);
      },
    );
    var list = node("div", null, "list");
    filter.value = sc.include_rejected ? "rejected" : statusFilter;
    function showList() {
      list.replaceChildren();
      statusFilter = filter.value;
      if (filter.value === "rejected") {
        rows()
          .filter(function (g) {
            return g.status === "rejected";
          })
          .forEach(function (g) {
            var l = sc.engine.lines.find(function (l) {
                return l.id === g.line_id;
              }),
              r = node("div", null, "row note");
            r.append(
              node("strong", "L" + (l && l.line_no) + " · " + (l && l.item)),
              node("p", g.reason || "Reason not recorded"),
              node("p", "Rejected geometry · revision " + g.version),
            );
            list.append(r);
          });
        overlay();
        return;
      }
      if (filter.value === "holds_bid") {
        (sc.engine.gaps || [])
          .filter(function (g) {
            return g.holds_bid;
          })
          .forEach(function (g) {
            var r = node("div", null, "row risk");
            r.dataset.alert = "risk";
            r.append(node("strong", g.ref + " · " + g.title), node("p", g.reasoning));
            list.append(r);
          });
        return;
      }
      sc.engine.summary.lines
        .filter(function (l) {
          return filter.value === "all" || l.status === filter.value;
        })
        .forEach(function (l) {
          var r = node("div", null, "row");
          r.append(
            node("strong", "L" + l.line_no + " · " + l.item),
            node(
              "p",
              "Accepted: " +
                (l.accepted == null
                  ? "Not established"
                  : Number(l.accepted).toFixed(2) + " " + l.unit),
              "accepted",
            ),
            node(
              "p",
              "Proposed: " +
                (l.proposed == null ? "None" : Number(l.proposed).toFixed(2) + " " + l.unit),
              "proposed",
            ),
            node("p", l.status.replace("_", " ") + (l.reason ? " · " + l.reason : ""), "small"),
          );
          sc.engine.geometry
            .filter(function (g) {
              return (
                g.line_id === l.line_id &&
                g.status !== "rejected" &&
                g.shape.kind !== "not_drawable"
              );
            })
            .forEach(function (g) {
              var actualSource = (sc.available_sources || []).find(function (source) {
                  return source.id === g.source_id;
                }),
                currentSource = (sc.available_sources || []).find(function (source) {
                  return source.id === sc.source.id;
                }),
                actualSheet = actualSource && actualSource.sheets[g.page - 1];
              if (
                g.page !== sc.source.page ||
                (g.source_id !== sc.source.id &&
                  actualSource &&
                  currentSource &&
                  actualSource.source_key !== currentSource.source_key)
              ) {
                r.append(
                  button("Open " + (actualSheet || "measured sheet"), function () {
                    act("takeoff_geometry", {
                      operation: "list",
                      source_id: g.source_id,
                      sheet: actualSheet,
                    });
                  }),
                );
                return;
              }
              if (g.source_id !== sc.source.id) {
                r.append(
                  node(
                    "p",
                    "Located on another stored revision; this sheet has not inherited its quantity.",
                    "note small",
                  ),
                  button("Check on this drawing revision", function () {
                    confirmBox(
                      "Check these locations on the selected replacement drawing? Scale and ink will be checked again; the result remains a proposal.",
                      function () {
                        act("takeoff_geometry", {
                          operation: "revise",
                          geometry_id: g.geometry_id,
                          expected_version: g.version,
                          calibration_id: cal.value || undefined,
                          confirm: true,
                        });
                      },
                    );
                  }),
                );
                return;
              }
              if (g.evidence && typeof g.evidence.confidence === "number")
                r.append(
                  node(
                    "p",
                    "Reported AI confidence: " +
                      Math.round(g.evidence.confidence * 100) +
                      "% · interpretation, not accuracy." +
                      (g.status === "proposed" ? " Verify item identity before accepting." : ""),
                    "note small",
                  ),
                );
              r.append(
                button(
                  "Review " +
                    g.shape.kind +
                    " · " +
                    Number(g.measured).toFixed(2) +
                    " " +
                    g.unit +
                    " · " +
                    g.geometry_id.slice(-4) +
                    " · v" +
                    g.version,
                  function () {
                    selectedLine = String(l.line_no);
                    lineSelect.value = selectedLine;
                    selectedGeometry = g.geometry_id;
                    selectedPoint = -1;
                    draft = [];
                    mode = "inspect";
                    showSelected();
                    overlay();
                    showReadStatus();
                  },
                ),
              );
            });
          r.append(
            button("Line history", function () {
              act("takeoff_geometry", { operation: "history", line_no: l.line_no });
            }),
          );
          list.append(r);
        });
    }
    filter.addEventListener("change", function () {
      showList();
      overlay();
    });
    right.append(node("h2", "Measurement review"), filter, list);
    showList();
    var readPanel = node("div");
    right.append(readPanel);
    function showReadStatus() {
      if (!readPanel) return;
      readPanel.replaceChildren();
      var line = Number(lineSelect.value),
        calibration = cal.value || undefined;
      var passes = readPasses(sc, line, calibration);
      if (!passes.length) return;
      var p = passes[0].pass_summary;
      if (p.count_area)
        readPanel.append(node("p", "Confirmed count area: " + p.count_area.name, "note"));
      readPanel.append(
        node(
          "p",
          "L" +
            line +
            " · Drawing read: " +
            p.tiles_read +
            " / " +
            p.tiles_total +
            " tiles" +
            (p.complete ? " · regions reviewed; check unresolved findings" : " · incomplete"),
          "note",
        ),
      );
      (p.uncertainties || []).slice(-8).forEach(function (u) {
        readPanel.append(node("p", u, "note small"));
      });
      if (!p.complete) readPanel.append(button("Continue with your AI", runRead));
      try {
        var fresh = freshReadArguments(sc, line, calibration);
        readPanel.append(
          button("Start a fresh read", function () {
            if (reading) return notice("Pause the current read before starting a fresh one.");
            var selection = JSON.stringify([
              sc.source.id,
              sc.source.page,
              sc.engine.takeoff_version,
              lineSelect.value,
              cal.value,
            ]);
            confirmBox(
              "Start a new read of L" +
                line +
                " on " +
                sc.source.sheet +
                " in the same confirmed scope? Earlier checkpoints and rejected geometry stay in history. New proposals need review.",
              async function () {
                if (
                  selection !==
                  JSON.stringify([
                    sc.source.id,
                    sc.source.page,
                    sc.engine.takeoff_version,
                    lineSelect.value,
                    cal.value,
                  ])
                )
                  return notice("The selection changed. Review the fresh read again.");
                if (await act("takeoff_geometry", fresh)) await runRead();
              },
            );
          }),
        );
      } catch (_) {
        /* Active geometry must be reviewed before another pass. */
      }
      size();
    }
    showReadStatus();
    async function runRead(smaller) {
      if (sc.scale_lock && !sc.scale_lock.locked)
        return notice(
          "Choose one of the two scale options first. No read or measurement has started.",
        );
      var line = Number(lineSelect.value),
        calibration = cal.value || undefined;
      var selected = sc.engine.lines.find(function (l) {
        return l.line_no === line;
      });
      if (!selected) return notice("Choose a takeoff line first.");
      if (/^(ea|each)$/i.test(selected.unit || "") && !readPasses(sc, line, calibration).length)
        return notice(
          "Confirm the complete plan or room count area before asking your AI to read this line.",
        );
      if (!host.message)
        return notice(
          "Ask your AI in chat to read L" +
            line +
            " on " +
            sc.source.sheet +
            ". Athena supplies the stored drawing regions.",
        );
      try {
        await rpc("ui/message", {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Use Athena to inspect the stored drawing regions for " +
                JSON.stringify(
                  Object.assign(context(), {
                    line_no: line,
                    calibration_id: calibration,
                    split_region: smaller === true,
                  }),
                ) +
                ". Prepare the next target with takeoff_geometry propose, inspect its returned images, and submit the visible tile-relative observations to that same checkpoint. Reconcile the takeoff with the saved drawings, notes, specifications and contract; record cited gaps and specific verification questions with estimate_gap_analysis. Identify unavailable or unread documents. Keep quantities as proposals for my review; do not accept them.",
            },
          ],
        });
        notice("Sent to your connected AI. Athena verifies and measures the returned locations.");
      } catch (_) {
        notice(
          "Continue in chat: ask your AI to read the selected line using Athena's stored drawing regions.",
        );
      }
    }
    right.append(button("Ask your AI to read selected line", runRead));
    right.append(
      button("Ask your AI to read smaller regions", function () {
        runRead(true);
      }),
    );
    // A sheet read: every open line on each tile, one observation set back per tile.
    async function runSheetRead() {
      if (sc.scale_lock && !sc.scale_lock.locked)
        return notice(
          "Choose one of the two scale options first. No read or measurement has started.",
        );
      var calibration = cal.value || undefined;
      if (!host.message)
        return notice(
          "Ask your AI in chat to read every open line on " +
            sc.source.sheet +
            " with takeoff_geometry propose and no line_no. Athena supplies the stored regions.",
        );
      try {
        await rpc("ui/message", {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Use Athena to read every open takeoff line on this sheet, one tile at a time, for " +
                JSON.stringify(Object.assign(context(), { calibration_id: calibration })) +
                ". Call takeoff_geometry propose with no line_no (and this calibration_id) to prepare the next tile; it lists every line to look for on that tile. Inspect the target image once for all of them and submit sheet_observations with that cursor and one entry per listed line, with empty findings where nothing is visible. Repeat until the read is complete. Reconcile with the saved drawings, notes, specifications and contract; record cited gaps and questions with estimate_gap_analysis. Keep quantities as proposals for my review; do not accept them.",
            },
          ],
        });
        notice(
          "Sent to your connected AI. Athena verifies and measures every line's returned locations.",
        );
      } catch (_) {
        notice(
          "Continue in chat: ask your AI to read every open line on this sheet with Athena's stored regions.",
        );
      }
    }
    right.append(button("Ask your AI to read the whole sheet", runSheetRead));
    if (sc.sheet_read)
      right.append(
        node(
          "p",
          "Sheet read: tile " +
            (sc.sheet_read.cursor + 1) +
            " of " +
            sc.sheet_read.tiles_total +
            " · " +
            (sc.sheet_read.lines || []).length +
            " lines on this tile" +
            ((sc.sheet_read.skipped || []).length
              ? " · " + sc.sheet_read.skipped.length + " lines not ready"
              : ""),
          "note",
        ),
      );
    var proposals = rows().filter(function (g) {
      return reviewableProposal(sc, g);
    });
    if (proposals.length)
      right.append(
        button("Accept " + Math.min(200, proposals.length) + " checked proposals", function () {
          var frozen = proposals.slice(0, 200).map(function (g) {
            return { id: g.geometry_id, version: g.version };
          });
          confirmBox(
            "Accept these " +
              frozen.length +
              " displayed proposals? Their locations passed ink and geometry checks. Reported confidence may be low; review it with item identity, scope and uncertainties. This accepts the listed revisions only.",
            async function () {
              await act("takeoff_geometry", {
                operation: "accept_all",
                decisions: frozen.map(function (g) {
                  return { geometry_id: g.id, expected_version: g.version };
                }),
                confirm: true,
              });
            },
          );
        }),
      );
    (sc.engine.geometry || [])
      .filter(function (g) {
        return (
          g.status === "not_drawable" &&
          sc.engine.lines.some(function (l) {
            return String(l.line_no) === String(lineSelect.value) && l.id === g.line_id;
          })
        );
      })
      .forEach(function (g) {
        var revoke = node("input");
        revoke.placeholder = "Reason to withdraw this non-drawable basis";
        revoke.ariaLabel = "Withdraw basis reason";
        right.append(
          revoke,
          button("Withdraw non-drawable basis", function () {
            if (revoke.value.trim().length < 3)
              return notice("Record why this basis is being withdrawn.");
            confirmBox(
              "Withdraw this exact basis? This line will need fresh measured geometry or a new confirmed basis.",
              function () {
                return act("takeoff_geometry", {
                  operation: "reject",
                  geometry_id: g.geometry_id,
                  expected_version: g.version,
                  reason: revoke.value,
                  confirm: true,
                });
              },
            );
          }),
        );
      });
    var exception = node("select");
    exception.ariaLabel = "Non-drawable basis";
    ["schedule_quantity", "spec_only", "allowance", "by_others"].forEach(function (k) {
      var o = node("option", k.replace("_", " "));
      o.value = k;
      exception.append(o);
    });
    var exceptionQty = node("input");
    exceptionQty.type = "number";
    exceptionQty.min = "0";
    exceptionQty.placeholder = "Confirmed non-drawable quantity";
    exceptionQty.ariaLabel = "Confirmed non-drawable quantity";
    var why = node("textarea");
    why.placeholder = "Estimator reason and source for non-drawable work";
    why.ariaLabel = "Non-drawable reason";
    right.append(
      node("h2", "Non-drawable work"),
      exception,
      exceptionQty,
      why,
      button("Record non-drawable basis", function () {
        if (
          exception.value !== "by_others" &&
          (exceptionQty.value === "" ||
            !Number.isFinite(Number(exceptionQty.value)) ||
            Number(exceptionQty.value) < 0)
        )
          return notice(
            "Enter the quantity confirmed from the schedule, specification or allowance. A historical typed quantity is not assumed.",
          );
        confirmBox(
          "Record this basis for L" +
            lineSelect.value +
            "? Existing geometry must be reviewed separately; this cannot silently discard it.",
          function () {
            act("estimate_item_mark", {
              item_id: "T-" + lineSelect.value,
              mark: "not_drawable",
              exception_kind: exception.value,
              note: why.value,
              corrected_qty: exception.value === "by_others" ? 0 : Number(exceptionQty.value),
            });
          },
        );
      }),
    );
    right.append(
      button("Save dated measured PDF", function () {
        act("takeoff_geometry", { operation: "export" });
      }),
    );
    if (sc.export && sc.export.url) {
      right.append(
        button("Open dated measured PDF", function () {
          var u;
          try {
            u = new URL(sc.export.url);
          } catch (_) {
            return;
          }
          if (
            u.protocol !== "https:" ||
            u.pathname.indexOf(
              "/storage/v1/object/sign/athena-files/" + sc.context.company_id + "/",
            ) !== 0
          )
            return notice("Use the private download link in the conversation.");
          send({ id: ++seq, method: "ui/open-link", params: { url: u.href } });
        }),
      );
    }
    (sc.engine.exports || [])
      .filter(function (e) {
        return e.source_id === sc.source.id && e.page === sc.source.page;
      })
      .slice(0, 20)
      .forEach(function (e) {
        right.append(
          button("Dated PDF · " + e.created_at, function () {
            act("takeoff_geometry", { operation: "download", markup_id: e.id });
          }),
        );
      });
    extraSections(right);
    main.append(
      node(
        "p",
        "Blue fill: accepted. Blue outline: proposed. Counts and dimensions come from geometry; no typed quantity changes a measured result.",
        "note small",
      ),
    );
    size();
  }
  window.addEventListener("message", function (e) {
    if (e.source !== window.parent) return;
    var m = e.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (!ready) {
      if (
        m.id !== 1 ||
        m.error ||
        !m.result ||
        typeof m.result !== "object" ||
        Array.isArray(m.result)
      )
        return;
      origin = e.origin;
      host = m.result.hostCapabilities || {};
      hostContext = m.result.hostContext || {};
      ready = true;
      send({ method: "ui/notifications/initialized", params: {} });
      size();
      return;
    }
    if (e.origin !== origin) return;
    if (pending.has(m.id)) {
      var t = pending.get(m.id);
      pending.delete(m.id);
      clearTimeout(t.timer);
      if (m.error) t.reject(Error("Athena did not confirm the operation. Reload before retrying."));
      else t.resolve(m.result);
      return;
    }
    if (m.method === "ui/notifications/host-context-changed") {
      hostContext = Object.assign({}, hostContext, m.params || {});
      draw();
    } else if (m.method === "ui/notifications/tool-result") {
      var incoming = takeoffData(m.params);
      if (!incoming) return;
      var newer =
        incoming &&
        incoming.snapshot_at &&
        sc &&
        sc.snapshot_at &&
        incoming.snapshot_at > sc.snapshot_at;
      var different =
        incoming &&
        incoming.context &&
        sc &&
        sc.context &&
        incoming.context.job_id !== sc.context.job_id;
      if (!localResult || newer || different) {
        sc = incoming;
        localResult = false;
        draw();
      }
    } else if (m.method === "ping" && m.id != null) send({ id: m.id, result: {} });
    else if (m.method === "ui/resource-teardown") {
      pending.forEach(function (t) {
        clearTimeout(t.timer);
        t.reject(Error("Viewer closed. Reload to confirm saved state."));
      });
      pending.clear();
      if (observer) observer.disconnect();
      if (m.id != null) send({ id: m.id, result: {} });
    }
  });
  observer =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(function () {
          var width = root.clientWidth;
          if (width !== lastWidth) {
            lastWidth = width;
            if (refreshDrawing) refreshDrawing();
          }
          size();
        });
  if (observer) observer.observe(document.body);
  send({
    id: 1,
    method: "ui/initialize",
    params: {
      protocolVersion: "2026-01-26",
      appInfo: { name: "Athena takeoff", version: "1.0.0" },
      appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
    },
  });
})();
