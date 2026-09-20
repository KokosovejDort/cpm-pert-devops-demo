// ── Network Diagram ───────────────────────────────────────────────────────────

let cy = null;
let aoaElements = [];
let aonElements = [];

/* Cytoscape uses its own CSS-like property names (e.g. target-arrow-shape,
   curve-style) that are not valid browser CSS, so these live here as a JS
   constant rather than in network.css. */
const CY_STYLE = [
  {
    selector: "node",
    style: {
      shape: "ellipse",
      width: 110,
      height: 110,
      "background-color": "#ffffff",
      "background-image": "data(bgImage)",
      "background-fit": "contain",
      "background-clip": "none",
      "border-width": 0,
      label: "",
    },
  },
  {
    selector: "node.crit, node.noncrit",
    style: {
      shape: "rectangle",
      width: 130,
      height: 90,
      "background-color": "#ffffff",
      "background-image": "data(bgImage)",
      "background-fit": "contain",
      "background-clip": "none",
      "border-width": 0,
      label: "",
    },
  },
  {
    selector: "edge",
    style: {
      width: 2,
      "line-color": "#6b7280",
      "target-arrow-color": "#6b7280",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
      label: "data(label)",
      "font-size": 13,
      "font-weight": "700",
      "font-family": "monospace",
      color: "#2c1810",
      "text-background-color": "#f5f0e8",
      "text-background-opacity": 0.85,
      "text-background-padding": "3px",
      "text-margin-y": -12,
      "source-distance-from-node": 6,
      "target-distance-from-node": 6,
    },
  },
  {
    selector: "edge.crit",
    style: {
      "line-color": "#b83232",
      "target-arrow-color": "#b83232",
      color: "#b83232",
      width: 3,
      "text-background-color": "#fff5f5",
    },
  },
  {
    selector: "edge.noncrit",
    style: { "line-color": "#6b7280", "target-arrow-color": "#6b7280" },
  },
  {
    selector: "edge.dummy",
    style: {
      "line-style": "dashed",
      "line-dash-pattern": [7, 4],
      width: 2,
      color: "#888",
      "text-background-color": "#f8f8f8",
    },
  },
  {
    selector: "edge.dummy.crit",
    style: {
      "line-color": "#b83232",
      "target-arrow-color": "#b83232",
      color: "#b83232",
    },
  },
];

function makeNodeSvg(nodeLabel, earliest, latest) {
  const size = 110;
  const r = 53;
  const cx = 55,
    cy = 55;
  const borderColor = "#2c1810";
  const fmtVal = (v) => (v === undefined || v === null ? "?" : formatNumber(v));
  const eStr = fmtVal(earliest), lStr = fmtVal(latest);
  const maxLen = Math.max(eStr.length, lStr.length);
  const valFontSize = maxLen <= 3 ? 14 : maxLen <= 5 ? 12 : maxLen <= 7 ? 10 : 9;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
            <circle cx="${cx}" cy="${cy}" r="${r}" fill="white" stroke="${borderColor}" stroke-width="2.5"/>
            <line x1="${cx - r + 1}" y1="${cy}" x2="${cx + r - 1}" y2="${cy}" stroke="${borderColor}" stroke-width="1.8"/>
            <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy + r - 1}" stroke="${borderColor}" stroke-width="1.8"/>
            <text x="${cx}" y="${cy - 13}" text-anchor="middle" dominant-baseline="middle"
                font-family="monospace" font-size="14" font-weight="700" fill="${borderColor}">${nodeLabel}</text>
            <text x="${cx - 22}" y="${cy + 26}" text-anchor="middle" dominant-baseline="middle"
                font-family="Georgia,serif" font-size="${valFontSize}" font-weight="600" fill="#1a6e3c">${eStr}</text>
            <text x="${cx + 22}" y="${cy + 26}" text-anchor="middle" dominant-baseline="middle"
                font-family="Georgia,serif" font-size="${valFontSize}" font-weight="600" fill="#1a47a0">${lStr}</text>
        </svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function makeAoNNodeSvg(id, duration, es, ef, ls, lf, slack, critical) {
  const w = 130,
    h = 90;
  const fmtVal = (v) => (v === undefined || v === null ? "?" : formatNumber(v));
  const border = critical ? "#b83232" : "#1a47a0";
  const headerBg = critical ? "#b83232" : "#1a47a0";
  const slackColor = slack == 0 ? "#b83232" : "#1a6e3c";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
            <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="8" ry="8"
                fill="white" stroke="${border}" stroke-width="2"/>
            <rect x="1" y="1" width="${w - 2}" height="26" rx="8" ry="8" fill="${headerBg}"/>
            <rect x="1" y="15" width="${w - 2}" height="12" fill="${headerBg}"/>

            <text x="${w / 2}" y="17" text-anchor="middle" dominant-baseline="middle"
                font-family="monospace" font-size="10" font-weight="700" fill="white">${id}  (dur: ${fmtVal(duration)}, slack: ${fmtVal(slack)})</text>

            <line x1="1" y1="27" x2="${w - 1}" y2="27" stroke="${border}" stroke-width="1.2"/>
            <line x1="${w / 2}" y1="27" x2="${w / 2}" y2="${h - 1}" stroke="${border}" stroke-width="1.2"/>
            <line x1="1" y1="58" x2="${w - 1}" y2="58" stroke="${border}" stroke-width="1.2"/>

            <text x="${w / 4}" y="35" text-anchor="middle" font-family="monospace" font-size="9" fill="#555">ES</text>
            <text x="${(w * 3) / 4}" y="35" text-anchor="middle" font-family="monospace" font-size="9" fill="#555">EF</text>
            <text x="${w / 4}" y="49" text-anchor="middle" font-family="Georgia,serif" font-size="14" font-weight="600" fill="#1a6e3c">${fmtVal(es)}</text>
            <text x="${(w * 3) / 4}" y="49" text-anchor="middle" font-family="Georgia,serif" font-size="14" font-weight="600" fill="#1a6e3c">${fmtVal(ef)}</text>

            <text x="${w / 4}" y="66" text-anchor="middle" font-family="monospace" font-size="9" fill="#555">LS</text>
            <text x="${(w * 3) / 4}" y="66" text-anchor="middle" font-family="monospace" font-size="9" fill="#555">LF</text>
            <text x="${w / 4}" y="80" text-anchor="middle" font-family="Georgia,serif" font-size="14" font-weight="600" fill="#1a47a0">${fmtVal(ls)}</text>
            <text x="${(w * 3) / 4}" y="80" text-anchor="middle" font-family="Georgia,serif" font-size="14" font-weight="600" fill="#1a47a0">${fmtVal(lf)}</text>
        </svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function buildAoNElementsFromResult(aon) {
  if (!aon) {
    throw new Error(`No data for building AoN graph.`);
  }
  const nodes = aon.nodes.map((n) => ({
    data: {
      id: n.id,
      label: "",
      bgImage: makeAoNNodeSvg(
        n.id,
        n.duration,
        n.es,
        n.ef,
        n.ls,
        n.lf,
        n.slack,
        n.critical,
      ),
    },
    classes: n.critical ? "crit" : "noncrit",
  }));
  const edges = aon.edges.map((e) => ({
    data: {
      id: e.id,
      source: e.source,
      target: e.target,
    },
  }));
  return [...nodes, ...edges];
}

function buildAoAElementsFromResult(aoa) {
  if (!aoa) throw new Error("No data for building AoA graph.");
  const nodes = aoa.nodes.map((n) => ({
    data: {
      id: String(n.id),
      label: "",
      data_label: String(n.data_label || n.label),
      earliest: n.earliest,
      latest: n.latest,
      bgImage: makeNodeSvg(String(n.id), n.earliest, n.latest),
    },
  }));
  const edges = aoa.tasks
    .filter((t) => t.tail_node != null && t.head_node != null)
    .map((t) => {
      const isDummy = t.is_dummy === true;
      const classes = [t.critical ? "crit" : "noncrit", isDummy ? "dummy" : ""]
        .join(" ")
        .trim();
      return {
        data: {
          id: String(t.id),
          source: String(t.tail_node),
          target: String(t.head_node),
          label: isDummy ? `${t.id}` : `${t.id} ${formatNumber(t.duration)}`,
          duration: t.duration,
          es: formatNumber(t.es),
          ef: formatNumber(t.ef),
          ls: formatNumber(t.ls),
          lf: formatNumber(t.lf),
          slack: formatNumber(t.slack),
          isDummy,
        },
        classes,
      };
    });
  return [...nodes, ...edges];
}

function ensureCy() {
  if (cy) return cy;
  cy = cytoscape({
    container: document.getElementById("cpm-network"),
    elements: [],
    boxSelectionEnabled: false,
    wheelSensitivity: 0.2,
    style: CY_STYLE,
  });
  return cy;
}

function renderNetwork(mode) {
  const cy = ensureCy();
  cy.elements().remove();
  cy.add(mode === "aon" ? aonElements : aoaElements);
  cy.layout({
    name: "dagre",
    rankDir: "LR",
    rankSep: 120,
    nodeSep: 60,
    edgeSep: 20,
    padding: 30,
  }).run();
  cy.fit(undefined, 30);
}

function onNetworkModeToggle() {
  const toggle = document.getElementById("toggle-network-mode");
  renderNetwork(toggle && toggle.checked ? "aon" : "aoa");
}

function initOrUpdateNetwork() {
  const toggle = document.getElementById("toggle-network-mode");
  const mode = toggle && toggle.checked ? "aon" : "aoa";
  renderNetwork(mode);
  if (toggle) {
    toggle.removeEventListener("change", onNetworkModeToggle);
    toggle.addEventListener("change", onNetworkModeToggle);
  }
}

function exportNetworkToPng() {
  if (!cy || cy.elements().length === 0) {
    const out = document.getElementById("out");
    if (out) show(out, "warn", "No network diagram to export. Run analysis first.");
    return;
  }
  const link = document.createElement("a");
  link.download = "network-diagram.png";
  link.href = cy.png({ output: "base64uri", scale: 2, bg: "#ffffff", full: true });
  link.click();
}
