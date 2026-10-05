from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
R = ROOT / 'research'
header = '''# Detailed category projects — 5 October 2026

Four alternatives, not four solo builds. Preferred conditional thesis: **Across the Room: Carryover Check**. Confirmed Mac-only alternative to qualify: **BorrowBridge**. This research pass did not qualify an application or customer/production claims; a separate active build is preserved and not certified here.

Read [the decision report](HACKATHON_REASSESSMENT_2026-10-05.md), [updated team prompt](OPUS_SONNET_REASSESSMENT_BUILD_PROMPT.md) and [task graph](REASSESSMENT_TASK_GRAPH.json).

Global corrections: Fire TV has **up to** three blind trials when the selected short session supplies them; never invent missing attempts. Speaker, listener and relative signal remain separate; known prompts bias listener reports. BorrowBridge atomicity is store-local; attach conditions to updates, and retain durable receipts beyond AWS ten-minute client-token idempotency. Ring privacy-zone exclusion and useful official-source variation must be proved. Bee requires genuine device data, local-only proxy and reconciliation of at-most-once streaming.

All applicable gates must pass. Diagrams illustrate flows; the JSON graph/evidence ledger governs readiness. Hours, sample targets and latency goals are proposals. Vendor pages establish advertised capabilities, not comparative effectiveness.

Each complete dossier includes alternatives, architecture, value/access gates, tests, demo, runtime/simulation boundaries and full sources.

'''
parts = []
for name in ['reassessment_firetv.md','reassessment_alexa.md','reassessment_ring_bee.md']:
    body = (R / '_working' / name).read_text()
    inside = False
    lines = []
    for line in body.splitlines():
        if line.startswith('```'): inside = not inside
        if not inside and line.startswith('#'): line = '#' + line
        lines.append(line)
    parts.append('\n'.join(lines))
(R / 'CATEGORY_PROJECTS_2026-10-05.md').write_text(header + '\n\n---\n\n'.join(parts) + '\n')
print('Category specification assembled:', len((R / 'CATEGORY_PROJECTS_2026-10-05.md').read_text().splitlines()), 'lines')

# Enrich evidence with verifiable local hashes and historical register counts.
import json, hashlib
from collections import Counter
ep = R / 'REASSESSMENT_EVIDENCE_2026-10-05.json'
e = json.loads(ep.read_text())
for item in e['sources'] + e['same_day_reused_sources'] + e['searches']:
    if not item.get('saved_file'): continue
    path = ROOT / item['saved_file']
    data = path.read_bytes()
    item['bytes'] = len(data)
    item['sha256'] = hashlib.sha256(data).hexdigest()
    if path.suffix == '.json':
        obj = json.loads(data)
        if item in e['sources']:
            assert obj.get('markdown'), path.name
            assert obj.get('metadata', {}).get('statusCode') == 200, path.name
            item['http_status_in_saved_capture'] = 200
        elif item in e['searches']:
            assert obj.get('success'), path.name
    elif item in e['sources']:
        assert len(data) > 300, path.name
        item['http_status_in_saved_capture'] = None
        item['status_note'] = 'Successful usable body inspected by collector; markdown file omits response metadata.'
old = json.loads((R / 'EVIDENCE_REGISTER.json').read_text())
e['coverage'].update({'historical_claim_count':len(old['claims']),
    'historical_source_record_count':len(old['sources_read']),
    'historical_search_record_count':len(old['searches_run']),
    'historical_verification_status':dict(Counter(c.get('verification_status') for c in old['claims'])),
    'historical_decision_critical':sum(bool(c.get('decision_critical')) for c in old['claims'])})
e['limits'] = [s.replace('hashes to be computed','SHA-256 hashes provided') for s in e['limits']]
ep.write_text(json.dumps(e,indent=2,ensure_ascii=False)+'\n')
gp = R / 'REASSESSMENT_TASK_GRAPH.json'
g = json.loads(gp.read_text())
by_id = {t['id']:t for t in g['tasks']}
for task_id, extra in [('F13','Minimum operating/rollback runbook prepared.'), ('A09','Minimum operating/rollback runbook prepared.'), ('C05','Minimum operating/rollback runbook independently verified.'), ('C06','Verify actual local or cloud route; cloud smoke applies only to claimed integrations.')]:
    if extra not in by_id[task_id]['acceptance']: by_id[task_id]['acceptance'] += ' ' + extra
by_id['C13']['depends_on'] = ['C12']
g['readiness_note'] = 'Public-production readiness is independent of hackathon form/video readiness; both remain required for full requested scope.'
g['mini_scope_note'] = 'C07 mandatory for chosen additional OSS scope; not universal primary-track eligibility.'
gp.write_text(json.dumps(g,indent=2,ensure_ascii=False)+'\n')
print(json.dumps(e['coverage'],indent=2))
