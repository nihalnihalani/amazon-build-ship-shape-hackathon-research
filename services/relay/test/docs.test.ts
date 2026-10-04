import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLOSE } from '../src/core/index.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string): string => readFileSync(`${repo}${p}`, 'utf8');

describe('operations documents stay consistent with the code', () => {
  it('COST.md embeds the exact output of docs/operations/cost-model.mjs', async () => {
    const mod = (await import(/* @vite-ignore */ `${repo}docs/operations/cost-model.mjs`)) as { report: () => string };
    const doc = read('docs/operations/COST.md');
    const block = /```\n(Per-session model[\s\S]*?)\n```/.exec(doc)?.[1];
    expect(block, 'COST.md has a fenced block starting with "Per-session model"').toBeDefined();
    expect(block).toBe(mod.report());
  });

  it('COST.md states the assumptions the model uses', async () => {
    const mod = (await import(/* @vite-ignore */ `${repo}docs/operations/cost-model.mjs`)) as {
      ASSUMPTIONS: Record<string, number>;
      PRICES: Record<string, number>;
    };
    const doc = read('docs/operations/COST.md');
    expect(mod.ASSUMPTIONS.levelHz).toBe(20);
    expect(mod.ASSUMPTIONS.controlMessages).toBe(150);
    expect(mod.ASSUMPTIONS.sessionMinutes).toBe(15);
    expect(mod.ASSUMPTIONS.lambdaSeconds).toBe(0.06);
    expect(doc).toContain('60 ms average at 512 MB');
    expect(doc).toContain('| 150 |');
    expect(doc).toContain('15 minutes');
    expect(doc).toContain('$1.00 per million');
    expect(doc).toContain('$0.25 per million');
    expect(doc).toContain('$0.20 per million');
    expect(doc).toContain('$0.0000166667 per GB-second');
    expect(doc).toContain('$0.625 per million WRU');
    expect(doc).toContain('$0.125 per million RRU');
    expect(mod.PRICES.apigwPerMillionMessages).toBe(1);
    // every price is marked for verification and the Mumbai region is called out
    expect(doc).toMatch(/to verify at deploy time/i);
    expect(doc).toContain('ap-south-1');
    for (const url of [
      'https://aws.amazon.com/api-gateway/pricing/',
      'https://aws.amazon.com/lambda/pricing/',
      'https://aws.amazon.com/dynamodb/pricing/on-demand/',
      'https://aws.amazon.com/cloudwatch/pricing/',
    ]) {
      expect(doc).toContain(url);
    }
    expect(doc).toMatch(/not a spending cap/i);
  });

  it('COST.md and the template agree on the stage throttle', () => {
    const doc = read('docs/operations/COST.md');
    const template = read('infra/template.yaml');
    expect(template).toMatch(/staging:\s+ThrottleRate: 60\s+ThrottleBurst: 120/);
    expect(template).toMatch(/prod:\s+ThrottleRate: 150\s+ThrottleBurst: 300/);
    expect(doc).toContain('60 per second (staging) or 150 per second (prod)');
  });

  it('SECURITY-NOTES.md lists every close code the relay uses', () => {
    const doc = read('docs/operations/SECURITY-NOTES.md');
    for (const code of Object.values(CLOSE)) {
      if (code === CLOSE.NORMAL) continue;
      expect(doc, `close code ${code}`).toContain(String(code));
    }
  });

  it('LOCAL_RELAY.md documents every environment variable the local server reads', () => {
    const config = read('services/relay/src/local/config.ts');
    const doc = read('docs/operations/LOCAL_RELAY.md');
    const vars = new Set([...config.matchAll(/env\.([A-Z_]+)/g)].map((m) => m[1] as string));
    expect(vars.size).toBeGreaterThanOrEqual(9);
    for (const v of vars) expect(doc, v).toContain(`\`${v}\``);
  });

  it('RUNBOOK.md covers every alarm in the template and the kill switch levers', () => {
    const runbook = read('docs/operations/RUNBOOK.md');
    const template = read('infra/template.yaml');
    const names = [...template.matchAll(/AlarmName: !Sub 'atr-relay-\$\{Stage\}-([a-z-]+)'/g)].map((m) => m[1] as string);
    expect(names.length).toBe(6);
    for (const n of names) expect(runbook, n).toContain(`\`${n}\``);
    expect(runbook).toContain('21 November 2026 01:30 IST');
    expect(runbook).toContain('put-function-concurrency');
    expect(runbook).toContain('RELAY_DISABLED');
    expect(runbook).toMatch(/not a cap/i);
  });

  it('infra/README.md names every template parameter and output', () => {
    const readme = read('infra/README.md');
    const template = read('infra/template.yaml');
    const params = [...template.matchAll(/\n {2}([A-Za-z]+):\n {4}Type: (?:String|Number)/g)].map((m) => m[1] as string);
    expect(params.length).toBe(7);
    for (const p of params) expect(readme, p).toContain(p);
    const outputs = template.slice(template.indexOf('\nOutputs:\n'));
    for (const m of outputs.matchAll(/\n {2}([A-Za-z]+):\n {4}Description:/g)) expect(readme, m[1]).toContain(m[1] as string);
    expect(readme).toContain('ap-south-1');
    expect(readme).toMatch(/never deployed/);
  });
});
