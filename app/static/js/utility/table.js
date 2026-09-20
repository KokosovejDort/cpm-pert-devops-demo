// ── Table Management ──────────────────────────────────────────────────────────
// Column layout: [0:ID][1:Name][2:Dur][3:Dep][4:Opt][5:ML][6:Pess][7:Del]

function readTable() {
  const pert = isPertMode();
  return Array.from(document.querySelectorAll("#input-table tbody tr"))
    .map((row) => {
      const cells = row.querySelectorAll("td");
      const id = cells[0].textContent.trim();
      if (!id) return null;

      const base = {
        id,
        name: cells[1].textContent.trim(),
        dependencies: parseDependencies(cells[3].textContent.trim()),
      };

      if (pert) {
        base.optimistic = Number(cells[4].textContent.trim() || "0");
        base.most_likely = Number(cells[5].textContent.trim() || "0");
        base.pessimistic = Number(cells[6].textContent.trim() || "0");
      } else {
        base.duration = Number(cells[2].textContent.trim() || "0");
      }
      return base;
    })
    .filter(Boolean);
}

function applyTasksToTable(tasks) {
  const tbody = document.querySelector("#input-table tbody");
  tbody.innerHTML = "";
  tasks.forEach((task) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true" class="col-duration-cell"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true" class="col-pert-cell"></td>
                <td contenteditable="true" class="col-pert-cell"></td>
                <td contenteditable="true" class="col-pert-cell"></td>
                <td><button class="btn-del btn btn-sm btn-outline-danger">Delete</button></td>
            `;
    const cells = tr.querySelectorAll("td");
    cells[0].textContent = task.id;
    cells[1].textContent = task.name || task.id;
    cells[2].textContent = String(task.duration ?? "0");
    cells[3].textContent = task.dependencies || "";
    cells[4].textContent = String(task.optimistic ?? "");
    cells[5].textContent = String(task.most_likely ?? "");
    cells[6].textContent = String(task.pessimistic ?? "");
    applyPertModeToRow(tr);
    tbody.appendChild(tr);
  });
}

function parseDependencies(dependenciesText) {
  if (!dependenciesText) return [];
  return dependenciesText
    .split(/[,;]/)
    .map((dep) => dep.trim())
    .filter(Boolean);
}

function getNextId() {
  const rows = document.querySelectorAll("#input-table tbody tr");
  if (rows.length === 0) return "A";

  const lastRow = rows[rows.length - 1];
  const lastId = lastRow.querySelectorAll("td")[0].textContent.trim();
  if (lastId.match(/^[A-Y]$/))
    return String.fromCharCode(lastId.charCodeAt(0) + 1);
  if (lastId === "Z") return "A1";
  if (lastId.match(/^[A-Z]\d+$/)) {
    const letter = lastId[0];
    const number = parseInt(lastId.slice(1));

    if (letter !== "Z")
      return String.fromCharCode(letter.charCodeAt(0) + 1) + number;
    else return "A" + (number + 1);
  }
  return "A";
}

// ── CSV Import ────────────────────────────────────────────────────────────────

function parseCpmCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2)
    throw new Error("CSV must contain a header and at least one data row.");

  const headerCols = lines[0]
    .toLowerCase()
    .split(",")
    .map((c) => c.trim());

  // CPM requires: ac, pr, du. PERT requires: ac, pr, opt, ml, pess.
  // "name" is optional in both. Any other column makes the format unrecognised.

  const hasCpmRequired =
    headerCols.includes("ac") &&
    headerCols.includes("pr") &&
    headerCols.includes("du");

  let hasCpmExtras = false;
  for (const col of headerCols) {
    if (col !== "ac" && col !== "pr" && col !== "du" && col !== "name") {
      hasCpmExtras = true;
    }
  }

  const isCpm = hasCpmRequired && !hasCpmExtras;

  const hasPertRequired =
    headerCols.includes("ac") &&
    headerCols.includes("pr") &&
    headerCols.includes("opt") &&
    headerCols.includes("ml") &&
    headerCols.includes("pess");

  let hasPertExtras = false;
  for (const col of headerCols) {
    if (
      col !== "ac" &&
      col !== "pr" &&
      col !== "opt" &&
      col !== "ml" &&
      col !== "pess" &&
      col !== "name"
    ) {
      hasPertExtras = true;
    }
  }

  const isPert = hasPertRequired && !hasPertExtras;

  if (!isCpm && !isPert)
    throw new Error(
      `Unrecognised column format: got [${headerCols.join(", ")}]. ` +
        `Expected CPM (ac, pr, du) or PERT (ac, pr, opt, ml, pess), ` +
        `with an optional "name" column.`,
    );

  const tasks = lines.slice(1).map((line, idx) => {
    const rowNumber = idx + 2;
    const cols = line.split(",").map((c) => c.trim());

    if (isPert) {
      const [idRaw, prRaw, oRaw, mRaw, pRaw, nameRaw] = cols;
      if (!idRaw) throw new Error(`Row ${rowNumber}: missing ID.`);
      return {
        id: idRaw,
        name: nameRaw || idRaw,
        optimistic: String(Number(oRaw)),
        most_likely: String(Number(mRaw)),
        pessimistic: String(Number(pRaw)),
        dependencies: parseCsvPredecessors(prRaw).join(", "),
      };
    } else {
      const [idRaw, prRaw, duRaw, nameRaw] = cols;
      if (!idRaw) throw new Error(`Row ${rowNumber}: missing ID.`);
      const duration = Number(duRaw);
      if (!isFinite(duration))
        throw new Error(`Row ${rowNumber}: invalid duration.`);
      return {
        id: idRaw,
        name: nameRaw || idRaw,
        duration: String(duration),
        dependencies: parseCsvPredecessors(prRaw).join(", "),
      };
    }
  });

  return { tasks, isPert };
}

function parseCsvPredecessors(prCell) {
  const trimmed = (prCell || "").trim();
  if (!trimmed || trimmed === "-") return [];
  if (/[,\s;]+/.test(trimmed)) {
    return trimmed
      .split(/[,\s;]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  if (/^[A-Za-z]+$/.test(trimmed)) return trimmed.split("");
  return [trimmed];
}

function parseJsonTasks(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error("Invalid JSON: " + e.message);
  }
  if (!Array.isArray(data))
    throw new Error("JSON must be an array of task objects.");
  if (data.length === 0) throw new Error("JSON array is empty.");

  // CPM fields: id, name, duration, dependencies.
  // PERT fields: id, name, optimistic, most_likely, pessimistic, dependencies.
  // "name" and "dependencies" are shared and optional in both formats.

  const tasks = [];
  for (let idx = 0; idx < data.length; idx++) {
    const obj = data[idx];
    const rowNum = idx + 1;

    // A row is PERT if it contains any PERT-only field (not present in CPM).
    let isPertObj = false;
    if (obj.optimistic !== undefined) isPertObj = true;
    if (obj.most_likely !== undefined) isPertObj = true;
    if (obj.pessimistic !== undefined) isPertObj = true;

    // Check that no unexpected fields are present.
    const unexpectedFields = [];
    for (const key of Object.keys(obj)) {
      if (isPertObj) {
        if (
          key !== "id" &&
          key !== "name" &&
          key !== "optimistic" &&
          key !== "most_likely" &&
          key !== "pessimistic" &&
          key !== "dependencies"
        ) {
          unexpectedFields.push(key);
        }
      } else {
        if (
          key !== "id" &&
          key !== "name" &&
          key !== "duration" &&
          key !== "dependencies"
        ) {
          unexpectedFields.push(key);
        }
      }
    }
    if (unexpectedFields.length > 0)
      throw new Error(
        `Unrecognised field(s) in row ${rowNum}: [${unexpectedFields.join(", ")}]. ` +
          `Expected CPM (id, name, duration, dependencies) or ` +
          `PERT (id, name, optimistic, most_likely, pessimistic, dependencies).`,
      );

    if (!obj.id) throw new Error(`Row ${rowNum}: missing "id" field.`);
    const deps = Array.isArray(obj.dependencies)
      ? obj.dependencies.join(", ")
      : String(obj.dependencies || "");
    const task = {
      id: String(obj.id),
      name: String(obj.name || obj.id),
      dependencies: deps,
    };
    if (isPertObj) {
      task.optimistic = String(obj.optimistic ?? "");
      task.most_likely = String(obj.most_likely ?? "");
      task.pessimistic = String(obj.pessimistic ?? "");
    } else {
      task.duration = String(obj.duration ?? "0");
    }
    tasks.push(task);
  }

  // Determine the overall mode: if any task has PERT fields, the whole file is PERT.
  let isPert = false;
  for (const task of tasks) {
    if (task.optimistic !== undefined) {
      isPert = true;
      break;
    }
  }

  return { tasks, isPert };
}

function parseXlsxToTasks(arrayBuffer) {
  if (typeof XLSX === "undefined")
    throw new Error("SheetJS library is not loaded.");
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const wsName = wb.SheetNames[0];
  if (!wsName) throw new Error("Excel file contains no sheets.");
  return parseCpmCsv(XLSX.utils.sheet_to_csv(wb.Sheets[wsName]));
}

function handleFileUpload(event) {
  const input = event.target;
  const file = input.files[0];
  if (!file) return;
  input.value = "";
  const tbody = document.querySelector("#input-table tbody");
  if (tbody) tbody.innerHTML = "";
  const ext = file.name.split(".").pop().toLowerCase();
  const out = document.getElementById("out");

  function onError(format, err) {
    console.error(err);
    show(out, "error", `Failed to import ${format}: ${err.message}`);
  }

  function onSuccess({ tasks, isPert }) {
    const toggle = document.getElementById("toggle-pert");
    if (toggle) toggle.checked = isPert;
    switchPertMode(isPert);
    applyTasksToTable(tasks);
  }

  if (ext === "json") {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        onSuccess(parseJsonTasks(e.target.result));
      } catch (err) {
        onError("JSON", err);
      }
    };
    reader.readAsText(file);
  } else if (ext === "xlsx" || ext === "xls") {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        onSuccess(parseXlsxToTasks(e.target.result));
      } catch (err) {
        onError("Excel file", err);
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        onSuccess(parseCpmCsv(e.target.result));
      } catch (err) {
        onError("CSV", err);
      }
    };
    reader.readAsText(file);
  }
}

// ── PERT Mode ─────────────────────────────────────────────────────────────────

function isPertMode() {
  const toggle = document.getElementById("toggle-pert");
  return toggle ? toggle.checked : false;
}

function switchPertMode(enabled) {
  document
    .querySelectorAll(".col-duration")
    .forEach((el) => el.classList.toggle("d-none", enabled));
  document
    .querySelectorAll(".col-pert")
    .forEach((el) => el.classList.toggle("d-none", !enabled));

  let recalculated = false;

  document.querySelectorAll("#input-table tbody tr").forEach((row) => {
    const cells = row.querySelectorAll("td");
    if (cells.length < 7) return;

    if (enabled) {
      // CPM → PERT: seed O/M/P from duration when they are blank
      const dur = cells[2].textContent.trim();
      if (dur && dur !== "0") {
        if (!cells[4].textContent.trim()) { cells[4].textContent = dur; recalculated = true; }
        if (!cells[5].textContent.trim()) { cells[5].textContent = dur; recalculated = true; }
        if (!cells[6].textContent.trim()) { cells[6].textContent = dur; recalculated = true; }
      }
    } else {
      // PERT → CPM: compute expected duration (O + 4M + P) / 6
      const o = parseFloat(cells[4].textContent.trim()) || 0;
      const m = parseFloat(cells[5].textContent.trim()) || 0;
      const p = parseFloat(cells[6].textContent.trim()) || 0;
      const expected = (o + 4 * m + p) / 6;
      if (
        expected > 0 &&
        (!cells[2].textContent.trim() || cells[2].textContent.trim() === "0")
      ) {
        cells[2].textContent = formatNumber(expected);
        recalculated = true;
      }
    }

    applyPertModeToRow(row);
  });

  return recalculated;
}

function applyPertModeToRow(tr) {
  const pert = isPertMode();
  const cells = tr.querySelectorAll("td");
  if (cells.length < 7) return;
  cells[2].classList.toggle("d-none", pert);
  cells[4].classList.toggle("d-none", !pert);
  cells[5].classList.toggle("d-none", !pert);
  cells[6].classList.toggle("d-none", !pert);
}
