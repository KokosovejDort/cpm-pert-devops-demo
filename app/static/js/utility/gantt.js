// ── Gantt Chart ───────────────────────────────────────────────────────────────

let dragState = null;
let ganttGhostData = null;
let currentGanttItems = null;

function mapCpmToGantt(result) {
  if (!result || !Array.isArray(result.tasks))
    throw new Error("Invalid CPM result: missing tasks array.");
  const startISO = result.project_start;
  if (!startISO) throw new Error("Invalid CPM result: missing project_start.");
  const startBase = parseISODate(startISO || toISODate(new Date()));

  const ganttTasks = result.tasks
    .filter((t) => !String(t.id).includes("Dummy") && !t.is_dummy)
    .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));

  const items = ganttTasks.map((t) => {
    const depsArray = Array.isArray(t.dependencies) ? t.dependencies : [];
    const startDate = addDays(startBase, t.es);
    const endDate = addDays(startBase, t.ef);
    return {
      id: t.id,
      name: t.name || t.id,
      start: toISODate(startDate),
      end: toISODate(endDate),
      dependencies: depsArray.join(","),
      es: t.es,
      ef: t.ef,
      ls: t.ls,
      lf: t.lf,
      slack: t.slack,
      critical: t.critical,
    };
  });
  return { projectStart: startBase, items };
}

function renderGantt(result) {
  const mount = document.getElementById("gantt");
  const prevScroll = mount.scrollLeft;
  mount.innerHTML = "";

  const items = result.items;
  currentGanttItems = items;

  const projectDuration = Math.max(
    1,
    ...items.map((t) => Math.max(t.lf || 0, t.ef || 0)),
  );
  const svgH = GANTT_HDR_H + items.length * GANTT_ROW_H + 20;
  const naturalW = GANTT_LBL_W + (projectDuration + 2) * GANTT_COL_W;
  // Use the always-visible tab-content container as the floor so the chart
  // fills the panel even for short projects. Subtract 32px for Bootstrap p-3
  // padding on both sides. Falls back to naturalW if the element isn't found.
  const tabContent = mount.closest(".tab-content");
  const svgW = Math.max(naturalW, tabContent ? tabContent.clientWidth - 32 : 0);

  const svg = makeSvgEl("svg", { width: svgW, height: svgH });
  svg.classList.add("gantt-svg");

  buildGanttHeader(svg, projectDuration, svgH, svgW, result.projectStart);
  items.forEach((item, i) => {
    const ghost = ganttGhostData
      ? ganttGhostData.find((g) => g.id === item.id)
      : null;
    buildGanttRow(svg, item, ghost, i, svgW);
  });

  mount.style.minHeight = Math.max(svgH, 300) + "px";
  mount.appendChild(svg);
  mount.scrollLeft = prevScroll;
  attachGanttDragHandlers(svg, items);
}

function buildGanttHeader(svg, projectDuration, svgH, svgW, projectStart) {
  svg.appendChild(
    makeSvgEl("rect", {
      x: 0,
      y: 0,
      width: svgW,
      height: GANTT_HDR_H,
      fill: "#f1f5f9",
    }),
  );

  const hdrLbl = makeSvgEl(
    "text",
    {
      x: GANTT_LBL_W / 2,
      y: GANTT_HDR_H / 2,
      "text-anchor": "middle",
      "dominant-baseline": "middle",
    },
    ["gantt-header-text"],
  );
  hdrLbl.textContent = "Task";
  svg.appendChild(hdrLbl);

  svg.appendChild(
    makeSvgEl("line", {
      x1: GANTT_LBL_W,
      y1: 0,
      x2: GANTT_LBL_W,
      y2: svgH,
      stroke: "#94a3b8",
      "stroke-width": 1,
    }),
  );

  for (let d = 0; d <= projectDuration + 1; d++) {
    const x = ganttX(d);
    svg.appendChild(
      makeSvgEl(
        "line",
        {
          x1: x,
          y1: GANTT_HDR_H,
          x2: x,
          y2: svgH,
        },
        ["gantt-grid-line"],
      ),
    );

    const dateStr = toISODate(addDays(projectStart, d)).slice(5); // MM-DD
    const dLbl = makeSvgEl(
      "text",
      {
        x: x + GANTT_COL_W / 2,
        y: GANTT_HDR_H * 0.32,
        "text-anchor": "middle",
        "dominant-baseline": "middle",
      },
      ["gantt-header-text"],
    );
    dLbl.textContent = dateStr;
    svg.appendChild(dLbl);

    const uLbl = makeSvgEl(
      "text",
      {
        x: x + GANTT_COL_W / 2,
        y: GANTT_HDR_H * 0.72,
        "text-anchor": "middle",
        "dominant-baseline": "middle",
      },
      ["gantt-header-unit"],
    );
    uLbl.textContent = d;
    svg.appendChild(uLbl);
  }

  svg.appendChild(
    makeSvgEl("line", {
      x1: 0,
      y1: GANTT_HDR_H,
      x2: svgW,
      y2: GANTT_HDR_H,
      stroke: "#94a3b8",
      "stroke-width": 1.5,
    }),
  );
}

function buildGanttRow(svg, item, ghostItem, rowIndex, svgW) {
  const y = ganttY(rowIndex);
  const barY = y + (GANTT_ROW_H - GANTT_BAR_H) / 2;

  const g = makeSvgEl("g");
  g.classList.add("gantt-row");
  g.dataset.id = item.id;

  g.appendChild(
    makeSvgEl("rect", {
      x: 0,
      y,
      width: svgW,
      height: GANTT_ROW_H,
      fill: rowIndex % 2 === 0 ? "#ffffff" : "#f8fafc",
    }),
  );

  const rowLbl = makeSvgEl(
    "text",
    {
      x: GANTT_LBL_W - 8,
      y: y + GANTT_ROW_H / 2,
      "text-anchor": "end",
      "dominant-baseline": "middle",
    },
    ["gantt-row-label"],
  );
  rowLbl.textContent = `${item.id}: ${item.name}`;
  g.appendChild(rowLbl);

  g.appendChild(
    makeSvgEl(
      "line",
      {
        x1: GANTT_LBL_W,
        y1: y,
        x2: GANTT_LBL_W,
        y2: y + GANTT_ROW_H,
      },
      ["gantt-grid-line"],
    ),
  );

  // Ghost bar (previous position before last drag)
  if (ghostItem && ghostItem.ef !== item.ef) {
    const gx = ganttX(ghostItem.es);
    const gw = Math.max(2, (ghostItem.ef - ghostItem.es) * GANTT_COL_W);
    g.appendChild(
      makeSvgEl(
        "rect",
        { x: gx, y: barY, width: gw, height: GANTT_BAR_H, rx: 4 },
        ["gantt-ghost"],
      ),
    );
  }

  // Float window (ES→LF) shown when task has slack
  if (item.lf > item.ef) {
    const fx = ganttX(item.es);
    const fw = Math.max(2, (item.lf - item.es) * GANTT_COL_W);
    g.appendChild(
      makeSvgEl(
        "rect",
        { x: fx, y: barY, width: fw, height: GANTT_BAR_H, rx: 4 },
        ["gantt-float"],
      ),
    );
  }

  // Duration bar (ES→EF)
  const bx = ganttX(item.es);
  const bw = Math.max(4, (item.ef - item.es) * GANTT_COL_W);
  const bar = makeSvgEl("rect", {
    x: bx,
    y: barY,
    width: bw,
    height: GANTT_BAR_H,
    rx: 4,
  });
  bar.classList.add("gantt-bar", item.critical ? "crit" : "noncrit");
  bar.dataset.id = item.id;
  g.appendChild(bar);

  const barLbl = makeSvgEl(
    "text",
    {
      x: bx + bw / 2,
      y: barY + GANTT_BAR_H / 2,
      "text-anchor": "middle",
      "dominant-baseline": "middle",
      "pointer-events": "none",
    },
    ["gantt-label"],
  );
  barLbl.textContent = item.id;
  g.appendChild(barLbl);

  // Resize handle — CPM mode only, visible duration only
  if (!isPertMode() && item.ef - item.es > 0) {
    const handle = makeSvgEl("rect", {
      x: bx + bw - 4,
      y: barY,
      width: 10,
      height: GANTT_BAR_H,
    });
    handle.classList.add("gantt-handle");
    handle.dataset.id = item.id;
    g.appendChild(handle);
  }

  svg.appendChild(g);
}

function ganttRedrawBars(svgEl, items) {
  items.forEach((item) => {
    const row = svgEl.querySelector(
      `.gantt-row[data-id="${CSS.escape(item.id)}"]`,
    );
    if (!row) return;
    const bar = row.querySelector(".gantt-bar");
    if (!bar) return;
    const bx = ganttX(item.es);
    const bw = Math.max(4, (item.ef - item.es) * GANTT_COL_W);
    bar.setAttribute("x", bx);
    bar.setAttribute("width", bw);
    const lbl = row.querySelector(".gantt-label");
    if (lbl) {
      lbl.setAttribute("x", bx + bw / 2);
      lbl.textContent = bw >= 24 ? item.id : "";
    }
    const handle = row.querySelector(".gantt-handle");
    if (handle) handle.setAttribute("x", bx + bw - 4);
  });
}

function attachGanttDragHandlers(svgEl, items) {
  if (isPertMode()) {
    svgEl.querySelectorAll(".gantt-bar").forEach((bar) =>
      bar.addEventListener("mousedown", (e) => {
        e.preventDefault();
        showGanttPertWarning();
      }),
    );
    return;
  }
  svgEl
    .querySelectorAll(".gantt-handle")
    .forEach((handle) =>
      handle.addEventListener("mousedown", (e) =>
        onGanttMouseDown(e, svgEl, items),
      ),
    );
}

function onGanttMouseDown(e, svgEl, items) {
  if (isPertMode()) {
    e.preventDefault();
    showGanttPertWarning();
    return;
  }
  if (dragState) return;
  e.preventDefault();
  e.stopPropagation();
  const taskId = e.target.dataset.id;
  const item = items.find((t) => t.id === taskId);
  if (!item) return;
  ganttGhostData = [{ ...item }];
  dragState = {
    taskId,
    startX: e.clientX,
    startEf: item.ef,
    previewEf: item.ef,
    svgEl,
    items,
  };
  const onMove = (ev) => onGanttMouseMove(ev);
  const onUp = () => {
    onGanttMouseUp();
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

function onGanttMouseMove(e) {
  if (!dragState) return;
  const { taskId, startX, startEf, svgEl, items } = dragState;
  const item = items.find((t) => t.id === taskId);
  if (!item) return;
  const rawDelta = (e.clientX - startX) / GANTT_COL_W;
  const snappedDelta = Math.round(rawDelta / GANTT_SNAP) * GANTT_SNAP;
  const newEf = Math.max(item.es + GANTT_MIND, startEf + snappedDelta);
  dragState.previewEf = newEf;
  ganttRedrawBars(
    svgEl,
    items.map((t) => (t.id === taskId ? { ...t, ef: newEf } : t)),
  );
}

function onGanttMouseUp() {
  if (!dragState) return;
  const { taskId, startEf, previewEf, items } = dragState;
  dragState = null;
  if (previewEf === startEf) {
    ganttGhostData = null;
    return;
  }
  const item = items.find((t) => t.id === taskId);
  if (!item) return;
  const newDuration = previewEf - item.es;
  document.querySelectorAll("#input-table tbody tr").forEach((row) => {
    const idCell = row.querySelector("td:nth-child(1)");
    if (idCell && idCell.textContent.trim() === taskId) {
      const durCell = row.querySelector("td:nth-child(3)");
      if (durCell) durCell.textContent = String(newDuration);
    }
  });
  saveState();
  if (typeof window.analyzeProject === "function") window.analyzeProject();
}

function showGanttPertWarning() {
  const warning = document.getElementById("gantt-pert-warning");
  if (!warning || !warning.classList.contains("d-none")) return;
  warning.classList.remove("d-none");
  if (warning._dt) clearTimeout(warning._dt);
  warning._dt = setTimeout(() => warning.classList.add("d-none"), 4000);
}

function scrollToFirstGanttTask() {
  const mount = document.getElementById("gantt");
  if (!mount) return;
  const firstBar = mount.querySelector(".gantt-row .gantt-bar");
  if (firstBar) {
    mount.scrollTo({
      left: Math.max(0, parseFloat(firstBar.getAttribute("x") || "0") - 50),
      behavior: "smooth",
    });
  }
}

async function exportGanttToPng() {
  const mount = document.getElementById("gantt");
  const originalSvg = mount ? mount.querySelector("svg.gantt-svg") : null;
  if (!originalSvg) {
    const out = document.getElementById("out");
    if (out) show(out, "warn", "No Gantt chart to export. Run analysis first.");
    return;
  }

  const svgClone = originalSvg.cloneNode(true);
  const ganttCssLink = document.querySelector('link[href*="gantt.css"]');
  if (ganttCssLink) {
    const cssText = await fetch(ganttCssLink.href).then((r) => r.text());
    const styleEl = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "style",
    );
    styleEl.textContent = cssText;
    svgClone.insertBefore(styleEl, svgClone.firstChild);
  }

  const svgW = parseInt(originalSvg.getAttribute("width"), 10);
  const svgH = parseInt(originalSvg.getAttribute("height"), 10);
  svgClone.setAttribute("width", svgW);
  svgClone.setAttribute("height", svgH);

  const blob = new Blob([new XMLSerializer().serializeToString(svgClone)], {
    type: "image/svg+xml;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = svgW * scale;
    canvas.height = svgH * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, svgW, svgH);
    ctx.drawImage(img, 0, 0, svgW, svgH);
    URL.revokeObjectURL(url);
    const link = document.createElement("a");
    link.download = "gantt-chart.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    const out = document.getElementById("out");
    if (out) show(out, "error", "Failed to export Gantt chart as PNG.");
  };
  img.src = url;
}
