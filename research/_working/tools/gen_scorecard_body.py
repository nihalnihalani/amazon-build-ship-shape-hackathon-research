#!/usr/bin/env python3
"""Deterministically render the per-concept sections and ranking tables for IDEA_SCORECARD.md from the ideation JSON."""
import json,os,sys
SP=os.path.dirname(os.path.abspath(__file__)); IDE=os.path.join(SP,"..","ideation")
r=json.load(open(IDE+"/round2_result.json"))
prior=json.load(open(IDE+"/round1_concepts_full.json"))
prior_rt=json.load(open(IDE+"/round1_redteam.json")); prior_gates={g["id"]:g for g in json.load(open(IDE+"/round1_gates.json"))}
prior_scores=json.load(open(IDE+"/round1_score_packs.json"))
W={"tech":0.25,"design":0.20,"impact":0.20,"originality":0.20,"feasibility":0.15}
allc={c["id"]:c for c in prior}; allc.update({c["id"]:c for c in r["newConcepts"]})
g2={g["id"]:g for g in r["gate2"]["gates"]}
agg={a["id"]:a for a in r["agg"]}
rs={x["id"]:x for x in r["redSummary"]}
packs=dict(zip(["devrel","engineer","product"],r["scorePacks"]))
def esc(s): return str(s).replace("|","\\|").replace("\n"," ")
def cell(s,n=600):
    s=esc(s); return s if len(s)<=n else s[:n-1]+"…"
def judge_rows(cid):
    out=[]
    for lab,p in packs.items():
        s=next((x for x in p["scores"] if x["id"]==cid),None)
        if not s: continue
        w=sum(W[k]*s[k]["score"] for k in W)
        out.append((lab,s,w))
    return out
TRACK_ORDER=["FTV","ALX","BEE","RNG"]; TRACK_NAME={"FTV":"Fire TV","ALX":"Alexa+","BEE":"Bee","RNG":"Ring"}
def concept_section(c, rnd):
    cid=c["id"]; g=g2.get(cid) or prior_gates.get(cid); a=agg.get(cid); L=[]
    L.append(f"### {cid}: {esc(c['name'])}\n")
    L.append(f"**Round:** {rnd}. **Track:** {esc(c['track'])}\n")
    L.append(f"**Pitch:** {esc(c['pitch'])}\n")
    L.append("| Field | Content |\n|---|---|")
    for k,lab in [("primary_user","Primary user"),("problem_frequency","Frequency"),("problem_severity","Severity"),("current_workaround","Current workaround"),("amazon_role","Amazon integration and its indispensable role"),("removal_test","Removal test (honest)"),("wow_moment_45s","Wow moment under 45 s"),("original_mechanism","Original mechanism"),("data_route","Simulator or real-data route (data route)"),("auth","Authentication"),("preview_constraints","Preview constraints"),("hardware","Hardware"),("sdk_versions","SDK versions"),("deployment_prereqs","Deployment prerequisites"),("firecrawl_research_role","Firecrawl: research role"),("firecrawl_runtime_role","Firecrawl: runtime role"),("aws_builder_path","AWS Builder path"),("open_source_path","Open Source path"),("fallback","Fallback"),("falsification_test","Falsification test (≤1 day)"),("risk_profile","Risk profile")]:
        if k in c: L.append(f"| {lab} | {cell(c[k],900)} |")
    if "distinct_from_round1_because" in c: L.append(f"| Distinct from round 1 because | {cell(c['distinct_from_round1_because'],600)} |")
    e=c["estimate"]; L.append(f"| Estimate (unmeasured) | Solo {e['hours_solo']} h; two-person {e['hours_duo']} h per person; cloud {esc(e['cloud_cost_usd'])}. Assumptions: {cell(e['assumptions'],500)} |")
    L.append("")
    L.append("**Demand evidence** (quality labelled by the researcher):\n")
    for d in c["demand_evidence"]: L.append(f"- {esc(d['claim'])} — [{esc(d['url'])}]({d['url']}) — *{esc(d['quality'])}*")
    L.append("\n**Rivals named at generation** (strongest feature; our difference; evidence status):\n")
    L.append("| Rival | Strongest feature | Our difference | Evidence status |\n|---|---|---|---|")
    for x in c["rivals"]: L.append(f"| [{esc(x['name'])}]({x['url']}) | {cell(x['strongest_feature'],350)} | {cell(x['our_difference'],350)} | {cell(x['evidence_status'],200)} |")
    L.append("\n**Smallest credible MVP:**\n"); L+= [f"- {esc(m)}" for m in c["mvp_scope"]]
    L.append("\n**Deliberately excluded stretch:**\n"); L+= [f"- {esc(m)}" for m in c["excluded_stretch"]]
    L.append("\n**APIs, events and actions** (status as assessed by the researcher; 'unverified' means not confirmed in reviewed docs, 'gated' means not available to entrants, 'simulated' means not real in the demo):\n")
    L.append("| Status | API / event / action | Documentation |\n|---|---|---|")
    for x in c["apis_events_actions"]: L.append(f"| {x['status']} | {cell(x['name'],250)} | {x['doc_url']} |")
    L.append("\n**Blockers:** "+"; ".join(esc(b) for b in c["blockers"]))
    L.append("\n**Reasons judges might reject it:** "+"; ".join(esc(b) for b in c["judge_rejection_risks"]))
    if g:
        L.append(f"\n**Gate result:** overall **{g['overall']}** (eligibility {g['eligibility']}, feasibility {g['feasibility']}; native overlap {g['native_overlap']}, visible crowding {g['crowding']}).\n")
        L.append(f"- Eligibility: {cell(g['eligibility_reasons'],700)}")
        L.append(f"- Feasibility: {cell(g['feasibility_reasons'],700)}")
        if g["conditions"]: L.append("- Conditions: "+" ".join(f"({i+1}) {esc(x)}" for i,x in enumerate(g["conditions"])))
        L.append(f"- Native overlap: {cell(g['native_overlap_notes'],500)}")
        L.append(f"- Crowding: {cell(g['crowding_notes'],500)}")
        L.append(f"- Day-one proof: {esc(g['day_one_proof'])}")
        if g.get("redesign_to_pass"): L.append(f"- Redesign to pass: {cell(g['redesign_to_pass'],500)}")
    jr=judge_rows(cid)
    if jr:
        L.append("\n**Round-2 judge ratings (1–5; base case: solo, India, VVD on Mac, no Bee hardware, no US Ring device). Weighted = 0.25·Tech + 0.20·Design + 0.20·Impact + 0.20·Originality + 0.15·Feasibility.**\n")
        L.append("| Judge lens | Tech | Design | Impact | Originality | Feasibility | Weighted | Confidence | One-line verdict |\n|---|---|---|---|---|---|---|---|---|")
        for lab,s,w in jr:
            L.append(f"| {lab} | {s['tech']['score']} | {s['design']['score']} | {s['impact']['score']} | {s['originality']['score']} | {s['feasibility']['score']} | {w:.2f} | {s['confidence']} | {cell(s['one_line_verdict'],300)} |")
        if a and not a.get("missing"):
            m=a["means"]; L.append(f"| **Mean of three** | {m['tech']:.2f} | {m['design']:.2f} | {m['impact']:.2f} | {m['originality']:.2f} | {m['feasibility']:.2f} | **{a['weighted']:.2f}** | | Scenario weighted: solo+hw {a['solo_with_hw']:.2f}; duo {a['duo_no_hw']:.2f}; duo+hw {a['duo_with_hw']:.2f} |")
        L.append("\n**Why each judge rated it that way (verbatim rationale, one per criterion):**\n")
        for lab,s,w in jr:
            L.append(f"- *{lab}* — Tech: {cell(s['tech']['why'],420)} — Design: {cell(s['design']['why'],420)} — Impact: {cell(s['impact']['why'],420)} — Originality: {cell(s['originality']['why'],420)} — Feasibility: {cell(s['feasibility']['why'],420)}")
            L.append(f"  - Scenario adjustments: solo+hw tech {s['solo_with_hw']['tech']}, feasibility {s['solo_with_hw']['feasibility']} ({cell(s['solo_with_hw']['note'],220)}); duo tech {s['duo_no_hw']['tech']}, feasibility {s['duo_no_hw']['feasibility']} ({cell(s['duo_no_hw']['note'],220)}); duo+hw tech {s['duo_with_hw']['tech']}, feasibility {s['duo_with_hw']['feasibility']} ({cell(s['duo_with_hw']['note'],220)})")
    # round-1 judges (for the 12)
    if cid in prior_scores.get("devrel",{}) if isinstance(prior_scores.get("devrel"),dict) else False: pass
    r1=[]
    for lab,p in prior_scores.items():
        s=next((x for x in p if x["id"]==cid),None)
        if s: r1.append((lab,s,sum(W[k]*s[k]["score"] for k in W)))
    if r1:
        L.append("\n**Round-1 judge ratings (3 Oct, same model; shown for traceability):** "+"; ".join(f"{lab} {s['tech']['score']}/{s['design']['score']}/{s['impact']['score']}/{s['originality']['score']}/{s['feasibility']['score']} = {w:.2f}" for lab,s,w in r1))
    # red team
    rts=[]
    if cid in prior_rt:
        x=prior_rt[cid]; rts.append(("Round 1 (single reviewer)",x["verdict"],x["strongest_rival_threat"]["rival"],x["strongest_rival_threat"]["url"],x["redesign"],x["revised_scores"],x.get("differentiation_holds","")))
    for x in r["redteam"]:
        if x["id"]==cid: rts.append((f"Round 2, lens: {x['lens'][:60]}",x["verdict"],x["strongest_threat"]["name"],x["strongest_threat"]["url"],x["redesign"],x["revised_scores"],x["what_survives"]))
    if rts:
        L.append("\n**Red-team verdicts:**\n")
        L.append("| Pass | Verdict | Strongest threat | Revised T/D/I/O/F | What survives | Redesign |\n|---|---|---|---|---|---|")
        for pname,v,th,url,red,rev,surv in rts:
            L.append(f"| {esc(pname)} | **{v}** | [{cell(th,120)}]({url}) | {rev['tech']}/{rev['design']}/{rev['impact']}/{rev['originality']}/{rev['feasibility']} | {cell(surv,420)} | {cell(red,520)} |")
        if cid in rs:
            x=rs[cid]; rv=x["revised_means"]
            L.append(f"\nRound-2 red-team summary: **{x['status']}** ({x['kills']} kill verdicts of {x['lenses']} lenses; a concept is killed at two or more). Revised means T {rv['tech']:.2f} / D {rv['design']:.2f} / I {rv['impact']:.2f} / O {rv['originality']:.2f} / F {rv['feasibility']:.2f} → revised weighted **{x['revised_weighted']:.2f}**.")
    else:
        L.append("\n**Red-team verdicts:** not red-teamed (did not reach the top of either round's ranking); ranking rests on gate and judge scores alone.")
    L.append("\n---\n")
    return "\n".join(L)
out=[]
out.append("<!-- GENERATED BODY: rendered deterministically from research/_working/ideation/*.json by gen_scorecard_body.py on 2026-10-04. Do not hand-edit numbers here; edit the JSON and regenerate. -->\n")
for rnd,ids in [(1,[c["id"] for c in prior]),(2,[c["id"] for c in r["newConcepts"]])]:
    out.append(f"\n## {'2' if rnd==1 else '3'}. {'The 12 canonical round-1 concepts (three per track)' if rnd==1 else 'The 8 round-2 concepts (two per track, generated after the round-1 red teams)'}\n")
    for t in TRACK_ORDER:
        tids=[i for i in ids if i.startswith(t)]
        if not tids: continue
        out.append(f"\n### Track: {TRACK_NAME[t]}\n")
        for i in tids: out.append(concept_section(allc[i],rnd).replace("### "+i,"#### "+i,1))
# ranking tables
def scen_tf(cid,key):
    if key=="weighted": a=agg[cid]; return a["means"]["tech"],a["means"]["feasibility"]
    rows=[next((x for x in p["scores"] if x["id"]==cid),None) for p in packs.values()]; rows=[x for x in rows if x]
    return sum(x[key]["tech"] for x in rows)/len(rows), sum(x[key]["feasibility"] for x in rows)/len(rows)
def table(key,title):
    rows=sorted([a for a in r["agg"] if not a.get("missing")],key=lambda a:-a[key])
    lab="" if key=="weighted" else " (scenario-adjusted)"
    L=[f"\n### {title}\n",f"| Rank | Concept | Weighted | Tech{lab} | Design | Impact | Originality | Feasibility{lab} | Gate | Round-2 red team |","|---|---|---|---|---|---|---|---|---|---|"]
    for i,a in enumerate(rows,1):
        m=dict(a["means"]); m["tech"],m["feasibility"]=scen_tf(a["id"],key); g=(g2.get(a["id"]) or prior_gates.get(a["id"]) or {}).get("overall","?")
        rt=rs.get(a["id"],{}).get("status","not red-teamed") if a["id"] in rs else ("round-1 red team only: "+prior_rt[a["id"]]["verdict"] if a["id"] in prior_rt else "not red-teamed")
        L.append(f"| {i} | {a['id']} {esc(a['name'])[:60]} | **{a[key]:.2f}** | {m['tech']:.2f} | {m['design']:.2f} | {m['impact']:.2f} | {m['originality']:.2f} | {m['feasibility']:.2f} | {g} | {rt} |")
    return "\n".join(L)
out.append("\n## 4. Ranking tables (three-judge means, analyst weights; all figures are estimates)\n")
out.append("Base scenario = solo developer in India, Apple-silicon Mac with the Vega Virtual Device, no Bee device or Apple Watch, no US Ring device. Scenario columns re-weight only Tech and Feasibility using each judge's adjusted scores for that scenario; Design, Impact and Originality are held at the base means.")
out.append(table("weighted","4.1 Base scenario: solo, no extra hardware"))
out.append(table("solo_with_hw","4.2 Solo with hardware (Fire TV Stick 4K Select; iPhone + Apple Watch running Bee; Ring still Playground)"))
out.append(table("duo_no_hw","4.3 Two-person team, no extra hardware"))
out.append(table("duo_with_hw","4.4 Two-person team with hardware"))
out.append("\n### 4.5 Red-team revised scores versus judge means (round 2; six concepts reached the red team)\n")
out.append("| Concept | Judge weighted (base) | Red-team revised weighted (mean of 3 lenses) | Kill verdicts | Status | Lens verdicts |\n|---|---|---|---|---|---|")
for x in sorted(r["redSummary"],key=lambda x:-x["revised_weighted"]):
    a=agg[x["id"]]; lv="; ".join(f"{k[:28]}: {v}" for k,v in x["lens_verdicts"].items())
    out.append(f"| {x['id']} {esc(x['name'])[:50]} | {a['weighted']:.2f} | **{x['revised_weighted']:.2f}** | {x['kills']} of {x['lenses']} | {x['status']} | {esc(lv)} |")
out.append("\nRound-1 red team (3 Oct, single reviewer each): FTV-3 survives_with_redesign (revised 3.5/3.5/3.5/3/3 → 3.35); ALX-2 killed (3.5/3/2/1.5/4 → 2.78); RNG-1 survives_with_redesign (3/3/2.5/3/3 → 2.90); RNG-3 survives_with_redesign (2.5/3/2.5/3.5/4 → 3.03).")
open(IDE+"/scorecard_body.md","w").write("\n".join(out))
print("Full untruncated rationale lives in research/_working/ideation/*.json.")
print("lines:",sum(1 for _ in open(IDE+"/scorecard_body.md")), "bytes:",os.path.getsize(IDE+"/scorecard_body.md"))
