#!/usr/bin/env python3
"""Render the data sections of research/LAST30DAYS_IDEAS_AND_FEATURES.md from research/_working/last30days/*.json."""
import json,os,glob
B=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","last30days")
def esc(s,n=None):
    s=str(s).replace("|","\\|").replace("\n"," ")
    return s if not n or len(s)<=n else s[:n-1]+"…"
W={"tech":.25,"design":.2,"impact":.2,"originality":.2,"feasibility":.15}
passes=[json.load(open(f)) for f in sorted(glob.glob(B+"/l30d_*.json"))]
ideas=json.load(open(B+"/synth_new-ideas.json")); feats=json.load(open(B+"/synth_features.json")); rt=json.load(open(B+"/redteam.json"))
L=[]
L.append("## 3. Coverage by research pass\n")
L.append("| Pass | Topic sent to /last30days | YouTube | Web | Reddit, TikTok, Instagram, HN, Polymarket | Raw output |")
L.append("|---|---|---|---|---|---|")
for p in passes:
    other="; ".join(f"{k}: {esc(p['stats'][k],60)}" for k in ["reddit","tiktok","instagram","hn","polymarket"])
    L.append(f"| {esc(p['angle'].split(':')[0],40)} | {esc(p['topic_run'],90)} | {esc(p['stats']['youtube'],140)} | {esc(p['stats']['web'],140)} | {esc(other,220)} | `{os.path.basename(p['saved_file'])}` |")
L.append("\nEvery pass also reports its own coverage note; the short version is that social coverage was thin everywhere (§1).\n")
L.append("## 4. Findings by research pass\n")
L.append("Each finding is what one source said, as read by the research agent. Quotes are verbatim or marked as paraphrase by the agent. Engagement is as shown by the platform at retrieval on 4 Oct 2026.\n")
for p in passes:
    L.append(f"### 4.{passes.index(p)+1} {esc(p['angle'].split(':')[0],60)}\n")
    L.append("**Patterns:**\n"); L+=[f"- {esc(x)}" for x in p["key_patterns"]]
    L.append("\n| Platform | Source | Engagement | Date | Finding | Link |\n|---|---|---|---|---|---|")
    for x in p["findings"]:
        L.append(f"| {esc(x['platform'],30)} | {esc(x['source_name'],50)} | {esc(x['engagement'],40)} | {esc(x['date'],24)} | {esc(x['insight'],320)} | {x['url']} |")
    if p["complaints_and_frustrations"]:
        L.append("\n**Complaints and frustrations seen:** "+" · ".join(esc(c,220) for c in p["complaints_and_frustrations"][:6]))
    if p["competitors_or_entrants_seen"]:
        L.append("\n**Rivals or hackathon entrants seen:** "+" · ".join(esc(c,140) for c in p["competitors_or_entrants_seen"][:10]))
    L.append("")
L.append("## 5. New ideas and the red-team verdicts\n")
L.append("| Idea | Track | Proposed rough score | Red-team verdict | Revised score | Strongest threat |\n|---|---|---|---|---|---|")
vmap={v["id"]:v for v in rt["idea_verdicts"]}
for i in ideas["ideas"]:
    s=i["rough_scores"]; w=sum(W[k]*s[k] for k in W); v=vmap.get(i["id"],{}); rs=v.get("revised_scores",s); rw=sum(W[k]*rs[k] for k in W)
    L.append(f"| **{i['id']}** {esc(i['name'],90)} | {esc(i['track'],70)} | {w:.2f} | **{v.get('verdict','?')}** | {rw:.2f} | {esc(v.get('strongest_threat',''),260)} |")
L.append("")
for i in ideas["ideas"]:
    v=vmap.get(i["id"],{})
    L.append(f"### {i['id']}: {esc(i['name'])}\n")
    L.append(f"- **Pitch:** {esc(i['pitch'])}")
    L.append(f"- **User and workflow:** {esc(i['user'])} {esc(i['workflow'],600)}")
    L.append(f"- **Wow moment:** {esc(i['wow_moment'])}")
    L.append(f"- **Why it is not native or a latent LLM capability (proposer's claim):** {esc(i['why_not_native_or_latent_llm'],500)}")
    L.append(f"- **Research evidence cited:** "+" · ".join(esc(e,200) for e in i["research_evidence"]))
    L.append(f"- **Solo estimate:** about {i['solo_hours_estimate']} h (estimate). **Biggest risk:** {esc(i['biggest_risk'],300)}")
    L.append(f"- **Red-team reason for '{v.get('verdict','?')}':** {esc(v.get('reason',''),900)}\n")
L.append("## 6. Feature proposals and verdicts\n")
L.append("| Concept | Feature | Proposed tier | Red-team verdict | Hours (estimate) | Criterion helped | Reason |\n|---|---|---|---|---|---|---|")
fv={(f["concept"],f["name"]):f for f in rt["feature_verdicts"]}
for f in feats["features"]:
    v=fv.get((f["concept"],f["name"]))
    if not v:
        v=next((x for x in rt["feature_verdicts"] if x["concept"]==f["concept"] and x["name"][:30]==f["name"][:30]),{})
    L.append(f"| {f['concept']} | {esc(f['name'],90)} | {f['tier']} | **{v.get('verdict','?')}** | {v.get('adjusted_hours',f['hours_estimate'])} | {esc(f['judging_criterion_helped'],80)} | {esc(v.get('reason',''),420)} |")
L.append("\n### 6.1 Recommended bundles (as integrated into the specs)\n")
L.append("| Concept | Added hours (estimate) | Features | What is cut to make room |\n|---|---|---|---|")
for b in rt["recommended_feature_bundle"]:
    L.append(f"| {b['concept']} | +{b['total_added_hours']} | "+"<br>".join(esc(x,240) for x in b["features"])+f" | {esc(b['what_to_cut_to_make_room'],500)} |")
L.append("\n### 6.2 Feature details (as proposed; the red-team wording in §6 wins where they differ)\n")
for f in feats["features"]:
    L.append(f"- **{f['concept']} · {esc(f['name'])}** ({f['tier']}, about {f['hours_estimate']} h). {esc(f['what_it_does'],700)} *User value:* {esc(f['user_value'],300)} *Evidence:* "+" · ".join(esc(e,160) for e in f["research_evidence"]) )
L.append("\n## 7. Red-team caveats\n")
L+=[f"- {esc(c)}" for c in rt["caveats"]]
out="\n".join(L)
open(os.path.join(B,"body.md"),"w").write(out)
print("body lines",out.count("\n"))
