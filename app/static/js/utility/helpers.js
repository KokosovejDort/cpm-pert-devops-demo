// ── Generic Utilities ─────────────────────────────────────────────────────────

function formatNumber(x) {
  return Number(x).toFixed(2).replace(/\.?0+$/, "");
}

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Creates an SVG element in the SVG namespace with optional attributes and CSS classes.
function makeSvgEl(tag, attrs, classes) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (classes) for (const c of classes) el.classList.add(c);
  return el;
}

// ── Date Utilities ────────────────────────────────────────────────────────────

function parseISODate(iso) {
  return new Date(iso + "T00:00:00");
}

function addDays(baseDate, days) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function toISODate(date) {
  const d = new Date(date);
  const offset = d.getTimezoneOffset();
  d.setMinutes(d.getMinutes() - offset);
  return d.toISOString().slice(0, 10);
}

// ── Gantt Constants ───────────────────────────────────────────────────────────
// These constants are also referenced in tests/test_gantt.py — keep in sync.

const GANTT_LBL_W = 150;  // label column width (px)
const GANTT_COL_W = 36;   // px per CPM time unit
const GANTT_BAR_H = 20;   // bar height (px)
const GANTT_ROW_H = 32;   // row height (px)
const GANTT_HDR_H = 52;   // header height (px)
const GANTT_SNAP  = 0.5;  // drag snap increment
const GANTT_MIND  = 0.5;  // minimum duration after drag

function ganttX(t) { return GANTT_LBL_W + t * GANTT_COL_W; }
function ganttY(i) { return GANTT_HDR_H + i * GANTT_ROW_H; }
