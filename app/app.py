from flask import Flask, jsonify, render_template, request
from services.scheduling import *
from datetime import date

app = Flask(__name__)

@app.get("/")
def home():
    return render_template("index.html")

@app.get("/api/health")
def health():
    return jsonify({"ok": True})

@app.post("/api/analyze")
def analyze():
    try:
        data = request.get_json(force=True) or {}
        tasks = data.get("tasks", [])
        project_start = data.get("project_start")
        mode = data.get("mode", "cpm")

        if not project_start:
            project_start = date.today().isoformat()
        if mode == "pert":
            result = analyze_pert(tasks)
        else:
            result = analyze_cpm(tasks)

        result["project_start"] = project_start
        return jsonify({"ok": True, "result": result})
    except ScheduleValidationError as e:
        return jsonify({
            "ok": False, 
            "error": "Validation Failed", 
            "validation_errors": e.errors  
        }), 400
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

if __name__ == "__main__":
    app.run(debug=True)