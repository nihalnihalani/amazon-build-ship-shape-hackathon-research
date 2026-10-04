#!/usr/bin/env python3
import re,os
R=os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)),"..",".."))
ORDER=[("FTV-4","Primary"),("FTV-3","Alternative 1"),("ALX-5","Alternative 2")]
def fix_links(t):
    def rl(m):
        tgt=m.group(1)
        if re.match(r'(https?:|#|mailto:)',tgt): return m.group(0)
        if tgt.startswith("../"): return "]("+tgt[3:]+")"
        return "](_working/"+tgt+")"
    return re.sub(r'\]\(([^)]+)\)',rl,t)
def demote(t,cid):
    out=[]; infence=False
    for line in t.split("\n"):
        if line.startswith("```"): infence=not infence
        if not infence and re.match(r'^#{1,5} ',line):
            line="#"+line
        out.append(line)
    return "\n".join(out)
_seen={}
def slug(h):
    s=h.strip().lower(); s=re.sub(r'[^\w\- ]','',s); s=s.replace(' ','-')
    n=_seen.get(s,0); _seen[s]=n+1
    return s if n==0 else f"{s}-{n}"
parts=[]; toc=[]
for cid,role in ORDER:
    t=open(f"{R}/_working/spec_{cid}.md",encoding="utf-8").read()
    t=fix_links(t); t=demote(t,cid)
    first=t.split("\n",1)[0]  # '## FTV-4: ...'
    title=first[3:]
    t=t.replace(first,f"## {role}: {title}",1)
    toc.append(f"- [{role}: {title}](#{slug(role+': '+title)})")
    for m in re.finditer(r'^### (.+)$',t,flags=re.M):
        toc.append(f"  - [{m.group(1)}](#{slug(m.group(1))})")
    parts.append(t)
pre='''# Top three build specifications: Build, Ship, Shape (Amazon Developer Hackathon 2026)

**Written:** Sunday 4 October 2026 (Asia/Kolkata). **Deadline:** Fri 23 Oct 2026 12:00 PDT = Sat 24 Oct 2026 00:30 IST.
**Status:** specifications only. Nothing here has been built, run, tested or measured. Every hour, latency and cost figure is an estimate; every "pass criterion" is a target. Functions that could not be confirmed in official documentation are marked **unverified**, and functions not available to hackathon entrants are marked **gated**. Each spec was checked by a separate verifier pass against saved official documentation.

| Role | Concept | Track | When it is built |
|---|---|---|---|
| **Primary** | FTV-4 Across the Room: the far-side check | Fire TV (React Native for Vega on the Vega Virtual Device) | Default from Mon 5 Oct 2026 |
| **Alternative 1** | FTV-3 Mail Check (core-first cut) | Fire TV | Two-person team, iPhone-only household, or the Android microphone test fails by Tue 6 Oct |
| **Alternative 2** | ALX-5 OutPass (single-household cut) | Alexa+ (self-hosted MCP 2025-11-25 plus a labelled, independently built simulator) | The Vega toolchain will not run on this Mac by Wed 7 Oct |
| **Fallback** | FTV-4F Listener Edition | Fire TV (same app as the primary) | Thu 8 Oct 2026 20:00 IST gate, if cross-session loudness cannot be trusted; described in the FTV-4 spec and in [RECOMMENDATION.md §5.4](RECOMMENDATION.md) |

Decision and rationale: [RECOMMENDATION.md](RECOMMENDATION.md). Scores and rejected concepts: [IDEA_SCORECARD.md](IDEA_SCORECARD.md). Calendar, budget, demo storyboard and submission checklist: [EXECUTION_AND_SUBMISSION.md](EXECUTION_AND_SUBMISSION.md). Rules: [HACKATHON_BRIEF.md](HACKATHON_BRIEF.md). Rivals: [TRENDS_AND_RIVALS.md](TRENDS_AND_RIVALS.md). Evidence: [EVIDENCE_REGISTER.json](EVIDENCE_REGISTER.json).

Each spec follows the same 13 sections: (1) user stories and acceptance criteria; (2) happy, ambiguous, failure and recovery paths; (3) screens and UI; (4) architecture, versions, hosting and local judging route; (5) API and event contract; (6) data entities, authorization, timestamps and deletion; (7) tool and operation design; (8) evaluation plan; (9) AWS design; (10) open-source contribution; (11) repository, environment, fixtures and README outline; (12) deliverables and estimated hours; (13) feature additions from the 4 Oct last-30-days pass ([LAST30DAYS_IDEAS_AND_FEATURES.md](LAST30DAYS_IDEAS_AND_FEATURES.md)), with the earlier sections it changes updated in place and marked "4 Oct". Each also has a track-specific verification block.

## Contents

'''
tail='''

---

### Rerun inputs

`workflow: firecrawl-deep-research (exhaustive) · topic: build specifications for FTV-4, FTV-3, ALX-5 · written and verified: 2026-10-04 · sources: research/_working/spec_*.md (editable originals), saved official docs under .firecrawl/ and .firecrawl/oct4/ · re-verify Vega SDK version, RN for Vega track, MCP spec acceptance and AWS regional availability before building`
'''
out=pre+"\n".join(toc)+"\n\n---\n\n"+"\n\n---\n\n".join(parts)+tail
open(f"{R}/TOP_THREE_BUILD_SPECS.md","w",encoding="utf-8").write(out)
print("lines",out.count("\n"))
