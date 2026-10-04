#!/usr/bin/env python3
"""Lead-owned helper for durable build state.

Usage:
  graph.py status                              # table of tasks
  graph.py set T05 status=in_progress owner=contracts cwd=/abs/path reviewer=lead
  graph.py evidence T05 EV-0010                 # append evidence ref
  graph.py ready                               # tasks whose deps are verified and status pending
Rules enforced: 'verified' requires >=1 evidence ref and status in_review first;
blocked_external tasks cannot be set verified; cancelled_optional only for required=false.
"""
import json, sys, datetime, os
P = os.path.join(os.path.dirname(__file__), "..", "task-graph.json")
def load(): return json.load(open(P))
def save(g):
    g["updated_at"] = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    json.dump(g, open(P, "w"), indent=1)
def find(g, tid):
    for t in g["tasks"]:
        if t["id"] == tid: return t
    sys.exit(f"no task {tid}")
def main(a):
    g = load()
    if not a or a[0] == "status":
        for t in g["tasks"]:
            print(f'{t["id"]:5} {t["status"]:17} {str(t["owner"]):18} att={t["attempts"]} ev={len(t["evidence_refs"])} {t["title"]}')
        return
    if a[0] == "ready":
        done = {t["id"] for t in g["tasks"] if t["status"] == "verified"}
        for t in g["tasks"]:
            if t["status"] in ("pending", "ready") and all(d in done for d in t["dependencies"]):
                print(t["id"], t["title"])
        return
    if a[0] == "evidence":
        t = find(g, a[1]); t["evidence_refs"] += [x for x in a[2:] if x not in t["evidence_refs"]]; save(g); return
    if a[0] == "set":
        t = find(g, a[1])
        for kv in a[2:]:
            k, v = kv.split("=", 1)
            if k == "status":
                if v not in g["states"]: sys.exit(f"bad state {v}")
                if v == "verified":
                    if t["status"] == "blocked_external": sys.exit("blocked task cannot be verified")
                    if t["status"] != "in_review": sys.exit("must be in_review before verified")
                    if not t["evidence_refs"]: sys.exit("verified requires evidence refs")
                if v == "cancelled_optional" and t["required"]: sys.exit("required task cannot be cancelled_optional")
                if v == "in_progress" and t["status"] in ("rework", "pending", "ready", "blocked_external"): t["attempts"] += 1
            if k == "attempts": v = int(v)
            if v == "null": v = None
            t[k] = v
        save(g); return
    sys.exit("unknown command")
if __name__ == "__main__": main(sys.argv[1:])
