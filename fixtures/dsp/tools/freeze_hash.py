#!/usr/bin/env python3
"""Print the freeze values for the T04 protocol (AMENDMENTS-REV2 A9-04). Writes nothing.

The "protocol + criteria" freeze hash is the SHA-256 of two lines, one per frozen file:

    <sha256 of docs/evaluation/T04-protocol.md>  docs/evaluation/T04-protocol.md
    <sha256 of packages/phone-mic-meter/src/qualification.ts>  packages/phone-mic-meter/src/qualification.ts

(each line ends with a newline). The lead records the commit SHA and this hash in
.build/evidence.jsonl before the first trial. Run from anywhere inside the repository.
"""
import hashlib
import json
import os
import subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
FILES = ["docs/evaluation/T04-protocol.md", "packages/phone-mic-meter/src/qualification.ts"]


def sha256_file(path):
    with open(os.path.join(ROOT, path), "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


hashes = {f: sha256_file(f) for f in FILES}
combined = hashlib.sha256("".join(f"{hashes[f]}  {f}\n" for f in FILES).encode("utf-8")).hexdigest()
commit = subprocess.run(["git", "-C", ROOT, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
dirty = subprocess.run(["git", "-C", ROOT, "status", "--porcelain", "--"] + FILES, capture_output=True, text=True).stdout.strip()

for f in FILES:
    print(f"{hashes[f]}  {f}")
print(f"freeze hash (protocol + criteria): {combined}")
print(f"git HEAD: {commit}" + ("   WARNING: the frozen files have uncommitted changes" if dirty else ""))
print("evidence line template:")
print(json.dumps({"kind": "t04_freeze", "commit": commit, "protocol_sha256": hashes[FILES[0]], "criteria_sha256": hashes[FILES[1]], "freeze_hash": combined}))
