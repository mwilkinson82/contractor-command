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
  var inlineWorkspace = false;
  // Workspace view state kept across redraws: the side panel tab and the step
  // whose guide is open (null follows the first unfinished step).
  var panelTab = "lines",
    guideStep = null;
  // Drawing ink, one per takeoff line, so lines tell apart on the sheet. These mark
  // the drawing only; the card itself keeps the house palette.
  var LINE_INK = ["#1E5FED", "#0F7B5F", "#B45309", "#7C3AED", "#0E7490"];
  // Sharp 200-dpi regions: at most DETAIL_CAP drawn at once, and the fetched
  // images kept across redraws so a selection or save does not blur the sheet.
  var DETAIL_CAP = 24,
    DETAIL_CACHE_CAP = 48,
    detailCache = new Map();
  function node(tag, text, cls) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = String(text);
    if (cls) e.className = cls;
    return e;
  }
  function lineInk(lineNo) {
    var n = Math.max(1, Math.floor(Number(lineNo)) || 1);
    return LINE_INK[(n - 1) % LINE_INK.length];
  }
  // Trade sheets first, then the rest as coordination. Option values stay the exact
  // stored names; only their order, labels and grouping change. No sheet is preselected.
  function appendSheetOptions(select, source, names) {
    var tags = (source && source.sheet_tags) || [];
    var groups = { trade: [], other: [], coordination: [] };
    names.forEach(function (n, i) {
      var tag = tags[i] || {};
      var o = node("option", tag.discipline ? n + " · " + tag.discipline : n);
      o.value = n;
      groups[
        tag.focus === "trade" ? "trade" : tag.focus === "coordination" ? "coordination" : "other"
      ].push(o);
    });
    if (!groups.trade.length && !groups.coordination.length) {
      groups.other.forEach(function (o) {
        select.append(o);
      });
      return;
    }
    [
      ["trade", "Your trade"],
      ["other", "Other sheets"],
      ["coordination", "Coordination only"],
    ].forEach(function (g) {
      if (!groups[g[0]].length) return;
      var group = node("optgroup");
      group.label = g[1];
      groups[g[0]].forEach(function (o) {
        group.append(o);
      });
      select.append(group);
    });
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
  // Good, Better, Best options saved on the selections board for a takeoff line.
  // Contractor-only: this workspace is the estimator's view, never the customer's.
  var TIER = { good: "Good", better: "Better", best: "Best" };
  function cents(v, code) {
    if (v == null) return "Unknown";
    var n = (Math.abs(v) / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return (v < 0 ? "-" : "") + (code === "USD" ? "$" + n : code ? code + " " + n : n);
  }
  function lineOptions(lineNo) {
    return (
      ((sc && sc.estimate_options) || []).find(function (o) {
        return o.line_no === Number(lineNo);
      }) || null
    );
  }
  async function showOptions(o) {
    var ask =
      "Show the Good, Better and Best options for estimate line " +
      o.ref +
      " (" +
      o.title +
      ") with cost, sell price and margin side by side.";
    if (!host.message) return notice("Ask in chat: " + ask);
    try {
      await rpc("ui/message", {
        role: "user",
        content: [
          {
            type: "text",
            text:
              ask +
              " Use Athena selection_board action options with " +
              JSON.stringify({
                job_number: sc.context.job_number,
                company_id: sc.context.company_id,
                estimate_line_ref: o.ref,
              }) +
              ".",
          },
        ],
      });
      notice("Sent to your connected AI.");
    } catch (_) {
      notice("Ask in chat: " + ask);
    }
  }
  function optionsBlock(lineNo) {
    var o = lineOptions(lineNo);
    if (!o) return null;
    var wrap = node("div", null, "gbb"),
      panel = node("div", null, "gbb-panel");
    panel.hidden = true;
    o.tiers.forEach(function (t) {
      if (!t.product) return;
      var r = node("div", null, "gbb-row");
      var price =
        t.price_unit_cents != null && t.price_reviewed_on
          ? "Sell " +
            cents(t.price_unit_cents, o.currency) +
            " per " +
            o.unit +
            " · " +
            cents(t.price_cents, o.currency) +
            " for " +
            o.quantity +
            " " +
            o.unit +
            (t.margin_bp != null ? " · margin " + (t.margin_bp / 100).toFixed(1) + "%" : "")
          : t.found_unit_cents != null
            ? "Found " +
              cents(t.found_unit_cents, o.currency) +
              " per " +
              o.unit +
              " · a cost lead, not priced yet"
            : "Not priced yet";
      r.append(
        node(
          "strong",
          TIER[t.tier] + (t.tier === o.base_tier ? " (base)" : "") + " · " + t.product,
        ),
        node("p", price, "small"),
      );
      panel.append(r);
    });
    panel.append(
      node("p", "Saved alternates. The estimate total is unchanged.", "note small"),
      button("Show full comparison in chat", function () {
        showOptions(o);
      }),
    );
    var label =
      o.tiers_with_product
        .map(function (t) {
          return TIER[t];
        })
        .join("/") +
      " options" +
      (o.selected ? " · customer chose " + TIER[o.selected] : "");
    var toggle = button(
      label,
      function () {
        panel.hidden = !panel.hidden;
        toggle.setAttribute("aria-expanded", String(!panel.hidden));
        size();
      },
      "gbb-flag",
    );
    toggle.setAttribute("aria-expanded", "false");
    toggle.title = "See this line's Good, Better, Best options";
    wrap.append(toggle, panel);
    return wrap;
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
    // Size the workspace to the host frame: fill the screen when expanded, stay
    // short inline so the conversation is never buried.
    document.body.classList.toggle("fs", hostContext.displayMode === "fullscreen");
    document.body.classList.toggle(
      "inline-ws",
      hostContext.displayMode !== "fullscreen" && inlineWorkspace,
    );
    // The inline result should not displace the conversation with the entire
    // measurement workspace. The host can expand it on demand; hosts without
    // fullscreen support retain an explicit inline fallback.
    if (hostContext.displayMode !== "fullscreen" && !inlineWorkspace) {
      var compact = node("div", null, "compact");
      compact.append(
        node("strong", sc.source ? sc.source.sheet + " · Drawing takeoff" : "Drawing takeoff"),
        node("p", sc.card.job || "", "note small"),
        node(
          "p",
          sc.source ? "Ready to open " + sc.source.sheet : "Choose a drawing in the workspace.",
          "small",
        ),
      );
      (sc.estimate_options || []).forEach(function (o) {
        var row = node("div", null, "gbb-line");
        row.append(node("p", "L" + o.line_no + " · " + o.title, "small"), optionsBlock(o.line_no));
        compact.append(row);
      });
      compact.append(
        button("Open drawing workspace", async function () {
          if ((hostContext.availableDisplayModes || []).includes("fullscreen")) {
            try {
              var result = await rpc("ui/request-display-mode", { mode: "fullscreen" }, 15000);
              hostContext.displayMode = result.mode;
              if (result.mode !== "fullscreen") inlineWorkspace = true;
            } catch (_) {
              inlineWorkspace = true;
            }
          } else inlineWorkspace = true;
          draw();
        }),
      );
      root.append(compact);
      size();
      return;
    }
    var head = node("header");
    head.append(node("p", "ATHENA", "brand"), node("h1", sc.card.title), node("p", sc.card.job));
    root.append(head);
    if (inlineWorkspace && hostContext.displayMode !== "fullscreen")
      head.append(
        button("Back to chat", function () {
          inlineWorkspace = false;
          draw();
          notice("");
        }),
      );
    else if ((hostContext.availableDisplayModes || []).includes("fullscreen"))
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
    // With a sheet open, the step bar carries these counts and the Checks tab carries
    // the read guidance, so the drawing gets the room.
    if (!sc.source) {
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
    }
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
        !["athena-files", "athena-estimate-exports"].some(function (bucket) {
          return (
            u.pathname.indexOf(
              "/storage/v1/object/sign/" +
                bucket +
                "/" +
                sc.context.company_id +
                "/" +
                sc.context.job_id +
                "/",
            ) === 0
          );
        })
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
      var chooseSource = node("option", "Choose a drawing set");
      chooseSource.value = "";
      pick.append(chooseSource);
      (sc.available_sources || []).forEach(function (s) {
        var o = node("option", s.filename + " · revision " + s.revision);
        o.value = s.id;
        pick.append(o);
      });
      function populate() {
        sheetPick.replaceChildren();
        var placeholder = node("option", "Choose a sheet");
        placeholder.value = "";
        sheetPick.append(placeholder);
        var s = (sc.available_sources || []).find(function (s) {
          return s.id === pick.value;
        });
        appendSheetOptions(sheetPick, s, (s && s.sheets) || []);
      }
      pick.addEventListener("change", populate);
      populate();
      main.append(
        pick,
        sheetPick,
        button("Open stored sheet", function () {
          if (!pick.value || !sheetPick.value)
            return notice("Choose a drawing set and sheet first.");
          act("takeoff_geometry", {
            operation: "list",
            source_id: pick.value,
            sheet: sheetPick.value,
            viewer_only: true,
          });
        }),
      );
      // Shortcuts to sheets that already hold saved marks. Nothing is guessed:
      // the member picks the exact stored sheet.
      var marked = [];
      (sc.engine.geometry || []).forEach(function (g) {
        if (!g.source_id || !g.page || g.status === "rejected") return;
        var s = (sc.available_sources || []).find(function (s) {
          return s.id === g.source_id;
        });
        var name = s && s.sheets && s.sheets[g.page - 1];
        if (
          name &&
          !marked.some(function (m) {
            return m.source === s.id && m.sheet === name;
          })
        )
          marked.push({ source: s.id, sheet: name });
      });
      if (marked.length) {
        var quick = node("div", null, "tools");
        quick.append(node("span", "Sheets with saved marks:", "small"));
        marked.slice(0, 8).forEach(function (m) {
          quick.append(
            button("Open " + m.sheet, function () {
              act("takeoff_geometry", {
                operation: "list",
                source_id: m.source,
                sheet: m.sheet,
                viewer_only: true,
              });
            }),
          );
        });
        main.append(quick);
      }
      sc.engine.summary.lines.forEach(function (l) {
        main.append(node("p", "L" + l.line_no + " · " + l.item + " · " + l.status));
        var gbb = optionsBlock(l.line_no);
        if (gbb) main.append(gbb);
      });
      size();
      return;
    }
    head.classList.add("ws-head");
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
      appendSheetOptions(
        sheetSelect,
        s && s.sheets ? s : null,
        (s && s.sheets) || [sc.source.sheet],
      );
      // A different revision may not hold the open sheet; never send a stale name.
      if (sourceSelect.value === sc.source.id) sheetSelect.value = sc.source.sheet;
      else {
        var choose = node("option", "Choose a sheet");
        choose.value = "";
        sheetSelect.prepend(choose);
        sheetSelect.value = "";
      }
    }
    sourceSelect.addEventListener("change", sheetOptions);
    sheetOptions();
    sourceTools.append(
      sourceSelect,
      sheetSelect,
      button("Open stored sheet", function () {
        if (!sheetSelect.value) return notice("Choose a sheet first.");
        act("takeoff_geometry", {
          operation: "list",
          source_id: sourceSelect.value,
          sheet: sheetSelect.value,
          viewer_only: true,
        });
      }),
    );
    sourceTools.append(
      node("span", "Revision " + sc.source.revision + " · original preserved", "note small"),
    );
    head.append(sourceTools);
    // Four steps, in the order the work happens. Each says where it stands from the
    // saved takeoff; the open step's guide says what to do and offers one action.
    var steps = node("nav", null, "steps"),
      guide = node("div", null, "guide");
    steps.ariaLabel = "Takeoff steps";
    main.append(steps, guide);
    var layout = node("div", null, "layout"),
      left = node("section", null, "stagecol"),
      right = node("section", null, "sidecol");
    layout.append(left, right);
    main.append(layout);
    var viewWidth = 1000,
      viewHeight = (1000 * sc.space.height) / sc.space.width;
    var tools = node("div", null, "tools toolbar"),
      viewport = node("div", null, "viewport"),
      modeNote = node("p", "Inspect mode: select a mark to see its line.", "note"),
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
    viewport.ariaLabel = "Drawing. Zoom, then drag or scroll to pan.";
    var detailReady = false,
      detailTimer = null,
      detailInFlight = 0,
      detailRequested = new Set(),
      detailImages = new Map(),
      detailSource = sc.source.id,
      detailHash = sc.source.content_hash,
      detailSheet = sc.source.sheet;
    var marksHidden = false;
    function setZoom(v) {
      // Keep the middle of the view in place so zooming does not jump to the corner.
      var before = surface.getBoundingClientRect(),
        cx = before.width ? (viewport.scrollLeft + viewport.clientWidth / 2) / before.width : 0.5,
        cy = before.height ? (viewport.scrollTop + viewport.clientHeight / 2) / before.height : 0.5;
      zoom = Math.max(1, Math.min(8, v));
      surface.style.width = zoom * 100 + "%";
      var after = surface.getBoundingClientRect();
      if (after.width) {
        viewport.scrollLeft = cx * after.width - viewport.clientWidth / 2;
        viewport.scrollTop = cy * after.height - viewport.clientHeight / 2;
      }
      zoomLabel.textContent = Math.round(zoom * 100) + "%";
      if (svg.isConnected) overlay();
      if (detailReady) scheduleDetail();
      size();
    }
    var zoomLabel = node("span", null, "zoom"),
      zoomOut = button("−", function () {
        setZoom(zoom - 0.5);
      }),
      zoomIn = button("+", function () {
        setZoom(zoom + 0.5);
      });
    zoomOut.ariaLabel = "Zoom out";
    zoomIn.ariaLabel = "Zoom in";
    setZoom(zoom);
    var zoomGroup = node("span", null, "group");
    zoomGroup.append(
      zoomOut,
      zoomLabel,
      zoomIn,
      button("Fit", function () {
        setZoom(1);
      }),
    );
    tools.append(zoomGroup);
    var tileSelect = node("select");
    tileSelect.ariaLabel = "Readable 200 dpi tile";
    (sc.tiles || []).forEach(function (t) {
      var o = node("option", "200 dpi region " + (t.index + 1));
      o.value = t.index;
      tileSelect.append(o);
    });
    var tileRead = button("Read region", function () {
      act("takeoff_geometry", { operation: "tile", tile_index: Number(tileSelect.value) });
    });
    var marksButton = button("Hide marks", function () {
      if (
        !marksHidden &&
        (draft.length ||
          holes.some(function (hole) {
            return hole.length;
          }))
      ) {
        notice("Finish or discard the unsaved drawing before hiding marks.");
        return;
      }
      marksHidden = !marksHidden;
      if (marksHidden) mode = "inspect";
      marksButton.textContent = marksHidden ? "Show marks" : "Hide marks";
      overlay();
    });
    tools.append(marksButton);
    // The selected mark is named on the drawing itself, so a click on a pin says
    // what it is without scrolling the side panel.
    var selectionBar = node("div", null, "selbar"),
      removingPin = false;
    selectionBar.setAttribute("aria-live", "polite");
    function selectedRecord() {
      return selectedGeometry
        ? rows().find(function (g) {
            return g.geometry_id === selectedGeometry;
          })
        : null;
    }
    function lineOf(g) {
      return (
        g &&
        sc.engine.lines.find(function (l) {
          return l.id === g.line_id;
        })
      );
    }
    // Every saved pin of one line on this sheet, in the order its labels count.
    function linePins(lineId) {
      var out = [];
      rows().forEach(function (g) {
        if (g.line_id !== lineId || g.shape.kind !== "pins") return;
        g.shape.points.forEach(function (point, index) {
          out.push({ id: g.geometry_id, index: index, point: point });
        });
      });
      return out;
    }
    function centerOn(point) {
      var w = surface.clientWidth,
        h = surface.clientHeight;
      if (zoom <= 1 || !w || !h || !validPoint(point)) return;
      viewport.scrollLeft = point.x * w - viewport.clientWidth / 2;
      viewport.scrollTop = point.y * h - viewport.clientHeight / 2;
      if (detailReady) scheduleDetail();
    }
    // Previous and Next pin walk the selected line's pins on this sheet, one at a time.
    function stepPin(step, lineId) {
      var g = selectedRecord(),
        pins = linePins(lineId || (g && g.line_id));
      if (!pins.length) return;
      var at = pins.findIndex(function (p) {
        return p.id === selectedGeometry && p.index === selectedPoint;
      });
      var next =
        at < 0
          ? pins[step > 0 ? 0 : pins.length - 1]
          : pins[(at + step + pins.length) % pins.length];
      chooseGeometry(next.id, next.index);
      overlay();
      centerOn(next.point);
    }
    // Opens a line: selects its first saved mark on this sheet, if it has one.
    function openLine(lineNo) {
      var line = sc.engine.lines.find(function (l) {
        return String(l.line_no) === String(lineNo);
      });
      if (!line) return;
      var first = rows().find(function (g) {
        return g.line_id === line.id;
      });
      if (
        draft.length ||
        holes.some(function (hole) {
          return hole.length;
        })
      )
        return notice("Finish or discard the unsaved drawing before opening another line.");
      if (first) {
        chooseGeometry(first.geometry_id, 0);
        overlay();
        if (first.shape.points[0]) centerOn(first.shape.points[0]);
        return;
      }
      selectedLine = String(line.line_no);
      lineSelect.value = selectedLine;
      selectedGeometry = null;
      selectedPoint = -1;
      showList();
      overlay();
      showReadStatus();
    }
    function quantityText(g) {
      return Number(g.measured).toFixed(g.unit && /^ea$/i.test(g.unit) ? 0 : 2) + " " + g.unit;
    }
    function acceptGeometry(g) {
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
    }
    // Removing one pin saves a new proposal revision without it; the reason is kept.
    function removePin(g, index, why) {
      if (index < 0) return notice("Tap the specific pin to remove it.");
      if (!String(why || "").trim()) return notice("Record why the pin is removed.");
      var shape = JSON.parse(JSON.stringify(g.shape));
      shape.points.splice(index, 1);
      act("takeoff_geometry", {
        operation: "save",
        line_no: lineOf(g).line_no,
        geometry_id: g.geometry_id,
        expected_version: g.version,
        shape: shape,
        reason: why,
      });
    }
    function showSelectionBar() {
      selectionBar.replaceChildren();
      var g = selectedRecord(),
        line = lineOf(g);
      if (!g) {
        removingPin = false;
        return;
      }
      var dot = node("span", null, "dot");
      dot.style.background = line ? lineInk(line.line_no) : "#6B7280";
      var label = node("strong", line ? "L" + line.line_no + " · " + line.item : "Selected mark");
      var facts = [],
        pins = g.shape.kind === "pins" ? linePins(g.line_id) : [],
        at = pins.findIndex(function (p) {
          return p.id === g.geometry_id && p.index === selectedPoint;
        });
      if (at >= 0) facts.push("count " + (at + 1) + " of " + pins.length);
      facts.push(g.status);
      if (g.shape.kind !== "pins" || g.status !== "proposed") facts.push(quantityText(g));
      var clear = button("✕", function () {
        selectedGeometry = null;
        selectedPoint = -1;
        removingPin = false;
        showSelected();
        overlay();
      });
      clear.ariaLabel = "Clear selection";
      clear.title = "Clear selection";
      if (removingPin && g.shape.kind === "pins") {
        var why = node("input");
        why.placeholder = "Why remove this pin?";
        why.ariaLabel = "Reason for removing this pin";
        selectionBar.append(
          dot,
          label,
          why,
          button("Remove pin", function () {
            removePin(g, selectedPoint, why.value);
          }),
          button("Cancel", function () {
            removingPin = false;
            showSelectionBar();
          }),
        );
        why.focus();
        return;
      }
      selectionBar.append(dot, label, node("span", facts.join(" · "), "meta"));
      if (pins.length > 1)
        selectionBar.append(
          button("Previous pin", function () {
            stepPin(-1);
          }),
          button("Next pin", function () {
            stepPin(1);
          }),
        );
      if (g.status === "proposed")
        selectionBar.append(
          button(
            "Accept " + quantityText(g),
            function () {
              acceptGeometry(g);
            },
            "primary",
          ),
        );
      if (g.shape.kind === "pins" && g.shape.points.length > 1 && selectedPoint >= 0)
        selectionBar.append(
          button("Remove this pin", function () {
            removingPin = true;
            showSelectionBar();
          }),
        );
      selectionBar.append(clear);
    }
    var stage = node("div", null, "stage");
    stage.append(viewport, selectionBar);
    left.append(tools, modeNote, stage);
    // Request the visible 200-dpi regions after zooming, then the regions just
    // outside the view so a pan lands on sharp detail. The low-resolution page
    // stays underneath as an immediate, non-blocking fallback.
    function scheduleDetail() {
      if (zoom <= 1 || !host.serverTools || !svg.isConnected) return;
      // Throttle rather than debounce, so detail keeps arriving during a long pan.
      if (detailTimer) return;
      detailTimer = setTimeout(function () {
        detailTimer = null;
        loadVisibleDetail();
      }, 100);
    }
    function viewBounds(margin) {
      var w = surface.clientWidth,
        h = surface.clientHeight;
      if (!w || !h) return null;
      var v = {
        x: viewport.scrollLeft / w,
        y: viewport.scrollTop / h,
        width: viewport.clientWidth / w,
        height: viewport.clientHeight / h,
      };
      return {
        x: v.x - v.width * margin,
        y: v.y - v.height * margin,
        width: v.width * (1 + 2 * margin),
        height: v.height * (1 + 2 * margin),
        cx: v.x + v.width / 2,
        cy: v.y + v.height / 2,
      };
    }
    function overlaps(tile, v) {
      var b = tile.bounds;
      return (
        b &&
        b.x < v.x + v.width &&
        b.x + b.width > v.x &&
        b.y < v.y + v.height &&
        b.y + b.height > v.y
      );
    }
    function tileDistance(tile, v) {
      return Math.hypot(
        tile.bounds.x + tile.bounds.width / 2 - v.cx,
        tile.bounds.y + tile.bounds.height / 2 - v.cy,
      );
    }
    function placeDetail(index, png) {
      if (detailImages.has(index)) return;
      var t = (sc.tiles || []).find(function (tile) {
        return tile.index === index;
      });
      if (!t || !t.bounds) return;
      var detail = svgNode("image", {
        href: png,
        x: t.bounds.x * viewWidth,
        y: t.bounds.y * viewHeight,
        width: t.bounds.width * viewWidth,
        height: t.bounds.height * viewHeight,
        preserveAspectRatio: "none",
        "pointer-events": "none",
      });
      svg.insertBefore(detail, svg.firstChild);
      detailImages.set(index, detail);
    }
    // Keep the regions nearest the view; drop the farthest when over the cap.
    function trimDetail() {
      var v = viewBounds(0);
      if (!v) return;
      while (detailImages.size > DETAIL_CAP) {
        var far = null,
          farDistance = -1;
        detailImages.forEach(function (_, index) {
          var t = (sc.tiles || []).find(function (tile) {
            return tile.index === index;
          });
          var d = t && t.bounds ? tileDistance(t, v) : Infinity;
          if (d > farDistance) {
            farDistance = d;
            far = index;
          }
        });
        if (far == null) return;
        detailImages.get(far).remove();
        detailImages.delete(far);
      }
    }
    function detailKey(index) {
      return detailSource + ":" + detailHash + ":" + detailSheet + ":" + index;
    }
    // After a redraw (selection, save, reload) put back regions already fetched.
    (sc.tiles || []).forEach(function (tile) {
      var png = detailCache.get(detailKey(tile.index));
      if (png) placeDetail(tile.index, png);
    });
    trimDetail();
    async function loadVisibleDetail() {
      if (detailInFlight >= 2 || zoom <= 1 || !svg.isConnected) return;
      var visible = viewBounds(0),
        near = viewBounds(0.6);
      if (!visible) return;
      function missing(v) {
        return (sc.tiles || [])
          .filter(function (tile) {
            return (
              overlaps(tile, v) && !detailImages.has(tile.index) && !detailRequested.has(tile.index)
            );
          })
          .sort(function (a, b) {
            return tileDistance(a, visible) - tileDistance(b, visible);
          });
      }
      // Visible regions first; then a ring around the view, within the cap.
      var wanted = missing(visible);
      if (!wanted.length && detailImages.size < DETAIL_CAP) wanted = missing(near);
      wanted = wanted.slice(0, 4);
      if (!wanted.length) return;
      wanted.forEach(function (tile) {
        detailRequested.add(tile.index);
      });
      detailInFlight++;
      // Start a second request alongside this one when more regions are waiting.
      scheduleDetail();
      var source = detailSource,
        hash = detailHash,
        sheet = detailSheet;
      try {
        var result = await call(
          "takeoff_geometry",
          args({
            operation: "tile",
            tile_indices: wanted.map(function (tile) {
              return tile.index;
            }),
            viewer_tile_only: true,
            source_id: source,
            sheet: sheet,
          }),
        );
        var data = result && result.structuredContent;
        if (
          !result ||
          result.isError ||
          !data ||
          !Array.isArray(data.tiles) ||
          data.tiles.length !== wanted.length ||
          data.source_id !== source ||
          data.source_hash !== hash ||
          data.sheet !== sheet ||
          !data.tiles.every(function (tile, index) {
            return (
              tile.index === wanted[index].index &&
              typeof tile.png === "string" &&
              /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(tile.png)
            );
          })
        )
          throw Error("Drawing detail could not be loaded.");
        data.tiles.forEach(function (tile) {
          detailCache.set(source + ":" + hash + ":" + sheet + ":" + tile.index, tile.png);
        });
        while (detailCache.size > DETAIL_CACHE_CAP)
          detailCache.delete(detailCache.keys().next().value);
        if (
          !svg.isConnected ||
          !sc.source ||
          sc.source.id !== source ||
          sc.source.content_hash !== hash ||
          sc.source.sheet !== sheet
        )
          return;
        data.tiles.forEach(function (tile) {
          placeDetail(tile.index, tile.png);
        });
        trimDetail();
      } catch (_) {
        // The original preview remains available; a later scroll or zoom can retry.
        return;
      } finally {
        detailInFlight--;
        wanted.forEach(function (tile) {
          detailRequested.delete(tile.index);
        });
      }
      scheduleDetail();
    }
    viewport.addEventListener("scroll", scheduleDetail, { passive: true });
    detailReady = true;
    // After a save or reload the svg is rebuilt; restore detail at the current zoom.
    scheduleDetail();
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
      removingPin = false;
      var line = sc.engine.lines.find(function (l) {
          return l.id === g.line_id;
        }),
        lineChanged = false;
      if (line) {
        lineChanged = selectedLine !== String(line.line_no);
        selectedLine = String(line.line_no);
        lineSelect.value = selectedLine;
      }
      if (g.calibration_id) cal.value = g.calibration_id;
      selectedCalibration = cal.value;
      mode = "inspect";
      draft = [];
      holes = [];
      // The side list opens the selected line; switching lines redraws it.
      if (lineChanged || !selected.isConnected) showList();
      else showSelected();
      showReadStatus();
      notice("Inspect mode. Saved marks are not changed by selecting them.");
    }
    var suppressPinClick = false;
    function geometry(shape, color, fill, id, offset) {
      if (!shape || !Array.isArray(shape.points) || !shape.points.every(validPoint)) return;
      var ps = shape.points,
        unit = viewWidth / Math.max(1, surface.getBoundingClientRect().width);
      if (shape.kind === "pins")
        ps.forEach(function (p, i) {
          // A white halo under a bolder ring keeps each pin easy to pick out on busy
          // linework while the centre stays open so the symbol shows through.
          var chosen = id && id === selectedGeometry && i === selectedPoint,
            radius = (chosen ? 12 : 10) * unit;
          svg.append(
            svgNode("circle", {
              cx: p.x * viewWidth,
              cy: p.y * viewHeight,
              r: radius,
              stroke: "white",
              fill: "none",
              "stroke-width": chosen ? 7 : 5.5,
              "stroke-opacity": 0.9,
              "vector-effect": "non-scaling-stroke",
              "pointer-events": "none",
            }),
          );
          var c = svgNode("circle", {
            cx: p.x * viewWidth,
            cy: p.y * viewHeight,
            r: radius,
            stroke: color,
            fill: "transparent",
            "stroke-width": chosen ? 3.5 : 2.5,
            "vector-effect": "non-scaling-stroke",
            "stroke-dasharray": fill === "white" ? "5 2.5" : "none",
          });
          function selectPin(e) {
            if (!id) return;
            e.stopPropagation();
            suppressPinClick = true;
            if (
              draft.length ||
              holes.some(function (hole) {
                return hole.length;
              })
            ) {
              notice("Finish or discard the unsaved drawing before inspecting a saved pin.");
              // Capture so the release always reaches the svg and clears the guard.
              svg.setPointerCapture(e.pointerId);
              return;
            }
            // Repeated clicks cycle coincident saved pins instead of adding a count.
            var nearby = [];
            var rect = surface.getBoundingClientRect();
            rows().forEach(function (g) {
              if (g.shape.kind !== "pins") return;
              g.shape.points.forEach(function (point, index) {
                if (Math.hypot((point.x - p.x) * rect.width, (point.y - p.y) * rect.height) <= 5)
                  nearby.push({ id: g.geometry_id, index: index });
              });
            });
            var at = nearby.findIndex(function (candidate) {
              return candidate.id === selectedGeometry && candidate.index === selectedPoint;
            });
            var target = nearby[(at + 1) % nearby.length] || { id: id, index: i };
            // The first press only selects. Moving a point starts only from a pin that
            // was already selected, so a click with a little hand movement never turns
            // a saved count into an editable copy.
            var wasSelected = selectedGeometry === target.id && selectedPoint === target.index;
            chooseGeometry(target.id, target.index);
            drag = wasSelected
              ? { index: target.index, startX: e.clientX, startY: e.clientY, moved: false }
              : null;
            svg.setPointerCapture(e.pointerId);
            overlay();
          }
          function stopPinClick(e) {
            if (id) {
              e.stopPropagation();
              suppressPinClick = false;
            }
          }
          if (id) {
            c.addEventListener("pointerdown", selectPin);
            c.addEventListener("click", stopPinClick);
          } else c.setAttribute("pointer-events", "none");
          svg.append(c);
          var line = sc.engine.lines.find(function (l) {
            return rows().some(function (g) {
              return g.geometry_id === id && g.line_id === l.id;
            });
          });
          var overlapIndex = 0;
          if (id) {
            var preceding = true;
            rows().forEach(function (g) {
              if (g.geometry_id === id) preceding = false;
              if (!preceding || g.shape.kind !== "pins") return;
              g.shape.points.forEach(function (other) {
                if (Math.hypot((other.x - p.x) * rectWidth(), (other.y - p.y) * rectHeight()) <= 5)
                  overlapIndex++;
              });
            });
          }
          function rectWidth() {
            return surface.getBoundingClientRect().width;
          }
          function rectHeight() {
            return surface.getBoundingClientRect().height;
          }
          var number = svgNode("text", {
            x: p.x * viewWidth + (radius + 3 * unit),
            y: p.y * viewHeight - (radius + overlapIndex * 13 * unit),
            "font-size": 11 * unit,
            "font-weight": 600,
            "dominant-baseline": "central",
            fill: color,
            stroke: "white",
            "stroke-width": 3 * unit,
            "paint-order": "stroke",
          });
          number.textContent =
            (line ? "L" + line.line_no + " · " : "") + String((offset || 0) + i + 1);
          if (id) {
            number.addEventListener("pointerdown", selectPin);
            number.addEventListener("click", stopPinClick);
          } else number.setAttribute("pointer-events", "none");
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
            e.stopPropagation();
            if (
              draft.length ||
              holes.some(function (hole) {
                return hole.length;
              })
            ) {
              notice("Finish or discard the unsaved drawing before inspecting saved work.");
              return;
            }
            chooseGeometry(id, 0);
            overlay();
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
      panCursor();
      showSelectionBar();
      showModeButtons();
      if (marksHidden) {
        svg.querySelectorAll("circle,path,text").forEach(function (e) {
          e.remove();
        });
        modeNote.textContent = "Marks hidden. Show marks before drawing or selecting work.";
        return;
      }
      modeNote.textContent =
        mode === "inspect"
          ? "Inspect mode: select a mark to see its line. Repeated clicks cycle overlapping marks."
          : draft.length && selectedGeometry
            ? "Moving points on the selected mark. Nothing changes until you save a revision."
            : "Adding " +
              mode +
              ": " +
              draft.length +
              " unsaved point(s). Select a saved mark to inspect it before adding points.";
      svg.querySelectorAll("circle,path,text").forEach(function (e) {
        e.remove();
      });
      var pinNumbers = {};
      rows().forEach(function (g) {
        var offset = pinNumbers[g.line_id] || 0,
          l = sc.engine.lines.find(function (l) {
            return l.id === g.line_id;
          }),
          ink = g.status === "rejected" ? "#6B7280" : lineInk(l && l.line_no);
        // Solid and filled: accepted. Dashed and open: proposed.
        geometry(g.shape, ink, g.status === "accepted" ? ink : "white", g.geometry_id, offset);
        if (g.shape.kind === "pins") pinNumbers[g.line_id] = offset + g.shape.points.length;
        var p = g.shape.points[0];
        if (p && g.shape.kind !== "pins") {
          var t = svgNode("text", {
            x:
              p.x * viewWidth +
              (11 * viewWidth) / Math.max(1, surface.getBoundingClientRect().width),
            y:
              p.y * viewHeight -
              (11 * viewWidth) / Math.max(1, surface.getBoundingClientRect().width),
            fill: ink,
            stroke: "white",
            "stroke-width": (3 * viewWidth) / Math.max(1, surface.getBoundingClientRect().width),
            "paint-order": "stroke",
            "font-weight": 600,
            "font-size": (12 * viewWidth) / Math.max(1, surface.getBoundingClientRect().width),
            "pointer-events": "none",
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
    // Click and drag on the sheet pans the zoomed drawing with a mouse or pen. A
    // drag never adds a point or selects a mark; a click without movement still
    // does. Touch keeps the browser's own scrolling.
    var pan = null,
      panConsumedClick = false;
    function panCursor() {
      svg.style.cursor = pan && pan.moved ? "grabbing" : mode === "inspect" ? "grab" : "crosshair";
    }
    svg.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "touch" || e.button !== 0 || drag) return;
      pan = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
        moved: false,
      };
    });
    svg.addEventListener("pointermove", function (e) {
      if (!pan || e.pointerId !== pan.id) return;
      var dx = e.clientX - pan.x,
        dy = e.clientY - pan.y;
      if (!pan.moved) {
        if (Math.hypot(dx, dy) < 5) return;
        pan.moved = true;
        try {
          svg.setPointerCapture(e.pointerId);
        } catch (err) {
          // The pointer may already be released; panning still follows moves.
        }
        panCursor();
      }
      e.preventDefault();
      viewport.scrollLeft = pan.left - dx;
      viewport.scrollTop = pan.top - dy;
    });
    function endPan() {
      if (pan && pan.moved) {
        panConsumedClick = true;
        // Clear after the click that follows this release, even if none comes.
        setTimeout(function () {
          panConsumedClick = false;
        }, 0);
      }
      pan = null;
      panCursor();
    }
    svg.addEventListener("pointerup", endPan);
    svg.addEventListener("pointercancel", endPan);
    svg.addEventListener("lostpointercapture", function () {
      if (pan && pan.moved) endPan();
    });
    // Capture phase runs before a mark's own click, so a drag that ends on a
    // line or area does not select it either.
    svg.addEventListener(
      "click",
      function (e) {
        if (!panConsumedClick) return;
        panConsumedClick = false;
        // Also stops the sheet's own add-point listener on this same element.
        e.stopImmediatePropagation();
        e.preventDefault();
      },
      true,
    );
    panCursor();
    svg.addEventListener("click", function (e) {
      if (suppressPinClick) {
        suppressPinClick = false;
        return;
      }
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
      if (drag.startX != null && !drag.moved) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
        drag.moved = true;
      }
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
    function endPress() {
      if (drag) {
        drag = null;
        showSelected();
      }
      // The click event is dispatched immediately after pointerup; clear the
      // guard afterward even when the browser cancels that click.
      setTimeout(function () {
        suppressPinClick = false;
      }, 0);
    }
    svg.addEventListener("pointerup", endPress);
    // A touch pan or lost capture ends the press without a pointerup.
    svg.addEventListener("pointercancel", endPress);
    svg.addEventListener("lostpointercapture", endPress);
    var edit = node("div", null, "desktop drawer drawpanel"),
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
      showList();
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
    function unsaved() {
      return (
        draft.length ||
        holes.some(function (hole) {
          return hole.length;
        })
      );
    }
    // One toolbar: select and pan, then the drawing tools. Calibrate starts from Setup.
    var modeButtons = {},
      modeGroup = node("span", null, "group"),
      areaPick = false;
    modeButtons.inspect = button("Select and pan", function () {
      function inspect() {
        mode = "inspect";
        draft = [];
        holes = [];
        activeHole = -1;
        areaPick = false;
        overlay();
        notice("Select a saved mark to see its takeoff line. Drag to move around the sheet.");
      }
      if (unsaved()) confirmBox("Discard the unsaved drawing and return to inspection?", inspect);
      else inspect();
    });
    modeGroup.append(modeButtons.inspect);
    function startMode(m, message) {
      if (marksHidden) return notice("Show marks before drawing so existing work stays visible.");
      function start() {
        mode = m;
        draft = [];
        holes = [];
        activeHole = -1;
        areaPick = false;
        selectedGeometry = null;
        selectedPoint = -1;
        notice(message || "Place " + m + " points on the sheet.");
        overlay();
        showPreview();
      }
      if (unsaved()) confirmBox("Discard the unsaved drawing and change tools?", start);
      else start();
    }
    [
      ["pins", "Count", "Click each item on the sheet to count it for the selected line."],
      ["polyline", "Run", "Click along the run; each click adds a point."],
      ["polygon", "Area", "Click each corner of the area."],
      ["rect", "Rectangle", "Click two opposite corners."],
    ].forEach(function (t) {
      modeButtons[t[0]] = button(
        t[1],
        function () {
          startMode(t[0], t[2]);
        },
        "desktop",
      );
      modeGroup.append(modeButtons[t[0]]);
    });
    var lineGroup = node("span", null, "group");
    lineGroup.append(node("span", "Line", "note small"), lineSelect);
    tools.prepend(modeGroup, lineGroup);
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
    // The drawing panel shows only while a tool is in use, with what that tool needs.
    var depthBox = node("div", null, "tools"),
      openingBox = node("div", null, "tools"),
      calBox = node("div", null, "tools"),
      saveBox = node("div", null, "tools");
    depthBox.append(depthValue, depthUnit, depthSource, depthSheet, detail);
    openingBox.append(
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
    );
    var undoPoint = button("Undo point", function () {
      if (activeHole >= 0) holes[activeHole].pop();
      else draft.pop();
      overlay();
      showPreview();
    });
    var saveGeometry = button(
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
    function regionBounds() {
      return {
        x: Number(boundsInputs.x.value),
        y: Number(boundsInputs.y.value),
        width: Number(boundsInputs.width.value),
        height: Number(boundsInputs.height.value),
      };
    }
    function confirmCountArea() {
      var areaBounds =
        mode === "rect" && draft.length === 2
          ? {
              x: Math.min(draft[0].x, draft[1].x),
              y: Math.min(draft[0].y, draft[1].y),
              width: Math.abs(draft[1].x - draft[0].x),
              height: Math.abs(draft[1].y - draft[0].y),
            }
          : regionBounds();
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
    }
    function chooseCountArea() {
      if (marksHidden) return notice("Show marks before drawing so existing work stays visible.");
      mode = "rect";
      draft = [];
      holes = [];
      activeHole = -1;
      areaPick = true;
      selectedGeometry = null;
      selectedPoint = -1;
      overlay();
      showPreview();
      notice(
        "Mark two opposite corners around the entire plan or room to count, then confirm the count area.",
      );
    }
    function startCalibration() {
      startMode(
        "calibrate",
        "Click the two ends of a dimension you know, enter its length, then confirm.",
      );
    }
    var confirmCalibration = button(
      "Confirm two-point calibration",
      function () {
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
              bounds: regionBounds(),
              reference: reference,
              confirm_reference: true,
              expected_version: existing ? existing.version : 0,
            });
          },
        );
      },
      "primary",
    );
    calBox.append(distance, referenceUnit, confirmCalibration);
    var drawTitle = node("strong");
    edit.append(drawTitle, preview, depthBox, openingBox, calBox, saveBox);
    function showModeButtons() {
      if (typeof modeButtons === "undefined" || !modeButtons) return;
      Object.keys(modeButtons).forEach(function (m) {
        var on = mode === m;
        modeButtons[m].classList.toggle("on", on);
        modeButtons[m].setAttribute("aria-pressed", on ? "true" : "false");
      });
      var drawing = mode !== "inspect";
      edit.hidden = !drawing;
      if (!drawing) return;
      var line = sc.engine.lines.find(function (l) {
        return l.line_no === Number(lineSelect.value);
      });
      drawTitle.textContent =
        mode === "calibrate"
          ? "Known dimension"
          : areaPick
            ? "Count area: " + (region.value.trim() || "unnamed")
            : "Adding to " + (line ? "L" + line.line_no + " · " + line.item : "the selected line");
      depthBox.hidden = !(
        !areaPick &&
        mode !== "calibrate" &&
        line &&
        /^cy$/i.test(line.unit || "")
      );
      openingBox.hidden = areaPick || (mode !== "polygon" && mode !== "rect");
      calBox.hidden = mode !== "calibrate";
      saveBox.replaceChildren(undoPoint);
      if (areaPick) saveBox.append(button("Confirm count area", confirmCountArea, "primary"));
      else if (mode !== "calibrate") saveBox.append(saveGeometry);
    }
    left.insertBefore(edit, left.querySelector(".stage"));
    left.append(
      node(
        "p",
        "On a phone, zoom and review here; place or move geometry on a screen at least 768 px wide.",
        "note small mobile-only",
      ),
    );
    // Setup holds what is done once per sheet: the scale, the count area and work
    // with no drawing, with rarely needed controls under Advanced.
    var setupBox = node("div");
    var scaleBox = node("section", null, "panel");
    setupBox.append(scaleBox);
    scaleBox.append(node("h2", "Scale"));
    var lockedCal = sc.engine.calibrations
      .filter(function (c) {
        return c.source_id === sc.source.id && c.page === sc.source.page && c.confirmed;
      })
      .sort(function (a, b) {
        return b.version - a.version;
      })[0];
    if (sc.scale_lock && !sc.scale_lock.locked) {
      scaleBox.append(node("p", sc.scale_lock.question));
      scaleBox.append(button("1 · Use a known dimension", startCalibration));
      var stated = node("input");
      stated.ariaLabel = "Scale stated for this plan region";
      stated.placeholder = 'For example: 3/16" = 1\'-0"';
      if (sc.scale_lock.printed_scales.length === 1 && !sc.scale_lock.as_noted)
        stated.value = sc.scale_lock.printed_scales[0];
      scaleBox.append(
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
                bounds: regionBounds(),
                stated_scale: stated.value.trim(),
                confirm_true_size: true,
                confirm_reference: true,
                expected_version: existing ? existing.version : 0,
              });
            },
          );
        }),
      );
    } else {
      scaleBox.append(
        node(
          "p",
          lockedCal
            ? "Locked for " + lockedCal.region + " · revision " + lockedCal.version
            : "No confirmed scale on this sheet yet. Counts do not need one.",
          "note",
        ),
        button("Check a known dimension", startCalibration),
      );
    }
    scaleBox.append(node("p", "Calibration used for new measurements", "note small"), cal);
    var areaBox = node("section", null, "panel");
    areaBox.append(
      node("h2", "Count area"),
      region,
      node(
        "p",
        "Counts need a confirmed plan or room area, not a scale. Mark its two opposite corners on the sheet, then confirm.",
        "note small",
      ),
      button("Choose count area", chooseCountArea),
      button("Confirm count area", confirmCountArea),
    );
    setupBox.append(areaBox);
    var advanced = node("details", null, "panel");
    advanced.append(
      node("summary", "Advanced"),
      node(
        "p",
        "Page bounds for the count area or scale region, from 0 to 1. Use these when corners are easier to type than to click.",
        "note small",
      ),
      bounds,
      node("p", "Show your AI one stored 200 dpi region of this sheet.", "note small"),
      tileSelect,
      tileRead,
    );
    showModeButtons();
    // Side panel in three tabs: Lines to review, Checks to read, Setup done once per sheet.
    var tabBar = node("div", null, "tabs"),
      panes = {};
    tabBar.setAttribute("role", "tablist");
    [
      ["lines", "Lines"],
      ["checks", "Checks"],
      ["setup", "Setup"],
    ].forEach(function (t) {
      var b = button(
        t[1],
        function () {
          setTab(t[0]);
        },
        "tab",
      );
      b.setAttribute("role", "tab");
      b.dataset.tab = t[0];
      tabBar.append(b);
      panes[t[0]] = node("div", null, "pane");
      panes[t[0]].setAttribute("role", "tabpanel");
      panes[t[0]].ariaLabel = t[1];
    });
    right.append(tabBar, panes.lines, panes.checks, panes.setup);
    function setTab(t) {
      panelTab = panes[t] ? t : "lines";
      Array.prototype.forEach.call(tabBar.children, function (b) {
        b.setAttribute("aria-selected", b.dataset.tab === panelTab ? "true" : "false");
      });
      Object.keys(panes).forEach(function (k) {
        panes[k].hidden = k !== panelTab;
      });
      size();
    }
    // The open line's selected mark: its revision and the rarer actions on it.
    var selected = node("div", null, "picked");
    function showSelected() {
      selected.replaceChildren();
      var g = rows().find(function (g) {
        return g.geometry_id === selectedGeometry;
      });
      if (!g || String((lineOf(g) || {}).line_no) !== String(selectedLine)) return;
      var facts =
        "Selected mark · revision " + g.version + " · " + g.status + " · " + quantityText(g);
      if (g.shape.kind === "pins" && selectedPoint >= 0)
        facts += " · pin " + (selectedPoint + 1) + " of " + g.shape.points.length;
      selected.append(node("p", facts, "small"));
      var actions = node("div", null, "tools");
      actions.append(
        button("Measurement history", function () {
          act("takeoff_geometry", { operation: "history", geometry_id: g.geometry_id });
        }),
        button("Inspect selected pin or vertex", function () {
          act("takeoff_geometry", {
            operation: "crop",
            crop_point: g.shape.points[Math.max(0, selectedPoint)],
          });
        }),
      );
      selected.append(actions);
      if (sc.crop && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sc.crop.png)) {
        var crop = node("img", null, "crop");
        crop.src = sc.crop.png;
        crop.alt = "160 pixel crop from original sheet";
        selected.append(crop);
      }
      var reason = node("textarea");
      reason.placeholder = "Reason for rejecting or deleting";
      reason.ariaLabel = "Rejection reason";
      var fix = node("div", null, "tools");
      fix.append(
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
        fix.append(
          button("Delete selected pin", function () {
            removePin(g, selectedPoint, reason.value);
          }),
        );
      selected.append(reason, fix);
    }
    var filterChips = node("div", null, "chips"),
      list = node("div", null, "list");
    var FILTERS = [
      ["all", "All"],
      ["proposed", "To review"],
      ["accepted", "Accepted"],
      ["unlocated", "Not found"],
      ["not_drawable", "Not drawable"],
      ["rejected", "Rejected"],
    ];
    if (sc.include_rejected) statusFilter = "rejected";
    if (
      !FILTERS.some(function (f) {
        return f[0] === statusFilter;
      })
    )
      statusFilter = "all";
    function lineSubtitle(l) {
      if (l.status === "accepted") return "Accepted";
      if (l.status === "proposed") return "Proposed · needs your review";
      if (l.status === "unlocated") return "Not found on a drawing yet";
      return l.status.replace("_", " ") + (l.reason ? " · " + l.reason : "");
    }
    function showList() {
      filterChips.replaceChildren();
      FILTERS.forEach(function (f) {
        var chip = button(f[1], function () {
          var wasRejected = statusFilter === "rejected";
          statusFilter = f[0];
          if (wasRejected !== (statusFilter === "rejected")) {
            selectedGeometry = null;
            selectedPoint = -1;
          }
          showList();
          overlay();
        });
        chip.classList.toggle("on", statusFilter === f[0]);
        chip.setAttribute("aria-pressed", statusFilter === f[0] ? "true" : "false");
        filterChips.append(chip);
      });
      list.replaceChildren();
      if (statusFilter === "rejected") {
        rows()
          .filter(function (g) {
            return g.status === "rejected";
          })
          .forEach(function (g) {
            var l = lineOf(g),
              r = node("div", null, "row note");
            r.append(
              node("strong", "L" + (l && l.line_no) + " · " + (l && l.item)),
              node("p", g.reason || "Reason not recorded"),
              node("p", "Rejected geometry · revision " + g.version),
            );
            list.append(r);
          });
        return;
      }
      var shown = sc.engine.summary.lines.filter(function (l) {
        return statusFilter === "all" || l.status === statusFilter;
      });
      // A pin selected on the drawing always opens its line, even under a filter.
      if (
        selectedGeometry &&
        selectedLine &&
        !shown.some(function (l) {
          return String(l.line_no) === String(selectedLine);
        })
      ) {
        statusFilter = "all";
        return showList();
      }
      shown.forEach(function (l) {
        var open = String(l.line_no) === String(selectedLine),
          r = node("div", null, "line" + (open ? " sel" : "")),
          headRow = node("button", null, "linehead"),
          dot = node("span", null, "dot"),
          qty =
            l.accepted != null
              ? Number(l.accepted).toFixed(/^ea$/i.test(l.unit) ? 0 : 2) + " " + l.unit
              : l.proposed != null
                ? Number(l.proposed).toFixed(/^ea$/i.test(l.unit) ? 0 : 2) + " " + l.unit
                : "—";
        r.dataset.line = String(l.line_no);
        headRow.type = "button";
        headRow.setAttribute("aria-expanded", open ? "true" : "false");
        dot.style.background = lineInk(l.line_no);
        headRow.append(
          dot,
          node("strong", "L" + l.line_no + " · " + l.item),
          node("span", qty, "qty"),
          node("span", lineSubtitle(l), "sub"),
        );
        headRow.addEventListener("click", function () {
          openLine(l.line_no);
        });
        r.append(headRow);
        if (!open) {
          list.append(r);
          return;
        }
        var det = node("div", null, "detail");
        r.append(det);
        var sheetPins = linePins(l.line_id);
        sc.engine.geometry
          .filter(function (g) {
            return (
              g.line_id === l.line_id && g.status !== "rejected" && g.shape.kind !== "not_drawable"
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
              det.append(
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
              det.append(
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
            var mark = node("div", null, "mark");
            mark.append(
              node(
                "p",
                (g.shape.kind === "pins"
                  ? g.shape.points.length + " pins"
                  : { polyline: "Run", polygon: "Area", rect: "Rectangle" }[g.shape.kind] ||
                    g.shape.kind) +
                  " · " +
                  quantityText(g) +
                  " · " +
                  g.status +
                  " · revision " +
                  g.version,
                "small",
              ),
            );
            if (g.evidence && typeof g.evidence.confidence === "number")
              mark.append(
                node(
                  "p",
                  "Reported AI confidence: " +
                    Math.round(g.evidence.confidence * 100) +
                    "% · interpretation, not accuracy." +
                    (g.status === "proposed" ? " Verify item identity before accepting." : ""),
                  "note small",
                ),
              );
            var acts = node("div", null, "tools");
            if (g.status === "proposed")
              acts.append(
                button(
                  "Accept " + quantityText(g),
                  function () {
                    acceptGeometry(g);
                  },
                  "primary",
                ),
              );
            if (selectedGeometry !== g.geometry_id)
              acts.append(
                button("Show on drawing", function () {
                  chooseGeometry(g.geometry_id, 0);
                  overlay();
                  if (g.shape.points[0]) centerOn(g.shape.points[0]);
                }),
              );
            mark.append(acts);
            det.append(mark);
          });
        if (sheetPins.length > 1) {
          var walk = node("div", null, "tools");
          walk.append(
            button("Previous pin", function () {
              stepPin(-1, l.line_id);
            }),
            button("Next pin", function () {
              stepPin(1, l.line_id);
            }),
          );
          det.append(walk);
        }
        if (l.status === "proposed")
          det.append(
            node(
              "p",
              "The ink check confirms each mark touches drawing linework. It does not confirm the item, or that every one was found.",
              "note small",
            ),
          );
        var gbb = optionsBlock(l.line_no);
        if (gbb) det.append(gbb);
        det.append(readPanel);
        showReadStatus();
        det.append(
          button("Line history", function () {
            act("takeoff_geometry", { operation: "history", line_no: l.line_no });
          }),
          selected,
        );
        showSelected();
        list.append(r);
      });
      size();
    }
    var proposals = rows().filter(function (g) {
      return reviewableProposal(sc, g);
    });
    panes.lines.append(filterChips, list);
    if (proposals.length)
      panes.lines.append(
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
    var readPanel = node("div", null, "readpanel");
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
    showList();
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
    // Checks: what holds the bid, the read guidance, and the other review notes.
    var holding = (sc.engine.gaps || []).filter(function (g) {
      return g.holds_bid;
    });
    if (holding.length) {
      var holdBox = node("section");
      holdBox.append(node("h2", "Holds the bid"));
      holding.forEach(function (g) {
        var r = node("div", null, "row risk");
        r.dataset.alert = "risk";
        r.append(node("strong", g.ref + " · " + g.title), node("p", g.reasoning));
        holdBox.append(r);
      });
      panes.checks.append(holdBox);
    }
    extraSections(panes.checks);
    if (!panes.checks.childNodes.length)
      panes.checks.append(node("p", "No open checks on this sheet.", "note"));
    // Setup: scale and count area first, then work with no drawing, then Advanced.
    panes.setup.append(setupBox);
    var nonDrawable = node("section", null, "panel");
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
        nonDrawable.append(
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
    nonDrawable.prepend(
      node("h2", "Non-drawable work"),
      node(
        "p",
        "For the selected line, when its quantity comes from a schedule, specification or allowance instead of the drawing.",
        "note small",
      ),
    );
    nonDrawable.append(
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
    panes.setup.append(nonDrawable, advanced);
    setTab(panelTab);
    // The four steps, worked out from the saved takeoff for this sheet.
    function stepStates() {
      var lines = sc.engine.summary.lines || [],
        unlocated = lines.filter(function (l) {
          return l.status === "unlocated";
        }).length,
        toReview = lines.filter(function (l) {
          return l.status === "proposed";
        }).length,
        accepted = lines.filter(function (l) {
          return l.status === "accepted";
        }).length,
        locked = !(sc.scale_lock && !sc.scale_lock.locked),
        exported = (sc.engine.exports || []).some(function (e) {
          return e.source_id === sc.source.id && e.page === sc.source.page;
        });
      return [
        {
          key: "scale",
          title: "Scale",
          done: locked,
          text: !locked
            ? "Not locked yet"
            : lockedCal
              ? "Locked for " + lockedCal.region
              : "Counts need no scale",
        },
        {
          key: "read",
          title: "Read",
          done: lines.length > 0 && unlocated === 0,
          text:
            lines.length -
            unlocated +
            " of " +
            lines.length +
            " lines found" +
            (unlocated ? " · " + unlocated + " not found yet" : ""),
        },
        {
          key: "review",
          title: "Review",
          done: toReview === 0 && accepted > 0,
          text: accepted + " of " + lines.length + " lines accepted",
        },
        {
          key: "finish",
          title: "Finish",
          done: exported,
          text: exported ? "Dated PDF saved" : "Save a dated PDF of this sheet",
        },
      ];
    }
    function showSteps() {
      var states = stepStates(),
        firstOpen = states.findIndex(function (s) {
          return !s.done;
        }),
        current = states.findIndex(function (s) {
          return s.key === guideStep;
        });
      if (current < 0) current = firstOpen < 0 ? states.length - 1 : firstOpen;
      steps.replaceChildren();
      states.forEach(function (s, i) {
        var b = node(
          "button",
          null,
          "step" + (s.done ? " done" : "") + (i === current ? " on" : ""),
        );
        b.type = "button";
        b.setAttribute("aria-current", i === current ? "step" : "false");
        b.append(
          node("span", i + 1 + " · " + (s.done ? "done" : i === firstOpen ? "next" : ""), "n"),
          node("strong", s.title),
          node("span", s.text),
        );
        b.addEventListener("click", function () {
          guideStep = s.key;
          showSteps();
        });
        steps.append(b);
      });
      showGuide(states[current]);
    }
    function showGuide(step) {
      guide.replaceChildren();
      var say = node("p"),
        acts = node("div", null, "tools");
      guide.append(say, acts);
      if (step.key === "scale") {
        if (!step.done) {
          say.textContent =
            "Lock the scale before measuring runs or areas: use a known dimension, or the scale printed on the sheet.";
          acts.append(
            button(
              "Set the scale",
              function () {
                setTab("setup");
                scaleBox.scrollIntoView({ block: "nearest" });
              },
              "primary",
            ),
          );
        } else {
          say.textContent =
            step.text + ". Check a known dimension any time to confirm the scale is right.";
          acts.append(button("Check a known dimension", startCalibration, "primary"));
        }
      } else if (step.key === "read") {
        say.textContent =
          "Your AI reads this sheet in the chat and sends back proposed pins. You stay here, and nothing counts until you accept it.";
        acts.append(
          button("Ask your AI to read the whole sheet", runSheetRead, "primary"),
          button("Ask your AI to read selected line", runRead),
          button("Ask your AI to read smaller regions", function () {
            runRead(true);
          }),
        );
        if (sc.sheet_read)
          guide.append(
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
              "note small",
            ),
          );
      } else if (step.key === "review") {
        var next = (sc.engine.summary.lines || []).find(function (l) {
          return l.status === "proposed";
        });
        say.textContent = next
          ? "Look over each line's pins. Click a pin to see what it is, fix anything off, then accept the line."
          : "Every proposed line on this sheet has been reviewed.";
        if (next)
          acts.append(
            button(
              "Start with L" + next.line_no,
              function () {
                setTab("lines");
                openLine(next.line_no);
              },
              "primary",
            ),
          );
      } else {
        say.textContent =
          "Save a dated PDF of this sheet with your marks. The original drawing is never changed.";
        acts.append(
          button(
            "Save dated measured PDF",
            function () {
              act("takeoff_geometry", { operation: "export" });
            },
            "primary",
          ),
        );
        if (sc.export && sc.export.url)
          acts.append(
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
        (sc.engine.exports || [])
          .filter(function (e) {
            return e.source_id === sc.source.id && e.page === sc.source.page;
          })
          .slice(0, 20)
          .forEach(function (e) {
            acts.append(
              button("Dated PDF · " + e.created_at, function () {
                act("takeoff_geometry", { operation: "download", markup_id: e.id });
              }),
            );
          });
      }
      size();
    }
    showSteps();
    left.append(
      node(
        "p",
        "Each line has its own color. Solid ring: accepted. Dashed ring: proposed. Labels name the line and count. Counts and dimensions come from geometry; no typed quantity changes a measured result.",
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
