#!/usr/bin/env python3
"""Merge new evidence claims (from workflow agent outputs) into research/EVIDENCE_REGISTER.json.
Usage: python3 merge_evidence.py <register.json> <claims.json> [<claims.json> ...]
Each claims file is either a list of claim dicts or an object with a 'new_claims' list (or nested under any key).
Dedupe key: (url, normalized claim text). Adds research_pass='2026-10-04 round 2', verification_status default 'single_researcher'.
"""
import json,sys,re,datetime
reg_path=sys.argv[1]; files=sys.argv[2:]
reg=json.load(open(reg_path,encoding="utf-8"))
existing={(c.get("url","").strip().rstrip("/"), re.sub(r"\W+"," ",c.get("claim","")).strip().lower()[:160]) for c in reg["claims"]}
ids={c["claim_id"] for c in reg["claims"]}
srcs={s.get("url","").strip().rstrip("/") for s in reg["sources_read"] if isinstance(s,dict)} | {s for s in reg["sources_read"] if isinstance(s,str)}
def walk(o):
    if isinstance(o,dict):
        if "new_claims" in o and isinstance(o["new_claims"],list):
            for c in o["new_claims"]: yield c
        for v in o.values(): yield from walk(v)
    elif isinstance(o,list):
        for v in o:
            if isinstance(v,dict) and "claim_id" in v and "url" in v and "claim" in v: yield v
            else: yield from walk(v)
added=0; dup=0; bad=0
REQ=["claim_id","claim","url","publisher","source_type","publication_or_update_date","retrieved_at","relevant_excerpt_or_section","confidence","limitation","affected_project"]
for f in files:
    try: data=json.load(open(f,encoding="utf-8"))
    except Exception as e: print("skip",f,e); continue
    for c in walk(data):
        if not all(k in c for k in ["claim_id","claim","url"]): bad+=1; continue
        key=(c["url"].strip().rstrip("/"), re.sub(r"\W+"," ",c["claim"]).strip().lower()[:160])
        if key in existing: dup+=1; continue
        cid=c["claim_id"]; n=2
        while cid in ids: cid=f"{c['claim_id']}-{n}"; n+=1
        row={k:c.get(k,"") for k in REQ}; row["claim_id"]=cid
        row["research_pass"]="2026-10-04 round 2"; row["verification_status"]=c.get("verification_status","single_researcher")
        row["source_file"]=f.split("/")[-1]
        reg["claims"].append(row); existing.add(key); ids.add(cid); added+=1
        u=c["url"].strip().rstrip("/")
        if u and u not in srcs:
            reg["sources_read"].append({"url":u,"publisher":c.get("publisher",""),"source_type":c.get("source_type",""),"retrieved_at":c.get("retrieved_at",""),"research_pass":"2026-10-04 round 2"}); srcs.add(u)
reg["metadata"]["counts"]={"claims":len(reg["claims"]),"unique_sources_read":len(reg["sources_read"]),"searches_run":len(reg["searches_run"])}
reg["metadata"]["generated_at"]="2026-10-03 (Asia/Kolkata); merged with 2026-10-04 round-2 claims"
reg["metadata"]["research_as_of"]="2026-10-04"
json.dump(reg,open(reg_path,"w",encoding="utf-8"),indent=1,ensure_ascii=False)
print(f"added {added}, duplicates {dup}, malformed {bad}; totals: claims {len(reg['claims'])}, sources {len(reg['sources_read'])}")
