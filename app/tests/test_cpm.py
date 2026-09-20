import re
import pytest
from jsonschema import validate
from playwright.sync_api import expect

from conftest import (
    BASE_URL, REQUEST_SCHEMA,
    fill_rows, click_analyze_and_capture, get_debug_json, normalize,
)

DATA_ROWS = [
    {"id": "A", "name": "Task A", "duration": "3", "dependencies": ""},
    {"id": "B", "name": "Task B", "duration": "11.0", "dependencies": "A"},
    {"id": "C", "name": "Task C", "duration": "13.0", "dependencies": ""},
    {"id": "D", "name": "Task D", "duration": "05", "dependencies": "A"},
    {"id": "E", "name": "Task E", "duration": "4", "dependencies": "B,C"},
    {"id": "F", "name": "Task F", "duration": "6", "dependencies": "B, C"},
    {"id": "G", "name": "Task G", "duration": "2", "dependencies": "  F"},
    {"id": "H", "name": "Task H", "duration": "1", "dependencies": "D, E  ,  F"},
]

EXPECTED_NODES = {
    "START":        {"earliest": 0,  "latest": 0,  "members": ["A", "C"]},
    "after{A}":     {"earliest": 3,  "latest": 3,  "members": ["B", "D"]},
    "after{B,C}":   {"earliest": 14, "latest": 14, "members": ["E", "F"]},
    "after{F}":     {"earliest": 20, "latest": 20, "members": ["G"]},
    "after{D,E,F}": {"earliest": 20, "latest": 21, "members": ["H"]},
    "END":          {"earliest": 22, "latest": 22, "members": []},
}


shared_ctx = None
shared_page = None
captured_payload = None
captured_server_json = None

@pytest.fixture(scope="module", autouse=True)
def _prepare_shared_session(browser):
    global shared_ctx, shared_page, captured_payload, captured_server_json

    shared_ctx = browser.new_context()
    shared_page = shared_ctx.new_page()

    shared_page.goto(BASE_URL, wait_until="domcontentloaded")

    toggle = shared_page.locator("#toggle-json")
    expect(toggle).to_be_visible()
    toggle.check()

    fill_rows(shared_page, DATA_ROWS)

    resp, payload = click_analyze_and_capture(shared_page)
    assert resp.status == 200
    validate(instance=payload, schema=REQUEST_SCHEMA)

    captured_payload = payload
    captured_server_json = resp.json().get("result")

    yield
    shared_ctx.close()


def test_json_payload_accuracy():
    """Verify the payload sent to server matches input and server response."""
    ui_data = get_debug_json(shared_page)
    server_json = captured_server_json

    assert server_json["project_duration"] == 22
    assert ui_data["project_duration"] == 22

    payload_map = {t["id"]: t for t in captured_payload["tasks"]}

    expected_tasks = {
        "A": (3, []),
        "B": (11, ["A"]),
        "C": (13, []),
        "D": (5, ["A"]),
        "E": (4, ["B", "C"]),
        "F": (6, ["B", "C"]),
        "G": (2, ["F"]),
        "H": (1, ["D", "E", "F"])
    }

    for tid, (dur, deps) in expected_tasks.items():
        task = payload_map[tid]
        assert task["duration"] == dur
        assert sorted(task["dependencies"]) == sorted(deps)


def test_json_nodes_accuracy():
    """Verify AoA nodes calculation."""
    server_nodes = {n["data_label"]: n for n in captured_server_json["nodes"]}
    ui_nodes = {n["data_label"]: n for n in get_debug_json(shared_page)["nodes"]}

    for label, exp in EXPECTED_NODES.items():
        assert label in server_nodes
        assert server_nodes[label]["earliest"] == exp["earliest"]
        assert server_nodes[label]["latest"] == exp["latest"]
        assert sorted(server_nodes[label]["members"]) == sorted(exp["members"])

        assert ui_nodes[label] == server_nodes[label]


def test_summary_block_ui():
    summary = shared_page.locator("#cpm-summary").text_content()
    assert re.search(r"# Tasks\s+8", summary)
    assert re.search(r"Critical Path\s+A → B → F → G", summary)


def test_table_block_ui():
    shared_page.locator("#table-tab").click()
    rows = shared_page.locator("#cpm-table table.cpm-table tbody tr")
    expect(rows).to_have_count(len(DATA_ROWS))

    server_tasks = {t["id"]: t for t in captured_server_json["tasks"]}

    for i in range(rows.count()):
        row = rows.nth(i)
        tid = row.locator("td:nth-child(1)").text_content().strip()
        data = server_tasks[tid]

        checks = [
            (1, str(data["id"])),
            (2, str(data["name"])),
            (3, normalize(data["duration"])),
            (4, normalize(data["es"])),
            (5, normalize(data["ef"])),
            (6, normalize(data["ls"])),
            (7, normalize(data["lf"])),
            (8, normalize(data["slack"]))
        ]
        for col, val in checks:
            assert row.locator(f"td:nth-child({col})").text_content().strip() == val

        if data["critical"]:
            expect(row.locator(".badge-critical")).to_be_visible()
            expect(row).to_have_class(re.compile(r"cpm-row-critical"))


@pytest.mark.parametrize("rows, expected_error_part", [
    ([{"id": "A", "name": "A", "duration": "x", "dependencies": ""}],
     "Duration must be a number"),

    ([{"id": "A", "name": "A", "duration": "-1", "dependencies": ""}],
     "Duration must be greater than zero"),

    ([{"id": "A", "name": "A", "duration": "1", "dependencies": "A"}],
     "Self-dependency"),

    ([{"id": "A", "name": "A", "duration": "1", "dependencies": "B"}],
     "Missing dependency: B"),

    ([{"id": "A", "name": "A", "duration": "1", "dependencies": ""},
      {"id": "A", "name": "Dup", "duration": "2", "dependencies": ""}],
     "Duplicate ID: A"),

    ([{"id": "A", "name": "A", "duration": "1", "dependencies": "B"},
      {"id": "B", "name": "B", "duration": "1", "dependencies": "A"}],
     "Cycle detected"),
])
def test_validation_scenarios(page, rows, expected_error_part):
    page.goto(BASE_URL, wait_until="domcontentloaded")
    fill_rows(page, rows)

    resp, _ = click_analyze_and_capture(page)

    error_row = page.locator("#input-table tbody tr.table-danger").first
    expect(error_row).to_be_visible()
    title_text = error_row.get_attribute("title")
    assert expected_error_part in title_text


def test_zero_duration_rejected(page):
    """Tasks with duration 0 must be rejected with a validation error."""
    page.goto(BASE_URL, wait_until="domcontentloaded")
    rows = [
        {"id": "A", "duration": "0", "dependencies": ""},
        {"id": "B", "duration": "2", "dependencies": "A"},
    ]
    fill_rows(page, rows)
    resp, _ = click_analyze_and_capture(page)

    assert resp.status == 400
    errors = resp.json().get("validation_errors", [])
    assert any(e["id"] == "A" and "greater than zero" in e["msg"] for e in errors)


def test_smart_delete_handling(page):
    """Verifies that deleting a task highlights dependent tasks as errors."""
    page.goto(BASE_URL, wait_until="domcontentloaded")

    fill_rows(page, [
        {"id": "A", "duration": "5", "dependencies": ""},
        {"id": "B", "duration": "3", "dependencies": "A"},
    ])

    resp, _ = click_analyze_and_capture(page)
    assert resp.status == 200

    page.locator("#input-table tbody tr:first-child .btn-del").click()

    row_b = page.locator("#input-table tbody tr:first-child")
    expect(row_b.locator("td:nth-child(4)")).to_have_text("A")
    expect(row_b).to_have_class(re.compile(r"table-danger"))

    resp2, _ = click_analyze_and_capture(page)
    assert resp2.status == 400

    json2 = resp2.json()
    errors = json2["validation_errors"]
    err_b = next((e for e in errors if e["id"] == "B"), None)

    assert err_b is not None
    assert "Missing dependency: A" in err_b["msg"]


def test_analyze_with_empty_table(page):
    """Clicking Analyze with no tasks shows an error and does not crash."""
    page.goto(BASE_URL, wait_until="domcontentloaded")
    page.locator("#input-table tbody").evaluate("el => { el.innerHTML = ''; }")
    page.locator("#btn-analyze").click()

    out = page.locator("#out")
    expect(out).to_be_visible()
    expect(out).to_have_class(re.compile(r"error"))


def test_auto_id_generation(page):
    """Generates 300 rows and checks ID sequence A..Z, A1..A26, B1.."""
    page.goto(BASE_URL, wait_until="domcontentloaded")

    add_btn = page.locator("#btn-add")
    for _ in range(300):
        add_btn.click()

    ids = page.locator("#input-table tbody tr td:nth-child(1)").all_inner_texts()

    letters = [chr(ord("A") + i) for i in range(26)]
    expected = []
    idx, suffix = 0, 0
    while len(expected) < 300:
        expected.append(f"{letters[idx]}{suffix if suffix else ''}")
        idx += 1
        if idx == 26:
            idx = 0
            suffix += 1

    assert ids == expected
