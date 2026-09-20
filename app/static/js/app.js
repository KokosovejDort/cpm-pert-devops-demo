class HttpError extends Error {
  constructor(status, bodyText) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
    this.status = status;
    this.bodyText = bodyText;
  }
}
class JsonParseError extends Error {
  constructor(message, rawText) {
    super(message);
    this.name = "JsonParseError";
    this.rawText = rawText;
  }
}
class MappingError extends Error {
  constructor(message) {
    super(message);
    this.name = "MappingError";
  }
}

function show(out, kind, text) {
  const textEl = out.querySelector("#out-text");
  if (textEl) textEl.textContent = text;
  out.className = kind;
  out.style.display = "";
}

function buildRowHtml() {
  return `
        <td contenteditable="true">${getNextId()}</td>
        <td contenteditable="true"></td>
        <td contenteditable="true" class="col-duration-cell">0</td>
        <td contenteditable="true"></td>
        <td contenteditable="true" class="col-pert-cell"></td>
        <td contenteditable="true" class="col-pert-cell"></td>
        <td contenteditable="true" class="col-pert-cell"></td>
        <td><button class="btn-del btn btn-sm btn-outline-danger">Delete</button></td>
    `;
}

window.analyzeProject = async function analyzeProject(opts) {
  if (opts && opts.clearGhost) ganttGhostData = null;
  const out = document.getElementById("out");
  const debugJson = document.getElementById("debug-json");
  const btnAnalyze = document.getElementById("btn-analyze");
  saveState();
  try {
    btnAnalyze.innerHTML =
      '<span class="spinner-border spinner-border-sm"></span> Analyzing...';
    btnAnalyze.disabled = true;

    const tasksFromTable = readTable();
    const mode = isPertMode() ? "pert" : "cpm";
    const requestBody = JSON.stringify({ tasks: tasksFromTable, mode });
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    });

    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (jsonErr) {
      throw new JsonParseError(jsonErr.message, text);
    }

    if (!response.ok) {
      if (json.validation_errors) {
        clearTableErrors();
        applyValidationErrors(json.validation_errors);
        throw new Error("Validation failed. Check highlighted rows.");
      } else {
        throw new HttpError(response.status, text);
      }
    }

    if (!json || typeof json !== "object" || !json.result) {
      throw new Error("Invalid payload shape: missing 'result'.");
    }
    clearTableErrors();

    show(out, "ok", mode === "pert"
      ? "PERT analysis completed successfully."
      : "CPM analysis completed successfully.");

    if (debugJson) {
      debugJson.textContent = JSON.stringify(json.result, null, 2);
    }

    renderCpmSummary(json.result);
    renderCpmTable(json.result);

    try {
      const mapped = mapCpmToGantt(json.result);
      renderGantt(mapped);
    } catch (mappingErr) {
      throw new MappingError(mappingErr.message);
    }

    if (Array.isArray(json.result.nodes) && json.result.nodes.length > 0) {
      aoaElements = buildAoAElementsFromResult(json.result);
    } else {
      aoaElements = [];
    }
    aonElements = buildAoNElementsFromResult(json.result.aon);

    const networkTabBtn = document.getElementById("network-tab");
    const ganttTabBtn = document.getElementById("gantt-tab");
    if (networkTabBtn && ganttTabBtn) {
      // Cytoscape requires its container to be visible to compute layout correctly.
      // We briefly switch to the network tab (making #cpm-network visible), run the
      // layout, then switch back to the Gantt tab so the user lands there by default.
      networkTabBtn.click();
      setTimeout(() => {
        initOrUpdateNetwork();
        ganttTabBtn.click();
        setTimeout(() => scrollToFirstGanttTask(), 50);
      }, 10);
    } else {
      initOrUpdateNetwork();
    }
  } catch (err) {
    document.getElementById("cpm-summary").innerHTML = "";
    document.getElementById("cpm-table").innerHTML = "";

    if (err instanceof HttpError) {
      let msg = err.bodyText;
      try {
        const j = JSON.parse(err.bodyText);
        msg = j.error || JSON.stringify(j, null, 2);
      } catch {}
      show(out, "error", `HttpError: Server returned an error:\n${msg}`);
    } else if (err instanceof JsonParseError) {
      show(
        out,
        "warn",
        `Response OK but JSON parse failed.\n${err.message}\n\nRaw:\n${err.rawText}`,
      );
    } else if (err instanceof MappingError) {
      show(out, "error", `Mapping to Gantt data failed.\n${err.message}`);
    } else {
      show(out, "error", `Network or script error:\n${err.message || err}`);
    }
  } finally {
    if (btnAnalyze) {
      btnAnalyze.innerHTML = '<i class="bi bi-lightning-fill"></i> Analyze';
      btnAnalyze.disabled = false;
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  loadState();

  const table = document.getElementById("input-table");
  const tbody = table ? table.querySelector("tbody") : null;
  const toggleJson = document.getElementById("toggle-json");
  const togglePert = document.getElementById("toggle-pert");
  const debugJson = document.getElementById("debug-json");
  const out = document.getElementById("out");
  const outClose = document.getElementById("out-close");
  if (outClose) outClose.addEventListener("click", () => { out.style.display = "none"; });

  if (toggleJson && debugJson) {
    toggleJson.addEventListener("change", () => {
      debugJson.classList.toggle("visible", toggleJson.checked);
    });
    debugJson.classList.toggle("visible", toggleJson.checked);
  }

  if (togglePert) {
    togglePert.addEventListener("change", () => {
      const pert = togglePert.checked;
      const pertHint = document.getElementById("pert-hint");
      if (pertHint) pertHint.classList.toggle("d-none", !pert);
      const recalculated = switchPertMode(pert);

      document.getElementById("cpm-summary").innerHTML =
        '<div class="text-muted fst-italic">Run analysis to see results...</div>';
      document.getElementById("cpm-table").innerHTML = "";
      if (debugJson) debugJson.textContent = "";
      const ganttMount = document.getElementById("gantt");
      if (ganttMount) ganttMount.innerHTML = "";
      currentGanttItems = null;
      ganttGhostData = null;

      // Clear any stale validation errors from the previous mode
      clearTableErrors();

      show(
        out,
        "warn",
        pert
          ? (recalculated
            ? "Switched to PERT mode. Duration values were copied to O/M/P as equal estimates — adjust them before running analysis."
            : "Switched to PERT mode. Your existing O/M/P estimates were preserved.")
          : (recalculated
            ? "Switched to CPM mode. Expected duration (O + 4M + P) / 6 was computed from your PERT estimates."
            : "Switched to CPM mode. Your existing duration values were preserved."),
      );

      saveState();
      validateWithServer();
    });
  }

  const btnHealth = document.getElementById("btn-health");
  if (btnHealth) {
    btnHealth.addEventListener("click", async () => {
      try {
        const res = await fetch("/api/health");
        show(out, "ok", JSON.stringify(await res.json(), null, 2));
      } catch (e) {
        show(out, "error", "Error: " + e.message);
      }
    });
  }

  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("btn-del")) {
      const row = e.target.closest("tr");
      if (row) {
        row.remove();
        saveState();
        validateWithServer();
      }
    }
  });

  if (table) {
    table.addEventListener("input", () => {
      debouncedValidate();
    });
  }

  const btnAdd = document.getElementById("btn-add");
  if (btnAdd) {
    btnAdd.addEventListener("click", () => {
      if (!tbody) {
        console.error("tbody is null, cannot append row");
        return;
      }

      const tr = document.createElement("tr");
      tr.innerHTML = buildRowHtml();
      tbody.appendChild(tr);
      applyPertModeToRow(tr);
      saveState();
      validateWithServer();
    });
  }

  function attachFileInput(id) {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener("change", (e) => {
        handleFileUpload(e);
        setTimeout(() => { saveState(); validateWithServer(); }, 150);
      });
    }
  }
  attachFileInput("file-upload-csv");
  attachFileInput("file-upload-json");
  attachFileInput("file-upload-xlsx");

  const btnAnalyze = document.getElementById("btn-analyze");
  if (btnAnalyze) {
    btnAnalyze.addEventListener("click", () => analyzeProject({ clearGhost: true }));
  }

  const btnExportGantt = document.getElementById("btn-export-gantt");
  if (btnExportGantt) btnExportGantt.addEventListener("click", () => exportGanttToPng());

  const btnExportNetwork = document.getElementById("btn-export-network");
  if (btnExportNetwork) btnExportNetwork.addEventListener("click", () => exportNetworkToPng());
});
