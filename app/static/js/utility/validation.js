// ── Validation ────────────────────────────────────────────────────────────────

function clearTableErrors() {
  document.querySelectorAll("#input-table tbody tr").forEach((row) => {
    row.classList.remove("table-danger");
    row.title = "";
  });
}

function applyValidationErrors(errors) {
  const byId = {};
  (errors || []).forEach((err) => {
    if (!err.id) return;
    (byId[err.id] = byId[err.id] || []).push(err.msg);
  });
  document.querySelectorAll("#input-table tbody tr").forEach((r) => {
    const idCell = r.querySelector("td:nth-child(1)");
    const tid = idCell && idCell.innerText.trim();
    if (tid && byId[tid]) {
      r.classList.add("table-danger");
      r.title = byId[tid].join("\n");
    }
  });
}

async function validateWithServer() {
  const tasks = readTable();
  clearTableErrors();

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tasks: tasks,
        mode: isPertMode() ? "pert" : "cpm",
      }),
    });

    const data = await response.json();

    if (!data.ok && data.validation_errors) {
      applyValidationErrors(data.validation_errors);
    }
  } catch (e) {
    console.error("Validation check failed:", e);
  }
}
