from pathlib import Path
import json, hashlib, re
ROOT = Path(__file__).resolve().parents[3]
R = ROOT / 'research'
e = json.loads((R / 'REASSESSMENT_EVIDENCE_2026-10-05.json').read_text())
g = json.loads((R / 'REASSESSMENT_TASK_GRAPH.json').read_text())
ids = {t['id'] for t in g['tasks']}
assert len(ids) == len(g['tasks']) == 35
by_id = {t['id']:t for t in g['tasks']}
seen, active, order = set(), set(), []
def visit(i):
    assert i not in active, ('dependency cycle', i)
    if i in seen: return
    active.add(i)
    for d in by_id[i]['depends_on']:
        assert d in ids, ('missing dependency', i, d)
        visit(d)
    active.remove(i)
    seen.add(i)
    order.append(i)
for i in ids: visit(i)
assert all(t['status']=='pending' and not t['evidence'] for t in g['tasks'])
assert by_id['C13']['depends_on'] == ['C12']
assert 'dependency_policy' in by_id['C05']
for track, endpoint in [('firetv','F13'),('alexa','A09')]:
    subset = {t['id'] for t in g['tasks'] if t['track'] in ['common',track]}
    join = [d for d in by_id['C05']['depends_on'] if d in subset]
    assert join == [endpoint], (track,join)
    for t in g['tasks']:
        if t['id'] not in subset or t['id']=='C05': continue
        assert all(d in subset for d in t['depends_on']), ('cross-branch dependency',track,t['id'])
def ancestors(i):
    result = set()
    for d in by_id[i]['depends_on']:
        result.add(d); result.update(ancestors(d))
    return result
for i in ['F06','F07','F08']:
    assert {'F01','F02','F04'} <= ancestors(i)
for i in ['A04','A05','A06']:
    assert {'A01','A02'} <= ancestors(i)
for item in e['sources']+e['same_day_reused_sources']+e['searches']:
    if not item.get('saved_file'): continue
    p = ROOT / item['saved_file']
    assert p.is_file(), str(p)
    assert hashlib.sha256(p.read_bytes()).hexdigest() == item['sha256'], p.name
assert len(e['sources'])==40 and len({x['url'] for x in e['sources']})==40
assert len(e['same_day_reused_sources'])==18
assert sum(bool(x['saved_file']) for x in e['searches'])==20
source_ids = {s['id'] for s in e['sources']}
assert all(set(c['source_ids']) <= source_ids for c in e['critical_claims'])
files = [ROOT/'README.md'] + [R/n for n in ['HACKATHON_REASSESSMENT_2026-10-05.md','CATEGORY_PROJECTS_2026-10-05.md','OPUS_SONNET_REASSESSMENT_BUILD_PROMPT.md','REASSESSMENT_BUILD_GRAPH.md']]
broken=[]
for p in files:
    text=p.read_text()
    assert text.count('```') % 2 == 0, ('unbalanced code fence',p.name)
    for target in re.findall(r'\[[^\]]+\]\(([^)]+)\)',text):
        if target.startswith(('https:','http:','mailto:','#')): continue
        target=target.split('#')[0]
        if not target: continue
        if not (p.parent/target).exists(): broken.append((p.name,target))
assert not broken, broken
for id in ['FTV','ALX','BEE','RNG']:
    text=(R/'HACKATHON_REASSESSMENT_2026-10-05.md').read_text()
    assert all(f'| {id}-{i} |' in text for i in range(1,6))
print(json.dumps({'graph_tasks':35,'dependency_edges':sum(len(t['depends_on']) for t in g['tasks']), 'acyclic':True, 'branch_join':True,'full_build_after_fatal_gates':True, 'verified_capture_hashes':58,'saved_search_hashes':20,'all_20_ideas_present':True,'broken_local_links':len(broken),'application_tests_executed':False},indent=2))
