from statistics import NormalDist
import math
from collections import defaultdict, deque
from typing import Dict, List, Set, Any

class ScheduleValidationError(Exception):
    def __init__(self, errors: List[Dict[str, Any]]):
        self.errors = errors
        super().__init__("Validation failed")


# ── Validation ────────────────────────────────────────────────────────────────

def validate_common(tasks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Structural checks shared by both CPM and PERT modes.
    Returns a list of error dicts (does not raise).
    """
    if not isinstance(tasks, list):
        raise ValueError("Wrong type of objects sent")

    if not tasks:
        raise ValueError("Input must be a non-empty list of task objects")

    errors = []
    valid_ids = set()
    seen_ids = set()

    for i, task in enumerate(tasks, start=1):
        tid = task.get("id")
        # No need to check he tasks with no id further
        if not tid or not isinstance(tid, str):
            errors.append({"id": None, "msg": f"Row {i} missing ID"})
            continue

        if tid in seen_ids:
            errors.append({"id": tid, "msg": f"Duplicate ID: {tid}"})
        else:
            seen_ids.add(tid)
            valid_ids.add(tid)

        deps = task.get("dependencies")
        if deps is not None and not isinstance(deps, list):
            errors.append({"id": tid, "msg": "Dependencies must be a list"})

    for task in tasks: 
        tid = task.get("id")
        # If the task has no ID it's already broken and the error is already appened from the previous cycle
        if not tid or tid not in valid_ids:
            continue

        deps = task.get("dependencies", [])
        if isinstance(deps, list):
            for dep in deps:
                if dep == tid:
                    errors.append({"id": tid, "msg": "Self-dependency"})
                elif dep not in valid_ids:
                    errors.append({"id": tid, "msg": f"Missing dependency: {dep}"})

    return errors


def validate_cpm_fields(tasks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """CPM-specific validation: each task must have a duration > 0. Returns error list."""
    errors = []
    for task in tasks:
        tid = task.get("id")
        if not tid or not isinstance(tid, str):
            continue  
        if "duration" not in task:
            errors.append({"id": tid, "msg": "Missing duration"})
        else:
            try:
                d = float(task["duration"])
                if d <= 0:
                    errors.append({"id": tid, "msg": "Duration must be greater than zero"})
            except (TypeError, ValueError):
                errors.append({"id": tid, "msg": "Duration must be a number"})
    return errors


def validate_pert_fields(tasks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """PERT-specific validation: each task must have optimistic ≤ most_likely ≤ pessimistic. Returns error list."""
    errors = []
    for task in tasks:
        tid = task.get("id")
        if not tid or not isinstance(tid, str):
            continue 
        raw = {k: task.get(k) for k in ("optimistic", "most_likely", "pessimistic")}
        missing = [k for k, v in raw.items() if v is None]
        if missing:
            errors.append({"id": tid, "msg": f"PERT mode requires: {', '.join(missing)}"})
            continue
        try:
            o, m, p = float(raw["optimistic"]), float(raw["most_likely"]), float(raw["pessimistic"])
        except (TypeError, ValueError):
            errors.append({"id": tid, "msg": "PERT estimates must be numbers"})
            continue
        if o <= 0 or m <= 0 or p <= 0:
            errors.append({"id": tid, "msg": "Optimistic, Most Likely and Pessimistic must all be greater than zero"})
        elif not (o <= m <= p):
            errors.append({"id": tid, "msg": "Must satisfy: Optimistic ≤ Most Likely ≤ Pessimistic"})
    return errors


# ── Core Algorithm ────────────────────────────────────────────────────────────

def _forward_backward_pass(tasks: List[Dict[str, Any]]):
    """
    Topological sort + forward pass (ES/EF) + backward pass (LS/LF).
    Returns activity times and graph relationships for use by both CPM and PERT.
    """
    preds: Dict[str, Set[str]] = {t["id"]: set(t.get("dependencies", [])) for t in tasks}
    succs: Dict[str, Set[str]] = defaultdict(set)
    dur: Dict[str, float] = {t["id"]: float(t.get("duration", 0.0)) for t in tasks}

    for task in tasks:
        for pred in task.get("dependencies", []):
            succs[pred].add(task["id"])

    in_degree: Dict[str, int] = {
        taskId: len(preds[taskId]) for taskId in preds
    }
    queue: deque[str] = deque(sorted([
        taskId
        for taskId, depCount in in_degree.items()
        if depCount == 0
    ]))
    topological_order: List[str] = []

    while queue:
        currentTaskId = queue.popleft()
        topological_order.append(currentTaskId)

        for dependentTaskId in succs[currentTaskId]:
            in_degree[dependentTaskId] -= 1
            if in_degree[dependentTaskId] == 0:
                queue.append(dependentTaskId)

    if len(topological_order) != len(tasks):
        processed = set(topological_order)
        cycle_ids = {t["id"] for t in tasks if t["id"] not in processed}
        changed = True
        while changed:
            sinks = {tid for tid in cycle_ids if not (succs[tid] & cycle_ids)}
            changed = bool(sinks)
            cycle_ids -= sinks
        raise ScheduleValidationError([
            {"id": tid, "msg": "Cycle detected in dependencies"}
            for tid in cycle_ids
        ])

    es: Dict[str, float] = {}
    ef: Dict[str, float] = {}

    for taskId in topological_order:
        es[taskId] = max((ef[p] for p in preds[taskId]), default=0.0)
        ef[taskId] = es[taskId] + dur[taskId]
    project_duration = max(ef.values(), default=0.0)

    ls: Dict[str, float] = {}
    lf: Dict[str, float] = {}
    for taskId in reversed(topological_order):
        lf[taskId] = min((ls[s] for s in succs[taskId]), default=project_duration)
        ls[taskId] = lf[taskId] - dur[taskId]

    slack: Dict[str, float] = {taskId: ls[taskId] - es[taskId] for taskId in topological_order}
    return es, ef, ls, lf, slack, project_duration, preds, succs, topological_order, dur


def _build_aon_view(
    es: Dict[str, float],
    ef: Dict[str, float],
    ls: Dict[str, float],
    lf: Dict[str, float],
    slack: Dict[str, float],
    preds: Dict[str, Set[str]],
    succs: Dict[str, Set[str]],
    topology: List[str],
    dur: Dict[str, float],
    project_duration: float,
):
    """
    Build Activity-on-Node (AoN) view using CPM results.

    In AoN:
      - each *activity* becomes a node
      - precedence relations become edges (pred -> succ)
    """
    aon_nodes: List[Dict[str, Any]] = []
    aon_edges: List[Dict[str, Any]] = []

    for task_id in topology:
        aon_nodes.append({
            "id": task_id,
            "label": task_id,              
            "duration": dur[task_id],
            "es": es[task_id],
            "ef": ef[task_id],
            "ls": ls[task_id],
            "lf": lf[task_id],
            "slack": slack[task_id],
            "critical": abs(slack[task_id]) < 1e-6,
            "dependencies": list(preds[task_id]),
        })
    for current_id, succ_set in succs.items():
        for succ_id in succ_set:
            aon_edges.append({
                "id": f"{current_id}->{succ_id}",
                "source": current_id,
                "target": succ_id,
            })
    return {
        "project_duration": project_duration,
        "nodes": aon_nodes,
        "edges": aon_edges,
    }


# ── Full Schedule Analysis ────────────────────────────────────────────────────

def _compute_schedule(tasks: List[Dict[str, Any]]):
    es, ef, ls, lf, slack, project_duration, preds, succs, topology, dur = _forward_backward_pass(tasks)
    
    pred_sets = set()
    for t in tasks:
        pred_sets.add(frozenset(preds[t["id"]]))
        
    node_id_map = {}
    node_label_map = {}
    node_counter = 1
    
    def get_node_id_and_label(key):
        nonlocal node_counter
        if key not in node_id_map:
            if key == "START" or key == "END":
                node_id_map[key] = key
                node_label_map[key] = key
            elif isinstance(key, frozenset):
                node_id_map[key] = str(node_counter)
                node_label_map[key] = "after{" + ",".join(sorted(list(key))) + "}"
                node_counter += 1
            else: 
                node_id_map[key] = str(node_counter)
                node_label_map[key] = key
                node_counter += 1
        return node_id_map[key]

    get_node_id_and_label("START")
    get_node_id_and_label("END")
    
    task_tails = {}
    for t in topology:
        p_set = frozenset(preds[t])
        if not p_set:
            task_tails[t] = "START"
        else:
            task_tails[t] = get_node_id_and_label(p_set)
            
    task_heads = {}
    for t in topology:
        targets = [s for s in pred_sets if t in s]
        if not targets:
            task_heads[t] = "END"
        elif len(targets) == 1:
            task_heads[t] = get_node_id_and_label(targets[0])
        else:
            target_frozenset = frozenset([t])
            if target_frozenset in pred_sets:
                task_heads[t] = get_node_id_and_label(target_frozenset)
            else:
                task_heads[t] = get_node_id_and_label(f"Completion_{t}")
                
    seen_edges = set()
    dummies = []
    dummy_counter = 1
    
    for t in topology:
        tail = task_tails[t]
        head = task_heads[t]
        
        if (tail, head) in seen_edges:
            new_head = get_node_id_and_label(f"Parallel_{t}")
            task_heads[t] = new_head
            dummies.append({
                "id": f"X{dummy_counter}",
                "name": f"X{dummy_counter}",
                "duration": 0.0,
                "tail_node": new_head,
                "head_node": head,
                "dependencies": [t],
                "is_dummy": True
            })
            dummy_counter += 1
            seen_edges.add((tail, new_head))
            seen_edges.add((new_head, head))
        else:
            seen_edges.add((tail, head))

    for s in pred_sets:
        if not s: continue 
        s_node = get_node_id_and_label(s)
        for x in s:
            x_head = task_heads[x]
            if x_head != s_node:
                if (x_head, s_node) not in seen_edges:
                    dummies.append({
                        "id": f"X{dummy_counter}",
                        "name": f"X{dummy_counter}",
                        "duration": 0.0,
                        "tail_node": x_head,
                        "head_node": s_node,
                        "dependencies": [x],
                        "is_dummy": True
                    })
                    dummy_counter += 1
                    seen_edges.add((x_head, s_node))

    task_names = {task["id"]: task.get("name") or task["id"] for task in tasks}

    all_activities = []
    for t in topology:
        all_activities.append({
            "id": t,
            "name": task_names[t],
            "duration": dur[t],
            "es": es[t], "ef": ef[t],
            "ls": ls[t], "lf": lf[t],
            "slack": slack[t],
            "critical": abs(slack[t]) < 1e-6,
            "dependencies": list(preds[t]),
            "tail_node": task_tails[t],
            "head_node": task_heads[t],
            "is_dummy": False
        })
    all_activities.extend(dummies)

    aoa_succs = defaultdict(list)
    aoa_preds = defaultdict(list)
    for act in all_activities:
        aoa_succs[act["tail_node"]].append(act)
        aoa_preds[act["head_node"]].append(act)
        
    all_node_ids = list(set(aoa_succs.keys()) | set(aoa_preds.keys()))
    node_earliest = {n: 0.0 for n in all_node_ids}
    node_latest = {n: project_duration for n in all_node_ids}
    in_degree = {n: len(aoa_preds[n]) for n in all_node_ids}
    q = deque([n for n, deg in in_degree.items() if deg == 0])
    topo_nodes = []

    while q:
        u = q.popleft()
        topo_nodes.append(u)
        for act in aoa_succs[u]:
            v = act["head_node"]
            in_degree[v] -= 1
            if in_degree[v] == 0:
                q.append(v)

    _counter = 1
    rename = {}
    for n in topo_nodes:
        if n in ("START", "END"):
            rename[n] = n
        else:
            rename[n] = str(_counter)
            _counter += 1

    for act in all_activities:
        act["tail_node"] = rename[act["tail_node"]]
        act["head_node"] = rename[act["head_node"]]

    node_id_map = {k: rename.get(v, v) for k, v in node_id_map.items()}

    aoa_succs = defaultdict(list)
    aoa_preds = defaultdict(list)
    for act in all_activities:
        aoa_succs[act["tail_node"]].append(act)
        aoa_preds[act["head_node"]].append(act)

    all_node_ids = list(set(aoa_succs.keys()) | set(aoa_preds.keys()))
    topo_nodes = [rename[n] for n in topo_nodes]

    for u in topo_nodes:
        for act in aoa_succs[u]:
            v = act["head_node"]
            node_earliest[v] = max(node_earliest[v], node_earliest[u] + act["duration"])
            
    for u in reversed(topo_nodes):
        for act in aoa_succs[u]:
            v = act["head_node"]
            node_latest[u] = min(node_latest[u], node_latest[v] - act["duration"])
            
    for act in all_activities:
        if act.get("is_dummy"):
            u = act["tail_node"]
            v = act["head_node"]
            act["es"] = node_earliest[u]
            act["ef"] = node_earliest[u]
            act["lf"] = node_latest[v]
            act["ls"] = node_latest[v]
            act["slack"] = act["ls"] - act["es"]
            act["critical"] = abs(act["slack"]) < 1e-6

    result_nodes = []
    id_to_label = {v: node_label_map[k] for k, v in node_id_map.items()}
    for n_id in all_node_ids:
        members = [act["id"] for act in aoa_succs[n_id] if not act.get("is_dummy")]
        result_nodes.append({
            "id": n_id,
            "label": n_id,
            "data_label": id_to_label.get(n_id, n_id),
            "earliest": node_earliest[n_id],
            "latest": node_latest[n_id],
            "members": members
        })
        
    aon_view = _build_aon_view(
        es=es, ef=ef, ls=ls, lf=lf, slack=slack,
        preds=preds, succs=succs, topology=topology,
        dur=dur, project_duration=project_duration,
    )

    return {
        "project_duration": project_duration,
        "tasks": all_activities,
        "nodes": result_nodes,
        "aon": aon_view
    }


# ── Public API ────────────────────────────────────────────────────────────────

def analyze_cpm(tasks: List[Dict[str, Any]]):
    errors = validate_common(tasks) + validate_cpm_fields(tasks)
    if errors:
        raise ScheduleValidationError(errors)
    return _compute_schedule(tasks)


def analyze_pert(tasks: List[Dict[str, Any]]):
    errors = validate_common(tasks) + validate_pert_fields(tasks)
    if errors:
        raise ScheduleValidationError(errors)

    pert_data: Dict[str, Dict[str, float]] = {}
    cpm_tasks: List[Dict[str, Any]] = []

    for t in tasks:
        task_id = t["id"]
        o = float(t["optimistic"])
        m = float(t["most_likely"])
        p = float(t["pessimistic"])
        expected  = (o + 4.0 * m + p) / 6.0
        variance  = ((p - o) / 6.0) ** 2
        pert_data[task_id] = {
            "optimistic":  o,
            "most_likely": m,
            "pessimistic": p,
            "expected":    expected,
            "variance":    variance,
            "std_dev":     math.sqrt(variance),
        }
        cpm_tasks.append({**t, "duration": expected})

    result = _compute_schedule(cpm_tasks)

    for task in result["tasks"]:
        task_id = task["id"]
        if task_id in pert_data:
            task.update(pert_data[task_id])

    crit_variance = sum(
        pert_data[t["id"]]["variance"]
        for t in result["tasks"]
        if t.get("critical") and not t.get("is_dummy") and t["id"] in pert_data
    )
    project_std = math.sqrt(crit_variance) if crit_variance > 0 else 0.0
    project_duration = result["project_duration"]

    result["pert_stats"] = {
        "expected_duration": project_duration,
        "variance":  crit_variance,
        "std_dev":   project_std,
        "deadlines": {
            "p50":  round(project_duration + NormalDist().inv_cdf(0.50) * project_std, 2),
            "p75":  round(project_duration + NormalDist().inv_cdf(0.75) * project_std, 2),
            "p90":  round(project_duration + NormalDist().inv_cdf(0.90) * project_std, 2),
            "p95":  round(project_duration + NormalDist().inv_cdf(0.95) * project_std, 2),
            "p99":  round(project_duration + NormalDist().inv_cdf(0.99) * project_std, 2),
        },
    }
    return result