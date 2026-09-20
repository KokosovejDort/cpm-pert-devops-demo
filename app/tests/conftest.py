import json
import pytest
from playwright.sync_api import expect

BASE_URL = "http://127.0.0.1:5000"

REQUEST_SCHEMA = {
    "type": "object",
    "properties": {
        "tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "minLength": 1},
                    "name": {"type": "string", "minLength": 1},
                    "duration": {"type": "number"},
                    "dependencies": {"type": "array", "items": {"type": "string"}}
                },
                "required": ["id", "name", "duration", "dependencies"]
            }
        },
    },
    "required": ["tasks"]
}


def fill_rows(page, rows):
    """Fill rows in CPM mode. row dicts: id, name, duration, dependencies."""
    add_btn = page.locator("#btn-add")
    for _ in range(len(rows)):
        add_btn.click()

    for i, r in enumerate(rows, start=1):
        for col_idx, key in enumerate(["id", "name", "duration", "dependencies"], start=1):
            loc = page.locator(f'#input-table tbody tr:nth-of-type({i}) td:nth-of-type({col_idx})')
            loc.fill(str(r.get(key, "")))


def fill_pert_rows(page, rows):
    """Fill rows when PERT mode is active. Columns: 1=ID, 2=Name, 4=Dep, 5=O, 6=M, 7=P."""
    add_btn = page.locator("#btn-add")
    for _ in range(len(rows)):
        add_btn.click()

    for i, r in enumerate(rows, start=1):
        for col_idx, key in [(1, "id"), (2, "name"), (4, "dependencies"),
                              (5, "optimistic"), (6, "most_likely"), (7, "pessimistic")]:
            page.locator(
                f'#input-table tbody tr:nth-of-type({i}) td:nth-of-type({col_idx})'
            ).fill(str(r.get(key, "")))


def click_analyze_and_capture(page):
    with page.expect_response("**/analyze") as resp_info:
        page.locator("#btn-analyze").click()
    resp = resp_info.value
    try:
        payload = resp.request.post_data_json
    except Exception:
        payload = json.loads(resp.request.post_data or "{}")
    return resp, payload


def get_debug_json(page):
    el = page.locator("#debug-json")
    expect(el).to_be_visible()
    return json.loads(el.text_content())


def normalize(x):
    return str(x).replace(".0", "") if str(x).endswith(".0") else str(x)
