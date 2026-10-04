# Ideation raw outputs (machine-generated, 3–4 Oct 2026)

These JSON files are the raw outputs of the two ideation workflows and are the source for `research/IDEA_SCORECARD.md` and `research/RECOMMENDATION.md`. They are model-generated analyses; every score is an estimate under the user's analyst decision model (Tech 25 / Design 20 / Impact 20 / Originality 20 / Feasibility 15), not the official rubric.

| File | Contents |
|---|---|
| `round1_concepts_full.json` | The 12 round-1 concepts (3 Oct), three per track, full field set |
| `round1_gates.json` | Eligibility/feasibility gate results for the 12 |
| `round1_score_packs.json` | Three judge lenses (DevRel, engineer, product) scoring the 12 |
| `round1_redteam.json` | Four round-1 red-team verdicts (FTV-3, ALX-2, RNG-1, RNG-3) |
| `round1_summary.json` | Compact per-concept summary used as input to round 2 |
| `refresh_oct4.md` | Lead-session refresh facts established 4 Oct 02:40–02:45 IST |
| `round2_result.json` | Round 2 (4 Oct): refresh research (trends, rivals, GitHub, platform), 8 new concepts, gate, three judge packs over all 20, aggregated ranking, 18 red-team lens results, and the final selection |

Recovery note: the 3 Oct ideation workflow's final selection step did not complete; its agent outputs were recovered on 4 Oct from the session transcript directory and re-used as round-1 input.

## Helper scripts (`../tools/`)

| Script | Purpose |
|---|---|
| `gen_scorecard_body.py` | Renders IDEA_SCORECARD.md §2–§4 (per-concept sections and ranking tables) from the JSON in this folder |
| `assemble_specs.py` | Builds TOP_THREE_BUILD_SPECS.md from `_working/spec_FTV-4.md`, `spec_FTV-3.md`, `spec_ALX-5.md` |
| `merge_evidence.py` | Merges agent-produced claim arrays into EVIDENCE_REGISTER.json with URL+text de-duplication |
