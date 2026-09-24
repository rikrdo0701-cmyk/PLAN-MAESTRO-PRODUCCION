import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
APP_JS = (ROOT / "src" / "web" / "planning" / "app.js").read_text(encoding="utf-8")
OUT_DIR = ROOT / "tests" / "artifacts"
OUT_DIR.mkdir(parents=True, exist_ok=True)

match = re.search(r"const sampleState = \{.*?\n  operations: (\[.*?\n  \]),\n\};", APP_JS, re.S)
if not match:
    print("FAIL: no se pudo extraer sampleState.operations de app.js")
    sys.exit(1)

raw_ops = match.group(1)
raw_ops = re.sub(r"//.*?$", "", raw_ops, flags=re.M)
raw_ops = re.sub(r"([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', raw_ops)
raw_ops = re.sub(r",\s*([}\]])", r"\1", raw_ops)
sample_operations = json.loads(raw_ops)
ots = sorted({op["ot"] for op in sample_operations if op.get("ot")})
prices = {
    ot: {"lastSalePrice": 12.5 + i * 3.25, "averageSalePrice": 10 + i * 2.5}
    for i, ot in enumerate(ots)
}

fixture = {
    "schemaVersion": 29,
    "revision": 42,
    "savedAt": "2026-06-28T18:00:00.000Z",
    "planStart": "2026-06-29",
    "loadWeekStart": "2026-06-29",
    "reportWeekStart": "2026-06-29",
    "horizonDays": 15,
    "plant": {"name": "QA Local", "locationId": None},
    "operations": sample_operations,
    "workOrders": [
        {
            "ot": ot,
            "item": next((op.get("parte") for op in sample_operations if op.get("ot") == ot), ""),
            "quantity": max(
                (int(op.get("cantTotal") or 0) for op in sample_operations if op.get("ot") == ot),
                default=50,
            ),
            "pendingQuantity": max(
                (int(op.get("cantPendiente") or 0) for op in sample_operations if op.get("ot") == ot),
                default=50,
            ),
            "lastSalePrice": prices[ot]["lastSalePrice"],
            "averageSalePrice": prices[ot]["averageSalePrice"],
            "status": "LIBERADO",
        }
        for ot in ots
    ],
    "selectedOts": ots,
    "lockedOts": [],
    "expandedOts": ots[:],
    "lastSchedule": {
        "generatedAt": "2026-06-28T17:30:00.000Z",
        "scheduledOts": ots,
        "changes": 0,
        "unscheduled": 0,
    },
    "settings": {
        "weeklyReleaseTarget": 250000,
        "defaultSubcontractDays": 3,
        "toolChangeCt": "122",
        "toolChangeMinutes": 120,
        "toolChangeOperator": "AJUSTADOR",
        "flowBalancedEnabled": True,
        "flowWipTarget": 10,
    },
}


def parse_money(text: str) -> float:
    cleaned = re.sub(r"[^0-9.\-]", "", text or "")
    if cleaned in {"", "-", ".", "-."}:
        return 0.0
    return float(cleaned)


def run() -> int:
    failures = []
    console_errors = []
    api_logs = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1100})
        page = context.new_page()
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: console_errors.append(str(exc)))
        page.on(
            "request",
            lambda req: api_logs.append(f"REQ {req.method} {req.url}") if "/api/" in req.url else None,
        )
        page.on(
            "response",
            lambda res: api_logs.append(f"RES {res.status} {res.url}") if "/api/" in res.url else None,
        )

        seed = f"""
        (() => {{
          const KEY = "plan-produccion-app-v1";
          try {{
            localStorage.clear();
            sessionStorage.clear();
            localStorage.setItem(KEY, JSON.stringify({json.dumps(fixture)}));
            localStorage.setItem("plan-snapshots-cache-v1", "[]");
            localStorage.setItem("plan-version-counter-v1", "{{}}");
          }} catch (e) {{
            console.error("seed failed", e);
          }}
          const originalFetch = window.fetch.bind(window);
          window.fetch = async (input, init) => {{
            const url = typeof input === "string" ? input : (input && input.url) || "";
            if (url.includes("/api/plan-sheet")) {{
              return new Response(JSON.stringify({json.dumps(fixture)}), {{
                status: 200,
                headers: {{ "Content-Type": "application/json" }},
              }});
            }}
            if (url.includes("/api/plan-snapshots")) {{
              if (url.includes("/api/plan-snapshots/")) {{
                return new Response("null", {{ status: 404, headers: {{ "Content-Type": "application/json" }} }});
              }}
              return new Response("[]", {{ status: 200, headers: {{ "Content-Type": "application/json" }} }});
            }}
            return originalFetch(input, init);
          }};
        }})();
        """
        context.add_init_script(seed)

        page.goto("http://127.0.0.1:4173/#reportes", wait_until="domcontentloaded")
        page.wait_for_selector("#weekReport", timeout=15000)

        dialog = page.locator("#planningDialog")
        try:
            dialog.wait_for(state="visible", timeout=4000)
            title = page.locator("#planningDialogTitle").inner_text()
            print(f"Dialog: {title}")
            page.locator("#planningDialogConfirm").click()
            dialog.wait_for(state="hidden", timeout=5000)
        except Exception:
            pass

        page.locator(".nav-item[data-section='reportes']").click()
        page.locator("button[data-tab='week']").click()

        select = page.locator("#planSnapshotSelect")
        select.wait_for(state="visible", timeout=5000)
        select.select_option("draft")

        week_input = page.locator("#reportWeekStartInput")
        week_input.wait_for(state="visible", timeout=5000)
        week_input.fill("2026-06-29")
        week_input.dispatch_event("change")
        page.wait_for_timeout(1200)

        debug = page.evaluate(
            """() => {
              const raw = localStorage.getItem("plan-produccion-app-v1");
              const cached = raw ? JSON.parse(raw) : null;
              return {
                hasLocal: Boolean(cached),
                ops: cached?.operations?.length ?? -1,
                wos: cached?.workOrders?.length ?? -1,
                selected: cached?.selectedOts?.length ?? -1,
                plant: cached?.plant?.name ?? null,
                week: document.querySelector("#reportWeekStartInput")?.value || "",
                select: document.querySelector("#planSnapshotSelect")?.value || "",
                meta: document.querySelector("#reportSnapshotMeta")?.textContent || "",
                exec: (document.querySelector("#weekExecutiveSummary")?.innerText || "").slice(0, 350),
                report: (document.querySelector("#weekReport")?.innerText || "").slice(0, 350),
              };
            }"""
        )
        print("DEBUG", json.dumps(debug, ensure_ascii=False))
        if api_logs:
            print("API", api_logs[:20])

        week_report = page.locator("#weekReport")
        finish_panels = page.locator("#weekReport .weekly-job-panel.finish")
        body_rows = page.locator("#weekReport .weekly-job-panel.finish table tbody tr")
        row_count = body_rows.count()
        money_cells = page.locator("#weekReport .weekly-job-panel.finish table tbody tr td:nth-child(5)")
        samples = []
        positive_rows = 0
        zero_rows = 0
        for i in range(money_cells.count()):
            text = money_cells.nth(i).inner_text()
            samples.append(text)
            if parse_money(text) > 0:
                positive_rows += 1
            else:
                zero_rows += 1

        if row_count == 0:
            failures.append("Sin filas en Acabado/MONTO")
        elif positive_rows == 0:
            failures.append(f"Todas las celdas MONTO en $0.00 ({samples[:5]})")
        elif zero_rows > 0:
            failures.append(f"{zero_rows} filas MONTO en $0.00 de {row_count} ({samples[:12]})")

        exec_text = page.locator("#weekExecutiveSummary").inner_text()
        monto_val = 0.0
        lines = exec_text.splitlines()
        for idx, line in enumerate(lines):
            if "MONTO DE LIBERACION" in line.upper() or "Monto de liberacion" in line:
                chunk = " ".join(lines[idx : idx + 2])
                monto_val = parse_money(chunk)
                break
        if monto_val <= 0:
            failures.append(f"Monto de liberacion en 0: {exec_text[:300]!r}")

        pzas_cells = page.locator("#weekReport .weekly-job-panel.finish table tbody tr td:nth-child(4)")
        if pzas_cells.count():
            zero_pzas = sum(
                1 for i in range(pzas_cells.count()) if parse_money(pzas_cells.nth(i).inner_text()) <= 0
            )
            if zero_pzas == pzas_cells.count():
                failures.append("Todas las PZAS en Acabado en 0")

        page.screenshot(path=str(OUT_DIR / "week-report-borrador.png"), full_page=True)

        meta = page.locator("#reportSnapshotMeta").inner_text()
        if "Borrador" not in meta and "borrador" not in meta.lower():
            failures.append(f"Meta del reporte no indica Borrador: {meta!r}")

        print(f"Filas MONTO: {row_count} | positivas: {positive_rows} | ceros: {zero_rows}")
        print(f"Muestras MONTO: {samples[:8]}")
        print(f"Screenshot: {OUT_DIR / 'week-report-borrador.png'}")
        if console_errors:
            print(f"Errores consola ({len(console_errors)}): {console_errors[:8]}")

        browser.close()

    if failures:
        print("FAIL")
        for item in failures:
            print(f"  - {item}")
        return 1

    print("PASS: Plan de la semana Borrador muestra PZAS y MONTO no cero")
    return 0


if __name__ == "__main__":
    sys.exit(run())
