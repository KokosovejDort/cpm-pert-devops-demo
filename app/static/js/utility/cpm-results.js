// ── CPM Results Rendering ─────────────────────────────────────────────────────

function renderCpmSummary(result) {
  const box = document.getElementById("cpm-summary");
  const dur = result.project_duration;
  const criticalIds = (result.tasks || [])
    .filter((t) => t.critical && !t.is_dummy)
    .map((t) => t.id);

  let html = `
            <div class="col-md-4 mb-2">
                <div class="border rounded p-2 h-100">
                    <div class="text-muted small mb-1">Project Duration</div>
                    <div class="fw-bold fs-5 cpm-mono">${formatNumber(dur)} <span class="text-muted small">day(s)</span></div>
                </div>
            </div>
            <div class="col-md-4 mb-2">
                <div class="border rounded p-2 h-100">
                    <div class="text-muted small mb-1">Critical Path</div>
                    <div class="fw-semibold cpm-mono">${criticalIds.join(" → ") || "-"}</div>
                </div>
            </div>
            <div class="col-md-4 mb-2">
                <div class="border rounded p-2 h-100">
                    <div class="text-muted small mb-1"># Tasks</div>
                    <div class="fw-bold fs-5 cpm-mono">${(result.tasks || []).filter((t) => !t.is_dummy).length}</div>
                </div>
            </div>
        `;

  const ps = result.pert_stats;
  if (ps) {
    const dl = ps.deadlines;
    html += `
            <div class="col-12 mt-2">
                <div class="border rounded p-3 bg-light">
                    <div class="d-flex align-items-center gap-2 mb-2">
                        <span class="badge bg-primary">PERT</span>
                        <strong>Statistical Summary</strong>
                    </div>
                    <div class="row row-cols-2 row-cols-md-4 g-2 mb-3">
                        <div class="col">
                            <div class="small text-muted">E(T) — Expected</div>
                            <div class="cpm-mono fw-semibold">${formatNumber(ps.expected_duration)}</div>
                        </div>
                        <div class="col">
                            <div class="small text-muted">σ² — Variance</div>
                            <div class="cpm-mono fw-semibold">${formatNumber(ps.variance)}</div>
                        </div>
                        <div class="col">
                            <div class="small text-muted">σ — Std Dev</div>
                            <div class="cpm-mono fw-semibold">${formatNumber(ps.std_dev)}</div>
                        </div>
                    </div>
                    <div class="row row-cols-2 row-cols-md-5 g-2">
                        ${[
                          ["50%", dl.p50],
                          ["75%", dl.p75],
                          ["90%", dl.p90],
                          ["95%", dl.p95],
                          ["99%", dl.p99],
                        ]
                          .map(
                            ([label, val]) => `
                            <div class="col text-center">
                                <div class="small text-muted">${label} deadline</div>
                                <div class="cpm-mono fw-semibold text-primary">${formatNumber(val)}</div>
                            </div>`,
                          )
                          .join("")}
                    </div>
                </div>
            </div>`;
  }

  box.innerHTML = html;
  box.classList.remove("d-none");
}

function renderCpmTable(result) {
  const mount = document.getElementById("cpm-table");
  const pert = isPertMode() && result.pert_stats;
  const tasks = (result.tasks || []).filter(
    (t) => !String(t.id).includes("Dummy") && !t.is_dummy,
  );
  tasks.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));

  const pertCols = pert ? ["O", "M", "P", "σ²"] : [];
  const baseCols = [
    "ID",
    "Name",
    pert ? "E(t)" : "Duration",
    ...pertCols,
    "ES",
    "EF",
    "LS",
    "LF",
    "Slack",
    "Dependencies",
    "Critical",
  ];

  const header = `<thead><tr>${baseCols.map((h) => `<th>${h}</th>`).join("")}</tr></thead>`;

  const body = tasks
    .map((t) => {
      const deps = (t.dependencies || []).join(", ");
      const rowClass = t.critical ? "cpm-row-critical" : "";
      const pertCells = pert
        ? [
            `<td class="cpm-mono" title="Optimistic">${formatNumber(t.optimistic)}</td>`,
            `<td class="cpm-mono" title="Most Likely">${formatNumber(t.most_likely)}</td>`,
            `<td class="cpm-mono" title="Pessimistic">${formatNumber(t.pessimistic)}</td>`,
            `<td class="cpm-mono" title="Variance">${formatNumber(t.variance)}</td>`,
          ]
        : [];

      const cells = [
        `<td class="cpm-mono">${t.id}</td>`,
        `<td class="cpm-mono">${t.name}</td>`,
        `<td class="cpm-mono">${formatNumber(t.duration)}</td>`,
        ...pertCells,
        `<td class="cpm-mono" title="Early Start">${formatNumber(t.es)}</td>`,
        `<td class="cpm-mono" title="Early Finish">${formatNumber(t.ef)}</td>`,
        `<td class="cpm-mono" title="Late Start">${formatNumber(t.ls)}</td>`,
        `<td class="cpm-mono" title="Late Finish">${formatNumber(t.lf)}</td>`,
        `<td class="cpm-mono" title="Total Slack">${formatNumber(t.slack)}</td>`,
        `<td class="cpm-mono">${deps}</td>`,
        `<td>${
          t.critical ? '<span class="badge badge-critical">Critical</span>' : ""
        }</td>`,
      ];
      return `<tr class="${rowClass}">${cells.join("")}</tr>`;
    })
    .join("");

  mount.innerHTML = `<table class="cpm-table">${header}<tbody>${body}</tbody></table>`;
}
