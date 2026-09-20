"""
E2E tests for the custom SVG Gantt chart: rendering, drag-to-resize,
live redraw, ghost bars, and post-drag CPM value accuracy.

Test network (3 tasks):
    A: dur=5, deps=[]
    B: dur=3, deps=[A]
    C: dur=4, deps=[A]

Initial CPM values:
    A: ES=0  EF=5  LS=0  LF=5  slack=0  critical
    B: ES=5  EF=8  LS=6  LF=9  slack=1  non-critical
    C: ES=5  EF=9  LS=5  LF=9  slack=0  critical
    Project duration: 9

After extending A by +2 (duration 5 → 7):
    A: ES=0  EF=7  LS=0  LF=7  slack=0  critical
    B: ES=7  EF=10 LS=8  LF=11 slack=1  non-critical
    C: ES=7  EF=11 LS=7  LF=11 slack=0  critical
    Project duration: 11
"""

import re
import pytest
from playwright.sync_api import expect

from conftest import BASE_URL, fill_rows, click_analyze_and_capture

# Must match JS constants in utility.js
GANTT_COL_W = 36
GANTT_LBL_W = 150

GANTT_ROWS = [
    {"id": "A", "name": "A", "duration": "5", "dependencies": ""},
    {"id": "B", "name": "B", "duration": "3", "dependencies": "A"},
    {"id": "C", "name": "C", "duration": "4", "dependencies": "A"},
]


@pytest.fixture
def gantt_page(browser):
    """Fresh isolated page: 3-task CPM analysis with Gantt visible."""
    ctx = browser.new_context()
    page = ctx.new_page()
    page.goto(BASE_URL, wait_until="domcontentloaded")
    fill_rows(page, GANTT_ROWS)
    click_analyze_and_capture(page)
    page.wait_for_selector(".gantt-row")
    yield page
    ctx.close()


def _gantt_drag(page, task_id, delta_units):
    """
    Drag the resize handle of task_id by delta_units (positive=extend, negative=shrink).
    Waits for re-analysis and Gantt re-render to complete.
    """
    handle = page.locator(f".gantt-handle[data-id='{task_id}']")
    box = handle.bounding_box()
    cx = box["x"] + box["width"] / 2
    cy = box["y"] + box["height"] / 2
    page.mouse.move(cx, cy)
    page.mouse.down()
    page.mouse.move(cx + delta_units * GANTT_COL_W, cy, steps=10)
    page.mouse.up()
    page.wait_for_function("() => !document.getElementById('btn-analyze').disabled")
    page.wait_for_selector(".gantt-row")


def _get_cpm_row(page, task_id):
    """
    Returns a dict of CPM values for the given task from the data table.
    Columns: ID(1) Name(2) Duration(3) ES(4) EF(5) LS(6) LF(7) Slack(8)
    """
    rows = page.locator("#cpm-table tbody tr")
    for i in range(rows.count()):
        row = rows.nth(i)
        if row.locator("td:nth-child(1)").text_content().strip() == task_id:
            return {
                "es":    float(row.locator("td:nth-child(4)").text_content().strip()),
                "ef":    float(row.locator("td:nth-child(5)").text_content().strip()),
                "ls":    float(row.locator("td:nth-child(6)").text_content().strip()),
                "lf":    float(row.locator("td:nth-child(7)").text_content().strip()),
                "slack": float(row.locator("td:nth-child(8)").text_content().strip()),
            }
    raise AssertionError(f"Task '{task_id}' not found in CPM table")


# ── Group 1: Rendering ───────────────────────────────────────────────────────

def test_gantt_renders_correct_bar_count(gantt_page):
    """Gantt renders exactly one row per non-dummy task."""
    assert gantt_page.locator(".gantt-row").count() == 3


def test_gantt_bars_have_correct_criticality_class(gantt_page):
    """Critical tasks get 'crit' class, non-critical get 'noncrit'."""
    assert "crit" in gantt_page.locator(".gantt-row[data-id='A'] .gantt-bar").get_attribute("class")
    assert "noncrit" in gantt_page.locator(".gantt-row[data-id='B'] .gantt-bar").get_attribute("class")
    assert "crit" in gantt_page.locator(".gantt-row[data-id='C'] .gantt-bar").get_attribute("class")


def test_gantt_bar_widths_match_duration(gantt_page):
    """Bar width equals duration × GANTT_COL_W pixels."""
    assert float(gantt_page.locator(".gantt-row[data-id='A'] .gantt-bar").get_attribute("width")) == 5 * GANTT_COL_W
    assert float(gantt_page.locator(".gantt-row[data-id='B'] .gantt-bar").get_attribute("width")) == 3 * GANTT_COL_W
    assert float(gantt_page.locator(".gantt-row[data-id='C'] .gantt-bar").get_attribute("width")) == 4 * GANTT_COL_W


def test_gantt_bar_x_positions_match_es(gantt_page):
    """Bar x = GANTT_LBL_W + ES × GANTT_COL_W."""
    # A: ES=0 → x=150; B and C: ES=5 → x=330
    assert float(gantt_page.locator(".gantt-row[data-id='A'] .gantt-bar").get_attribute("x")) == GANTT_LBL_W
    assert float(gantt_page.locator(".gantt-row[data-id='B'] .gantt-bar").get_attribute("x")) == GANTT_LBL_W + 5 * GANTT_COL_W
    assert float(gantt_page.locator(".gantt-row[data-id='C'] .gantt-bar").get_attribute("x")) == GANTT_LBL_W + 5 * GANTT_COL_W


# ── Group 2: Drag updates table and triggers re-analysis ─────────────────────

def test_gantt_drag_updates_duration_cell(gantt_page):
    """Dragging A right by 2 units writes new duration (7) to the table cell."""
    _gantt_drag(gantt_page, "A", 2)
    dur = gantt_page.locator("#input-table tbody tr:nth-of-type(1) td:nth-of-type(3)")
    assert dur.text_content().strip() == "7"


def test_gantt_drag_updates_cpm_table_values(gantt_page):
    """After extending A by 2, CPM table shows recalculated ES/EF/slack and summary shows project duration 11."""
    _gantt_drag(gantt_page, "A", 2)

    summary_text = gantt_page.locator("#cpm-summary .fw-bold.fs-5").first.text_content()
    assert "11" in summary_text

    a = _get_cpm_row(gantt_page, "A")
    assert a["es"] == 0 and a["ef"] == 7 and a["slack"] == 0

    b = _get_cpm_row(gantt_page, "B")
    assert b["es"] == 7 and b["ef"] == 10 and b["slack"] == 1

    c = _get_cpm_row(gantt_page, "C")
    assert c["es"] == 7 and c["ef"] == 11 and c["slack"] == 0


def test_gantt_drag_shrink_updates_correctly(gantt_page):
    """Shrinking A by 2 (5→3) gives project duration 7, slack: B=2, C=0."""
    _gantt_drag(gantt_page, "A", -2)
    summary_text = gantt_page.locator("#cpm-summary .fw-bold.fs-5").first.text_content()
    assert "7" in summary_text

    a = _get_cpm_row(gantt_page, "A")
    assert a["ef"] == 3 and a["slack"] == 0

    b = _get_cpm_row(gantt_page, "B")
    assert b["slack"] == 1

    c = _get_cpm_row(gantt_page, "C")
    assert c["slack"] == 0


# ── Group 3: Drag constraints ────────────────────────────────────────────────

def test_gantt_drag_enforces_minimum_duration(gantt_page):
    """Dragging far left cannot reduce duration below 0.5."""
    _gantt_drag(gantt_page, "A", -20)
    dur = gantt_page.locator("#input-table tbody tr:nth-of-type(1) td:nth-of-type(3)")
    assert dur.text_content().strip() == "0.5"


def test_gantt_drag_snaps_to_half_unit(gantt_page):
    """
    Drag by 1.3 units: rawDelta=1.3, snappedDelta=round(1.3/0.5)*0.5=1.5 → duration 6.5.
    """
    handle = gantt_page.locator(".gantt-handle[data-id='A']")
    box = handle.bounding_box()
    cx = box["x"] + box["width"] / 2
    cy = box["y"] + box["height"] / 2
    gantt_page.mouse.move(cx, cy)
    gantt_page.mouse.down()
    gantt_page.mouse.move(cx + int(1.3 * GANTT_COL_W), cy, steps=5)
    gantt_page.mouse.up()
    gantt_page.wait_for_function("() => !document.getElementById('btn-analyze').disabled")

    dur = gantt_page.locator("#input-table tbody tr:nth-of-type(1) td:nth-of-type(3)")
    assert dur.text_content().strip() == "6.5"


# ── Group 4: Ghost bars ──────────────────────────────────────────────────────

def test_gantt_ghost_appears_after_drag(gantt_page):
    """A ghost bar appears behind task A after extending it by 2 units."""
    _gantt_drag(gantt_page, "A", 2)

    ghost = gantt_page.locator(".gantt-row[data-id='A'] .gantt-ghost")
    expect(ghost).to_be_visible()

    # Ghost width = original duration (5*36=180); new bar = 7*36=252
    ghost_w = float(ghost.get_attribute("width"))
    bar_w = float(gantt_page.locator(".gantt-row[data-id='A'] .gantt-bar").get_attribute("width"))
    assert ghost_w == 5 * GANTT_COL_W
    assert bar_w == 7 * GANTT_COL_W
    assert ghost_w != bar_w


def test_gantt_ghost_not_shown_for_unchanged_tasks(gantt_page):
    """Only the dragged task gets a ghost bar; unchanged tasks do not."""
    _gantt_drag(gantt_page, "A", 2)
    assert gantt_page.locator(".gantt-row[data-id='B'] .gantt-ghost").count() == 0
    assert gantt_page.locator(".gantt-row[data-id='C'] .gantt-ghost").count() == 0


def test_gantt_ghost_cleared_on_manual_analyze(gantt_page):
    """Clicking Analyze manually clears all ghost bars."""
    _gantt_drag(gantt_page, "A", 2)
    assert gantt_page.locator(".gantt-ghost").count() > 0

    gantt_page.locator("#btn-analyze").click()
    gantt_page.wait_for_function("() => !document.getElementById('btn-analyze').disabled")
    gantt_page.wait_for_selector(".gantt-row")

    assert gantt_page.locator(".gantt-ghost").count() == 0


# ── Group 5: Live redraw during drag ────────────────────────────────────────

def test_gantt_bar_redraws_during_drag(gantt_page):
    """Bar width updates in real-time while the mouse is still held down."""
    initial_w = float(gantt_page.locator(".gantt-row[data-id='A'] .gantt-bar").get_attribute("width"))

    handle = gantt_page.locator(".gantt-handle[data-id='A']")
    box = handle.bounding_box()
    cx = box["x"] + box["width"] / 2
    cy = box["y"] + box["height"] / 2

    gantt_page.mouse.move(cx, cy)
    gantt_page.mouse.down()
    gantt_page.mouse.move(cx + 3 * GANTT_COL_W, cy, steps=10)

    mid_w = float(gantt_page.locator(".gantt-row[data-id='A'] .gantt-bar").get_attribute("width"))
    assert mid_w > initial_w

    gantt_page.mouse.up()


def test_gantt_handle_x_updates_during_drag(gantt_page):
    """Resize handle x position tracks the bar's right edge during drag."""
    handle_locator = gantt_page.locator(".gantt-handle[data-id='A']")
    initial_hx = float(handle_locator.get_attribute("x"))

    box = handle_locator.bounding_box()
    cx = box["x"] + box["width"] / 2
    cy = box["y"] + box["height"] / 2

    gantt_page.mouse.move(cx, cy)
    gantt_page.mouse.down()
    gantt_page.mouse.move(cx + 2 * GANTT_COL_W, cy, steps=10)

    mid_hx = float(handle_locator.get_attribute("x"))
    assert mid_hx > initial_hx

    gantt_page.mouse.up()


# ── Group 6: PERT mode protection ────────────────────────────────────────────

def test_gantt_no_handles_in_pert_mode(gantt_page):
    """After analyzing in PERT mode, no resize handles exist in the Gantt."""
    gantt_page.locator("#toggle-pert").check()
    gantt_page.locator("#btn-analyze").click()
    gantt_page.wait_for_function("() => !document.getElementById('btn-analyze').disabled")
    gantt_page.wait_for_selector(".gantt-row")

    assert gantt_page.locator(".gantt-handle").count() == 0


def test_network_aon_aoa_toggle(gantt_page):
    """Toggling the AON/AOA switch changes the active view without breaking the page."""
    page = gantt_page
    page.locator("#network-tab").click()
    expect(page.locator("#tab-network")).to_have_class(re.compile(r"active"))

    toggle = page.locator("#toggle-network-mode")
    expect(toggle).not_to_be_checked()  # default is AOA

    # Network container must have a canvas (Cytoscape renders into canvas elements)
    expect(page.locator("#cpm-network canvas").first).to_be_visible()

    # Switch to AON
    toggle.check()
    expect(toggle).to_be_checked()
    expect(page.locator("#cpm-network canvas").first).to_be_visible()

    # No error banner should appear after the switch
    expect(page.locator("#out")).not_to_have_class(re.compile(r"error"))

    # Switch back to AOA
    toggle.uncheck()
    expect(toggle).not_to_be_checked()
    expect(page.locator("#cpm-network canvas").first).to_be_visible()


def test_gantt_drag_pert_shows_warning(gantt_page):
    """Clicking a bar in PERT mode shows the amber warning banner."""
    gantt_page.locator("#toggle-pert").check()
    gantt_page.locator("#btn-analyze").click()
    gantt_page.wait_for_function("() => !document.getElementById('btn-analyze').disabled")
    gantt_page.wait_for_selector(".gantt-row")

    gantt_page.locator(".gantt-bar").first.click()

    warning = gantt_page.locator("#gantt-pert-warning")
    expect(warning).to_be_visible()
    assert "d-none" not in (warning.get_attribute("class") or "")
