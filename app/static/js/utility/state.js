// ── Persistence ───────────────────────────────────────────────────────────────

function saveState() {
  try {
    const tasks = readTable();
    localStorage.setItem("cpm_scheduler_data", JSON.stringify(tasks));
  } catch (e) {
    console.error("Save failed:", e);
  }
}

function loadState() {
  const raw = localStorage.getItem("cpm_scheduler_data");
  if (raw) {
    try {
      const tasks = JSON.parse(raw);
      if (Array.isArray(tasks)) {
        const isPert = tasks.some((t) => t.optimistic !== undefined);
        if (isPert) {
          const toggle = document.getElementById("toggle-pert");
          if (toggle) toggle.checked = true;
          const pertHint = document.getElementById("pert-hint");
          if (pertHint) pertHint.classList.remove("d-none");
          switchPertMode(true);
        }
        applyTasksToTable(tasks);
        validateWithServer();
      }
    } catch (e) {
      console.error("Load failed", e);
    }
  }
}

const debouncedValidate = debounce(() => {
  saveState();
  validateWithServer();
}, 500);
