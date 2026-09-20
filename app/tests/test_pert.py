"""
PERT mode E2E tests.

Test data (pre-computed expected values):

  Task  O  M  P  | E(t)  Var      | ES  EF  LS  LF  Slack  Critical
  A     4  4  4  | 4.0   0.0      | 0   4   0   4   0      yes
  B     3  6  9  | 6.0   1.0      | 4   10  4   10  0      yes
  C     1  2  3  | 2.0   0.111    | 4   6   8   10  4      no
  D     1  4  7  | 4.0   1.0      | 10  14  10  14  0      yes

  Critical path: A → B → D  |  Duration: 14
  Critical variance: 0 + 1 + 1 = 2.0  |  std_dev: sqrt(2) ≈ 1.4142
"""

import math
import re
import pytest
from playwright.sync_api import expect

from conftest import (
    BASE_URL,
    fill_rows, fill_pert_rows, click_analyze_and_capture, get_debug_json,
)

PERT_DATA_ROWS = [
    {"id": "A", "name": "Task A", "optimistic": "4", "most_likely": "4", "pessimistic": "4", "dependencies": ""},
    {"id": "B", "name": "Task B", "optimistic": "3", "most_likely": "6", "pessimistic": "9", "dependencies": "A"},
    {"id": "C", "name": "Task C", "optimistic": "1", "most_likely": "2", "pessimistic": "3", "dependencies": "A"},
    {"id": "D", "name": "Task D", "optimistic": "1", "most_likely": "4", "pessimistic": "7", "dependencies": "B,C"},
]

EXPECTED_PERT_TASKS = {
    "A": {"expected": 4.0, "variance": 0.0,       "es": 0,  "lf": 4,  "slack": 0, "critical": True},
    "B": {"expected": 6.0, "variance": 1.0,       "es": 4,  "lf": 10, "slack": 0, "critical": True},
    "C": {"expected": 2.0, "variance": 1 / 9,     "es": 4,  "lf": 10, "slack": 4, "critical": False},
    "D": {"expected": 4.0, "variance": 1.0,       "es": 10, "lf": 14, "slack": 0, "critical": True},
}


# ---------------------------------------------------------------------------
# Module-scoped session — shared across all Group 1 tests
# ---------------------------------------------------------------------------

pert_shared_ctx = None
pert_shared_page = None
pert_captured_payload = None
pert_captured_server_json = None


@pytest.fixture(scope="module", autouse=True)
def _prepare_pert_session(browser):
    global pert_shared_ctx, pert_shared_page, pert_captured_payload, pert_captured_server_json

    pert_shared_ctx = browser.new_context()
    pert_shared_page = pert_shared_ctx.new_page()

    pert_shared_page.goto(BASE_URL, wait_until="domcontentloaded")

    # Enable debug JSON so get_debug_json() works
    toggle_json = pert_shared_page.locator("#toggle-json")
    expect(toggle_json).to_be_visible()
    toggle_json.check()

    # Enable PERT mode
    pert_shared_page.locator("#toggle-pert").check()

    fill_pert_rows(pert_shared_page, PERT_DATA_ROWS)

    resp, payload = click_analyze_and_capture(pert_shared_page)
    assert resp.status == 200

    pert_captured_payload = payload
    pert_captured_server_json = resp.json().get("result")

    yield
    pert_shared_ctx.close()


# ---------------------------------------------------------------------------
# Group 1 — PERT analysis accuracy (use module globals, no `page` param)
# ---------------------------------------------------------------------------

def test_pert_payload_accuracy():
    """Payload sent to server should have mode=pert and O/M/P fields per task."""
    assert pert_captured_payload.get("mode") == "pert"

    payload_map = {t["id"]: t for t in pert_captured_payload["tasks"]}
    for row in PERT_DATA_ROWS:
        tid = row["id"]
        task = payload_map[tid]
        assert task["optimistic"]  == float(row["optimistic"])
        assert task["most_likely"] == float(row["most_likely"])
        assert task["pessimistic"] == float(row["pessimistic"])


def test_pert_stats_accuracy():
    """Project-level PERT statistics should match pre-computed values."""
    assert pert_captured_server_json["project_duration"] == 14

    stats = pert_captured_server_json["pert_stats"]
    assert stats["variance"]         == pytest.approx(2.0, rel=1e-3)
    assert stats["std_dev"]          == pytest.approx(math.sqrt(2), rel=1e-3)
    assert stats["deadlines"]["p50"] == pytest.approx(14.0, rel=1e-3)

    # Deadlines must be strictly monotonically increasing
    d = stats["deadlines"]
    assert d["p75"] > d["p50"]
    assert d["p90"] > d["p75"]
    assert d["p95"] > d["p90"]
    assert d["p99"] > d["p95"]


def test_pert_task_fields_accuracy():
    """Per-task expected duration, variance, slack, and criticality."""
    tasks = {t["id"]: t for t in pert_captured_server_json["tasks"] if not t.get("is_dummy")}
    for tid, exp in EXPECTED_PERT_TASKS.items():
        t = tasks[tid]
        assert t["expected"]  == pytest.approx(exp["expected"],  rel=1e-3)
        assert t["variance"]  == pytest.approx(exp["variance"],  abs=1e-3)
        assert t["es"]        == pytest.approx(exp["es"],        rel=1e-3)
        assert t["lf"]        == pytest.approx(exp["lf"],        rel=1e-3)
        assert t["slack"]     == pytest.approx(exp["slack"],     abs=1e-3)
        assert t["critical"]  is exp["critical"]


def test_pert_summary_ui():
    """Summary block should show task count, critical path, and PERT stats."""
    summary = pert_shared_page.locator("#cpm-summary").text_content()
    assert re.search(r"# Tasks\s+4", summary)
    assert re.search(r"Critical Path\s+A → B → D", summary)
    # PERT statistical block must be present
    assert "E(T)" in summary


def test_pert_table_ui():
    """Data table should show 4 rows with correct critical styling."""
    pert_shared_page.locator("#table-tab").click()
    rows = pert_shared_page.locator("#cpm-table table.cpm-table tbody tr")
    expect(rows).to_have_count(4)

    tasks = {t["id"]: t for t in pert_captured_server_json["tasks"] if not t.get("is_dummy")}
    for i in range(rows.count()):
        row = rows.nth(i)
        tid = row.locator("td:nth-child(1)").text_content().strip()
        if tasks[tid]["critical"]:
            expect(row.locator(".badge-critical")).to_be_visible()
            expect(row).to_have_class(re.compile(r"cpm-row-critical"))


# ---------------------------------------------------------------------------
# Group 2 — Toggle switching (fresh `page` per test)
# ---------------------------------------------------------------------------

def test_pert_toggle_ui_state(page):
    """Enabling the PERT toggle should hide Duration and show O/M/P columns."""
    page.goto(BASE_URL, wait_until="domcontentloaded")

    # Before toggle — Duration header visible, PERT headers hidden
    dur_header = page.locator("thead .col-duration")
    pert_headers = page.locator("thead .col-pert")
    expect(dur_header).not_to_have_class(re.compile(r"d-none"))
    expect(pert_headers.first).to_have_class(re.compile(r"d-none"))
    expect(page.locator("#pert-hint")).to_have_class(re.compile(r"d-none"))

    page.locator("#toggle-pert").check()

    # After toggle — Duration header hidden, PERT headers visible
    expect(dur_header).to_have_class(re.compile(r"d-none"))
    expect(pert_headers.first).not_to_have_class(re.compile(r"d-none"))
    expect(page.locator("#pert-hint")).not_to_have_class(re.compile(r"d-none"))


def test_pert_seeding_from_duration(page):
    """When switching CPM → PERT, duration values should be seeded into O/M/P."""
    page.goto(BASE_URL, wait_until="domcontentloaded")

    fill_rows(page, [
        {"id": "A", "name": "Task A", "duration": "5", "dependencies": ""},
        {"id": "B", "name": "Task B", "duration": "10", "dependencies": "A"},
    ])

    page.locator("#toggle-pert").check()

    for row_idx, expected_dur in enumerate(["5", "10"], start=1):
        for col in [5, 6, 7]:
            cell_val = page.locator(
                f"#input-table tbody tr:nth-of-type({row_idx}) td:nth-of-type({col})"
            ).text_content().strip()
            assert cell_val == expected_dur, (
                f"Row {row_idx} col {col}: expected seeded value '{expected_dur}', got '{cell_val}'"
            )


def test_pert_to_cpm_duration_computation(page):
    """When switching PERT → CPM, duration should be computed as (O + 4M + P) / 6."""
    page.goto(BASE_URL, wait_until="domcontentloaded")

    # Use duration=0 so the switch-back condition (dur empty or "0") triggers the write.
    # A: (2 + 4*5 + 8) / 6 = 30/6 = 5.0  →  "5"
    # B: (4 + 4*6 + 8) / 6 = 36/6 = 6.0  →  "6"
    fill_rows(page, [
        {"id": "A", "name": "Task A", "duration": "0", "dependencies": ""},
        {"id": "B", "name": "Task B", "duration": "0", "dependencies": "A"},
    ])

    page.locator("#toggle-pert").check()
    # No seeding (dur="0"), O/M/P cells start blank — fill them directly

    for row_idx, (o, m, p) in enumerate([("2", "5", "8"), ("4", "6", "8")], start=1):
        for col, val in zip([5, 6, 7], [o, m, p]):
            page.locator(
                f"#input-table tbody tr:nth-of-type({row_idx}) td:nth-of-type({col})"
            ).fill(val)

    page.locator("#toggle-pert").uncheck()

    a_dur = page.locator("#input-table tbody tr:nth-of-type(1) td:nth-of-type(3)").text_content().strip()
    b_dur = page.locator("#input-table tbody tr:nth-of-type(2) td:nth-of-type(3)").text_content().strip()
    assert a_dur == "5"
    assert b_dur == "6"


def test_pert_switch_clears_results(page):
    """Switching modes should reset the summary to the placeholder text."""
    page.goto(BASE_URL, wait_until="domcontentloaded")

    page.locator("#toggle-pert").check()
    fill_pert_rows(page, [
        {"id": "A", "name": "Task A", "optimistic": "1", "most_likely": "2", "pessimistic": "3", "dependencies": ""},
    ])
    resp, _ = click_analyze_and_capture(page)
    assert resp.status == 200

    # Summary should contain results
    summary_text = page.locator("#cpm-summary").text_content()
    assert "Run analysis to see results" not in summary_text

    # Switch back to CPM — results should be cleared
    page.locator("#toggle-pert").uncheck()
    summary_text_after = page.locator("#cpm-summary").text_content()
    assert "Run analysis to see results" in summary_text_after


# ---------------------------------------------------------------------------
# Group 3 — Data persistence
# ---------------------------------------------------------------------------

def test_pert_data_persists_after_reload(page):
    """PERT task data stored in localStorage should survive a page reload."""
    page.goto(BASE_URL, wait_until="domcontentloaded")

    # Set duration=0 so PERT seeding is skipped; O/M/P cells start blank
    fill_rows(page, [
        {"id": "A", "name": "Task A", "duration": "0", "dependencies": ""},
        {"id": "B", "name": "Task B", "duration": "0", "dependencies": "A"},
    ])

    page.locator("#toggle-pert").check()

    # A: E = (2+12+4)/6 = 3.0  B: E = (1+20+9)/6 = 5.0  →  project_duration = 8
    for row_idx, (o, m, p) in enumerate([("2", "3", "4"), ("1", "5", "9")], start=1):
        for col, val in zip([5, 6, 7], [o, m, p]):
            page.locator(
                f"#input-table tbody tr:nth-of-type({row_idx}) td:nth-of-type({col})"
            ).fill(val)

    resp, _ = click_analyze_and_capture(page)
    assert resp.status == 200

    page.reload(wait_until="domcontentloaded")

    # PERT toggle is not auto-restored on reload — re-enable manually.
    # After reload, duration="0" and O/M/P are restored from localStorage.
    # Re-enabling the toggle skips seeding (dur="0"), preserving the saved O/M/P.
    page.locator("#toggle-pert").check()

    resp2, _ = click_analyze_and_capture(page)
    assert resp2.status == 200
    assert resp2.json()["result"]["project_duration"] == pytest.approx(8.0, rel=1e-3)


# ---------------------------------------------------------------------------
# Group 4 — PERT validation
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("rows, expected_error_part", [
    # Optimistic > Most Likely
    ([{"id": "A", "optimistic": "9", "most_likely": "3", "pessimistic": "9", "dependencies": ""}],
     "Must satisfy: Optimistic \u2264 Most Likely \u2264 Pessimistic"),

    # Most Likely > Pessimistic
    ([{"id": "A", "optimistic": "1", "most_likely": "8", "pessimistic": "5", "dependencies": ""}],
     "Must satisfy: Optimistic \u2264 Most Likely \u2264 Pessimistic"),

    # Negative optimistic
    ([{"id": "A", "optimistic": "-1", "most_likely": "2", "pessimistic": "5", "dependencies": ""}],
     "must all be greater than zero"),

    # Duplicate ID
    ([{"id": "A", "optimistic": "1", "most_likely": "2", "pessimistic": "3", "dependencies": ""},
      {"id": "A", "optimistic": "1", "most_likely": "2", "pessimistic": "3", "dependencies": ""}],
     "Duplicate ID"),

    # Reference to non-existent dependency
    ([{"id": "A", "optimistic": "1", "most_likely": "2", "pessimistic": "3", "dependencies": "Z"}],
     "Missing dependency"),

    # Self-dependency
    ([{"id": "A", "optimistic": "1", "most_likely": "2", "pessimistic": "3", "dependencies": "A"}],
     "Self-dependency"),
])
def test_pert_validation_scenarios(page, rows, expected_error_part):
    page.goto(BASE_URL, wait_until="domcontentloaded")
    page.locator("#toggle-pert").check()
    fill_pert_rows(page, rows)

    resp, _ = click_analyze_and_capture(page)
    assert resp.status == 400

    error_row = page.locator("#input-table tbody tr.table-danger").first
    expect(error_row).to_be_visible()
    assert expected_error_part in error_row.get_attribute("title")
