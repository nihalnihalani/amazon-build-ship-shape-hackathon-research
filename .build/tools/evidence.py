#!/usr/bin/env python3
"""Append one evidence entry with the HOST CLOCK timestamp and the current HEAD commit.
Usage: evidence.py '<json object without id/timestamp/commit>'   (id auto-assigned)"""
import json, sys, subprocess, os
P = os.path.join(os.path.dirname(__file__), "..", "evidence.jsonl")
e = json.loads(sys.argv[1])
lines = [json.loads(l) for l in open(P) if l.strip()]
n = max(int(x["id"].split("-")[1]) for x in lines) + 1
now = subprocess.run(["date", "+%Y-%m-%dT%H:%M:%S%z"], capture_output=True, text=True).stdout.strip()
e = {"id": f"EV-{n:04d}", **e, "timestamp": now[:-2] + ":" + now[-2:]}
e.setdefault("commit", subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip())
open(P, "a").write(json.dumps(e) + "\n")
print(e["id"])
