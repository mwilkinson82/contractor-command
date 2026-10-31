(function () {
  var app = document.getElementById("app"),
    status = document.getElementById("status"),
    parentOrigin = null;
  var ready = false,
    closed = false,
    host = {},
    id = 2,
    requests = new Map(),
    current = null,
    portfolio = null,
    busy = false,
    completed = null,
    queuedResult = null,
    resizeObserver = null;
  var loaded = new Set(),
    UUID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
  function send(m) {
    if (!closed)
      window.parent.postMessage(
        Object.assign({ jsonrpc: "2.0" }, m),
        parentOrigin && parentOrigin !== "null" ? parentOrigin : "*",
      );
  }
  function size() {
    if (ready) {
      var b = document.body.getBoundingClientRect();
      send({
        method: "ui/notifications/size-changed",
        params: { width: Math.ceil(b.width), height: Math.ceil(b.height) },
      });
    }
  }
  function node(tag, text) {
    var n = document.createElement(tag);
    if (text != null) n.textContent = String(text);
    return n;
  }
  function same(a, b) {
    return (
      a &&
      b &&
      a.company_id === b.company_id &&
      a.job_number === b.job_number &&
      a.upload_id === b.upload_id
    );
  }
  function valid(c) {
    return (
      c &&
      UUID.test(c.company_id) &&
      UUID.test(c.upload_id) &&
      typeof c.job_number === "string" &&
      c.job_number.length > 0 &&
      c.job_number.length <= 40
    );
  }
  function contextKey(c) {
    return JSON.stringify([c.company_id, c.job_number, c.upload_id]);
  }
  function confirmed(c) {
    return (
      completed &&
      same(completed, c) &&
      completed.filename === c.filename &&
      completed.job_association === "verified"
    );
  }
  function settled() {
    busy = false;
    if (closed) return;
    if (queuedResult) {
      var next = queuedResult;
      queuedResult = null;
      result(next);
    } else render();
  }
  function urlFor(c) {
    try {
      var u = new URL(c.upload_url);
      return u.origin === "https://app.meetathena.io" &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        /^\/r\/file-upload\/[A-Za-z0-9_-]{43}$/.test(u.pathname)
        ? u.href
        : null;
    } catch (_) {
      return null;
    }
  }
  function message(r) {
    return (
      ((r && r.content) || [])
        .filter(function (b) {
          return b.type === "text";
        })
        .map(function (b) {
          return b.text;
        })
        .join(" ")
        .slice(0, 600) || "Athena did not confirm the file. Retry completion."
    );
  }
  function call(args, name) {
    if (!host.serverTools || closed)
      return Promise.reject(new Error("This host cannot complete uploads from this card."));
    return new Promise(function (resolve, reject) {
      var key = id++,
        timer = setTimeout(function () {
          requests.delete(key);
          reject(new Error("Completion was not confirmed. Retry the same upload."));
        }, 180000);
      requests.set(key, { resolve: resolve, reject: reject, timer: timer });
      send({
        id: key,
        method: "tools/call",
        params: { name: name || "file_upload", arguments: args },
      });
    });
  }
  function args(c, action) {
    return {
      action: action,
      company_id: c.company_id,
      job_number: c.job_number,
      upload_id: c.upload_id,
    };
  }
  function remember() {
    if (!valid(current)) return;
    var reference = {
      company_id: current.company_id,
      job_number: current.job_number,
      upload_id: current.upload_id,
    };
    try {
      if (window.openai && window.openai.setWidgetState)
        window.openai.setWidgetState({
          modelContent: reference,
          privateContent: { athenaUpload: reference },
        });
    } catch (_) {}
  }
  function button(label, fn, primary) {
    var b = node("button", label);
    b.type = "button";
    if (primary) b.className = "primary";
    b.disabled = busy || !host.serverTools;
    b.addEventListener("click", fn);
    return b;
  }
  function incompleteTransfer(upload) {
    return upload && !upload.bytes_received && Number(upload.received_chunks || 0) > 0;
  }
  function sameJob(a, b) {
    return a && b && a.company_id === b.company_id && a.job_number === b.job_number;
  }
  function savedFiles(body, list) {
    if (!list) return;
    body.append(node("h2", "Saved files"));
    var docs = Array.isArray(list.documents) ? list.documents.slice() : [];
    if (
      sameJob(completed, list) &&
      completed.document_id &&
      !docs.some(function (d) {
        return d.id === completed.document_id;
      })
    )
      docs.unshift({
        id: completed.document_id,
        name: completed.filename,
        kind: completed.purpose || "File",
      });
    docs.forEach(function (d) {
      var row = node("section");
      row.className = "row saved";
      row.append(node("strong", d.name), node("p", (d.kind || "File") + " · Saved"));
      body.append(row);
    });
    if (!docs.length)
      body.append(
        node(
          "p",
          Array.isArray(list.documents) ? "No saved files on this page." : "Loading saved files…",
        ),
      );
    if (list.saved_list_unavailable)
      body.append(
        node("p", "The saved file is confirmed. The rest of the file list could not be loaded."),
      );
  }
  function render() {
    if (closed) return;
    var verified = confirmed(current);
    var shell = node("article"),
      head = node("header"),
      body = node("main");
    head.append(node("h1", verified ? "Saved" : current ? "Add file" : "Job files"));
    shell.append(head, body);
    status.hidden =
      status.textContent === "File added to job." &&
      !!(verified || (portfolio && sameJob(completed, portfolio)));
    if (current) {
      body.append(node("strong", current.filename), node("p", "Job " + current.job_number));
      if (verified) {
        body.append(
          node(
            "p",
            "Saved to job " +
              current.job_number +
              (current.purpose === "submittal_piece"
                ? ". Attached to its submittal."
                : ". Available in this job's saved files."),
          ),
        );
        savedFiles(
          body,
          portfolio || {
            company_id: current.company_id,
            job_number: current.job_number,
            documents: [],
          },
        );
        if (completed.readable_state === "failed")
          body.append(
            node(
              "p",
              "The original is saved, but readable text preparation needs another attempt.",
            ),
          );
      } else if (current.verification_pending) {
        body.append(
          node("p", "Athena could not verify this upload's current access and status."),
          button(
            "Retry completion",
            function () {
              recover(current);
            },
            true,
          ),
        );
      } else if (current.expired && !current.bytes_received && current.status !== "finished") {
        body.append(
          node(
            "p",
            incompleteTransfer(current)
              ? "This upload expired with an incomplete transfer. The complete file is not confirmed."
              : "This upload expired without a complete, eligible file. Start a new upload only if you want to try again.",
          ),
        );
        if (current.restart) body.append(button("Start new upload", restart));
      } else if (incompleteTransfer(current)) {
        body.append(
          node(
            "p",
            "Incomplete transfer. " +
              String(current.received_chunks) +
              (Number(current.received_chunks) === 1 ? " chunk recorded; " : " chunks recorded; ") +
              "the full file is not ready to attach.",
          ),
          node("p", "Continue the original transfer in this chat using the same request."),
          button(
            "Check upload status",
            function () {
              recover(current);
            },
            true,
          ),
        );
      } else if (current.received_via === "chunks") {
        body.append(
          node(
            "p",
            String(current.received_chunks || 0) +
              " chunks received. Athena cannot determine whether you sent every intended chunk. Finish only when the full file has been sent.",
          ),
          button(
            "Finish received chunks",
            function () {
              recover(current, true);
            },
            true,
          ),
        );
      } else if (current.receipt_uncertain && !current.bytes_received) {
        body.append(
          node("p", "Upload status is unknown. Check before sending the file again."),
          button(
            "Check upload status",
            function () {
              recover(current);
            },
            true,
          ),
        );
      } else if (current.bytes_received || current.status === "finished") {
        body.append(
          node("p", "Upload received. Job attachment is awaiting confirmation."),
          button(
            "Retry completion",
            function () {
              recover(current);
            },
            true,
          ),
        );
      } else if (urlFor(current)) {
        var picker = node("input");
        picker.type = "file";
        picker.accept = ".pdf,.docx,.txt";
        picker.ariaLabel = "File for this job";
        picker.disabled = busy;
        body.append(
          picker,
          button(
            "Add file to job",
            function () {
              var f = picker.files && picker.files[0];
              if (!f) {
                status.textContent = "Choose a file first.";
                return;
              }
              upload(f);
            },
            true,
          ),
        );
      } else {
        body.append(
          node(
            "p",
            "No complete file is confirmed. Attach the original in this chat to continue with this same upload request.",
          ),
        );
      }
      var options = node("details");
      options.append(node("summary", "More options"));
      if (!verified)
        options.append(
          button("Refresh upload status", function () {
            recover(current);
          }),
        );
      options.append(
        button("Show job files", function () {
          showPending({ company_id: current.company_id, job_number: current.job_number });
        }),
      );
      body.append(options);
    } else if (portfolio) {
      body.append(node("p", "Job " + portfolio.job_number));
      savedFiles(body, portfolio);
      var uploads = portfolio.pending_uploads || [],
        received = uploads.filter(function (u) {
          return u.bytes_received;
        }),
        partial = uploads.filter(incompleteTransfer),
        empty = uploads.filter(function (u) {
          return !u.bytes_received && !incompleteTransfer(u);
        });
      function uploadRow(u, parent) {
        var c = {
          company_id: portfolio.company_id,
          job_number: portfolio.job_number,
          upload_id: u.upload_id,
          filename: u.filename,
        };
        var row = node("section");
        row.className = "row";
        row.append(
          node("strong", u.filename),
          node(
            "p",
            u.bytes_received
              ? u.received_via === "chunks"
                ? String(u.received_chunks) + " chunks received; completeness unconfirmed"
                : "File received; ready to attach"
              : incompleteTransfer(u)
                ? u.expired
                  ? "Expired · Incomplete transfer"
                  : "Incomplete transfer · Full file not ready"
                : u.expired
                  ? "Expired request · No eligible file confirmed"
                  : "Waiting for a file",
          ),
          button(
            u.expired && !u.bytes_received ? "Review expired upload" : "Resume upload",
            function () {
              recover(c);
            },
          ),
        );
        parent.append(row);
      }
      if (received.length) {
        body.append(node("h2", "Received files to attach"));
        received.forEach(function (u) {
          uploadRow(u, body);
        });
      }
      if (partial.length) {
        var transfers = node("details");
        transfers.append(
          node("summary", String(partial.length) + " incomplete transfers"),
          node(
            "p",
            "Some chunks were recorded, but the complete file is not confirmed. These transfers are not ready to attach.",
          ),
        );
        partial.forEach(function (u) {
          uploadRow(u, transfers);
        });
        body.append(transfers);
      }
      if (empty.length) {
        var requests = node("details");
        requests.append(
          node("summary", String(empty.length) + " requests awaiting a file"),
          node(
            "p",
            "These requests are separate from the saved files above. No complete, eligible file is confirmed for them.",
          ),
        );
        empty.forEach(function (u) {
          uploadRow(u, requests);
        });
        body.append(requests);
      }
      if (portfolio.pending_unavailable)
        body.append(node("p", "Upload requests could not be loaded. Saved files are shown above."));
      if (portfolio.pending_next_before)
        body.append(
          button("More pending uploads", function () {
            showPending(portfolio, portfolio.pending_next_before);
          }),
        );
      body.append(
        button("Refresh job files", function () {
          showPending(portfolio);
        }),
      );
    }
    if (!host.serverTools)
      body.append(
        node(
          "p",
          "This host cannot run upload controls. Athena can list your pending uploads and complete the selected one in the conversation.",
        ),
      );
    app.replaceChildren(shell);
    size();
  }
  async function finish(c) {
    if (c.expired && !c.bytes_received && c.status !== "finished") return;
    status.textContent = "Adding the file to your job…";
    size();
    var r = await call(args(c, "finish")),
      sc = r && r.structuredContent;
    if (
      !sc ||
      !same(c, sc) ||
      sc.filename !== c.filename ||
      sc.job_association !== "verified" ||
      !(UUID.test(sc.document_id || "") || UUID.test(sc.piece_id || ""))
    )
      throw new Error("The exact job attachment was not confirmed. Retry completion.");
    completed = sc;
    current = c;
    remember();
    var facts = {
      company_id: c.company_id,
      job_number: c.job_number,
      upload_id: c.upload_id,
      filename: sc.filename,
      document_id: sc.document_id || null,
      piece_id: sc.piece_id || null,
      job_association: "verified",
    };
    send({
      id: id++,
      method: "ui/update-model-context",
      params: {
        structuredContent: facts,
        content: [{ type: "text", text: JSON.stringify(facts) }],
      },
    });
    status.textContent = "File added to job.";
    try {
      var listing = await call(
          {
            action: "list",
            company_id: c.company_id,
            job_number: c.job_number,
            offset: 0,
            limit: 25,
          },
          "project_documents",
        ),
        files = listing && listing.structuredContent;
      if (!sameJob(c, files) || !Array.isArray(files.documents))
        throw new Error("Saved list unavailable");
      portfolio = files;
    } catch (_) {
      portfolio = {
        company_id: c.company_id,
        job_number: c.job_number,
        documents: [],
        saved_list_unavailable: true,
      };
    }
  }
  async function recover(c, finishChunks) {
    if (busy || !valid(c) || !host.serverTools || closed) return;
    busy = true;
    completed = null;
    current = c;
    remember();
    render();
    status.textContent = "Checking this upload…";
    try {
      var r = await call(args(c, "resume")),
        sc = r && r.structuredContent,
        next = sc && sc.upload_context;
      if (!valid(next) || !same(c, next))
        throw new Error("Athena returned a different upload. Nothing was attached.");
      current = Object.assign(
        {},
        next,
        !next.upload_url && c.upload_url && !next.expired ? { upload_url: c.upload_url } : {},
      );
      remember();
      if (
        (current.bytes_received && (current.received_via !== "chunks" || finishChunks)) ||
        current.status === "finished"
      )
        await finish(current);
      else
        status.textContent =
          current.received_via === "chunks"
            ? "Received chunks are ready for explicit completion. Check that you sent the full file."
            : incompleteTransfer(current)
              ? current.expired
                ? "Upload expired with an incomplete transfer."
                : "Transfer incomplete."
              : current.expired
                ? "Upload expired."
                : urlFor(current)
                  ? "Choose the file to add to this job."
                  : "";
    } catch (e) {
      current = Object.assign({}, current, { verification_pending: true });
      status.textContent = e.message || "Upload recovery was not confirmed.";
    } finally {
      settled();
    }
  }
  async function upload(file) {
    var c = current,
      url = c && urlFor(c),
      rejectedReceipt = false;
    if (busy || !url || !host.serverTools || closed) return;
    if (!file.size || file.size > 104857600) {
      status.textContent = "Choose a nonempty PDF, Word, or text file up to 100 MB.";
      return;
    }
    busy = true;
    completed = null;
    render();
    status.textContent = "Uploading your file…";
    try {
      var response = await fetch(url, {
        method: "PUT",
        credentials: "omit",
        headers: { "content-type": c.mime_type },
        body: file,
      });
      var receipt;
      try {
        receipt = await response.json();
      } catch (_) {
        rejectedReceipt = response.status >= 400 && response.status < 500;
        if (response.status === 410) current = Object.assign({}, current, { expired: true });
        throw new Error(
          response.status === 410
            ? "This upload expired. Start a new upload to continue."
            : "Upload was not confirmed. Refresh its status before retrying.",
        );
      }
      if (
        (!response.ok && response.status !== 409) ||
        receipt.stored !== true ||
        receipt.filename !== c.filename
      ) {
        rejectedReceipt = receipt.stored === false;
        if (response.status === 410) current = Object.assign({}, current, { expired: true });
        throw new Error(
          receipt.error || "Upload was not confirmed. Check its status before retrying.",
        );
      }
      current = Object.assign({}, c, { bytes_received: true });
      remember();
      await finish(current);
    } catch (e) {
      current = Object.assign({}, current, {
        receipt_uncertain: !rejectedReceipt && !current.bytes_received,
      });
      status.textContent =
        e.message || "Upload was not confirmed. Refresh its status before retrying.";
    } finally {
      settled();
    }
  }
  async function restart() {
    if (busy || !current || !current.restart || closed) return;
    var c = current,
      start = c.restart;
    if (start.company_id !== c.company_id || start.job_number !== c.job_number) return;
    busy = true;
    render();
    status.textContent = "Preparing your new upload…";
    try {
      var r = await call(Object.assign({}, start, { action: "begin" })),
        next = r && r.structuredContent && r.structuredContent.upload_context;
      if (!valid(next) || next.company_id !== c.company_id || next.job_number !== c.job_number)
        throw new Error("The new upload could not be verified.");
      current = next;
      completed = null;
      remember();
      status.textContent = "Choose the file.";
    } catch (e) {
      status.textContent = e.message;
    } finally {
      settled();
    }
  }
  async function showPending(c, before) {
    if (busy || !c || closed) return;
    busy = true;
    render();
    status.textContent = "Loading job files and pending uploads…";
    try {
      var r = before
        ? await call({
            action: "pending",
            company_id: c.company_id,
            job_number: c.job_number,
            before_upload: before,
          })
        : await call(
            {
              action: "list",
              company_id: c.company_id,
              job_number: c.job_number,
              offset: 0,
              limit: 25,
            },
            "project_documents",
          );
      var sc = r && r.structuredContent;
      if (
        !sc ||
        sc.company_id !== c.company_id ||
        sc.job_number !== c.job_number ||
        !Array.isArray(sc.pending_uploads)
      )
        throw new Error("The selected job's uploads could not be verified.");
      portfolio = Object.assign({}, sc, {
        documents: sc.documents || c.documents || (portfolio && portfolio.documents) || [],
      });
      current = null;
      if (!sameJob(completed, sc)) completed = null;
      status.textContent = "";
    } catch (e) {
      status.textContent = e.message;
    } finally {
      settled();
    }
  }
  function result(r) {
    if (closed) return;
    var sc = r && r.structuredContent;
    if (!sc) return;
    if (busy) {
      if (
        (valid(sc.upload_context) &&
          (!same(current, sc.upload_context) || current.filename !== sc.upload_context.filename)) ||
        Array.isArray(sc.pending_uploads)
      )
        queuedResult = r;
      return;
    }
    if (valid(sc.upload_context)) {
      var c = sc.upload_context;
      if (confirmed(current) && same(current, c) && completed.filename === c.filename) return;
      if (!same(current, c) || current.filename !== c.filename) {
        completed = null;
        loaded.delete(contextKey(c));
        status.textContent = "";
      }
      current = c;
      portfolio = null;
      render();
      if (!loaded.has(contextKey(c)) && host.serverTools) {
        loaded.add(contextKey(c));
        recover(c);
      }
    } else if (
      Array.isArray(sc.pending_uploads) &&
      UUID.test(sc.company_id) &&
      typeof sc.job_number === "string"
    ) {
      var prior = sameJob(portfolio, sc) ? portfolio : null;
      portfolio = Object.assign({}, sc, {
        documents: Array.isArray(sc.documents) ? sc.documents : prior && prior.documents,
      });
      current = null;
      if (!sameJob(completed, sc)) completed = null;
      render();
      if (!Array.isArray(sc.documents) && host.serverTools) showPending(portfolio);
    } else if (
      sc.job_association === "verified" &&
      valid(sc) &&
      (!current || same(current, sc)) &&
      (UUID.test(sc.document_id || "") || UUID.test(sc.piece_id || ""))
    ) {
      current = sc;
      completed = sc;
      portfolio = null;
      status.textContent = "File added to job.";
      render();
    }
  }
  function receive(event) {
    if (event.source !== window.parent || closed) return;
    var m = event.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (!ready) {
      if (m.id !== 1 || m.error || !m.result) return;
      parentOrigin = event.origin;
      host = m.result.hostCapabilities || {};
      ready = true;
      send({ method: "ui/notifications/initialized", params: {} });
      render();
      if (window.openai && window.openai.toolOutput)
        result({ structuredContent: window.openai.toolOutput });
      return;
    }
    if (event.origin !== parentOrigin) return;
    if (m.method == null && requests.has(m.id)) {
      var task = requests.get(m.id);
      requests.delete(m.id);
      clearTimeout(task.timer);
      if (m.error || (m.result && m.result.isError))
        task.reject(new Error((m.error && m.error.message) || message(m.result)));
      else task.resolve(m.result);
    } else if (m.method === "ui/notifications/tool-result") result(m.params);
    else if (m.method === "ping" && m.id != null) send({ id: m.id, result: {} });
    else if (m.method === "ui/resource-teardown") {
      send({ id: m.id, result: {} });
      closed = true;
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener("message", receive);
      requests.forEach(function (task) {
        clearTimeout(task.timer);
        task.reject(new Error("Upload view closed. Reopen your job files to resume."));
      });
      requests.clear();
    }
  }
  window.addEventListener("message", receive);
  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(size);
    resizeObserver.observe(document.body);
  }
  send({
    id: 1,
    method: "ui/initialize",
    params: {
      protocolVersion: "2026-01-26",
      appInfo: { name: "Athena job files", version: "1.0.0" },
      appCapabilities: { availableDisplayModes: ["inline"] },
    },
  });
})();
