import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const templatePath = join(repo, 'infra/template.yaml');
const template = readFileSync(templatePath, 'utf8');
const cfnLint = join(repo, 'services/relay/.venv/bin/cfn-lint');

/** Splits the Resources section into { LogicalId: text } using the two-space indentation of the template. */
function resources(): Record<string, string> {
  const start = template.indexOf('\nResources:\n');
  const end = template.indexOf('\nOutputs:\n');
  const body = template.slice(start + '\nResources:\n'.length, end);
  const out: Record<string, string> = {};
  let current = '';
  for (const line of body.split('\n')) {
    const m = /^ {2}([A-Za-z0-9]+):\s*$/.exec(line);
    if (m) {
      current = m[1] as string;
      out[current] = '';
    } else if (current) out[current] += `${line}\n`;
  }
  return out;
}
const R = resources();

describe('infra/template.yaml static guarantees (text checks; cfn-lint below does the real validation)', () => {
  it('defines the required resources and parameters', () => {
    for (const id of [
      'RelayTable', 'RelayFunction', 'RelayFunctionRole', 'RelayLogGroup', 'RelayApi', 'RelayIntegration', 'ConnectRoute',
      'DisconnectRoute', 'DefaultRoute', 'RelayStage', 'PhoneBucket', 'PhoneBucketPolicy', 'PhoneOriginAccessControl',
      'PhoneResponseHeadersPolicy', 'PhoneDistribution', 'AlarmTopic', 'AlarmEmailSubscription', 'LambdaErrorsAlarm',
      'LambdaThrottlesAlarm', 'LambdaConcurrencyAlarm', 'ApiIntegrationErrorAlarm', 'ApiExecutionErrorAlarm', 'MonthlyBudget',
    ]) {
      expect(R[id], id).toBeDefined();
    }
    for (const p of ['Stage', 'AllowedOrigins', 'AlarmEmail', 'MonthlyBudgetUsd', 'ReservedConcurrency', 'RelayDisabled', 'HashPepper']) {
      expect(template).toMatch(new RegExp(`\\n  ${p}:\\n    Type:`));
    }
    expect(template).toMatch(/AllowedValues: \[staging, prod\]/);
  });

  it('runs on nodejs24.x arm64 with 14-day logs and a PAY_PER_REQUEST table with TTL', () => {
    expect(R.RelayFunction).toMatch(/Runtime: nodejs24\.x/);
    expect(R.RelayFunction).toMatch(/Architectures: \[arm64\]/);
    expect(R.RelayFunction).toMatch(/Handler: relay\.handler/);
    expect(R.RelayLogGroup).toMatch(/RetentionInDays: 14/);
    expect(R.RelayTable).toMatch(/BillingMode: PAY_PER_REQUEST/);
    expect(R.RelayTable).toMatch(/AttributeName: expires_at\s+Enabled: true/);
    expect(R.RelayTable).toMatch(/AttributeName: pk, KeyType: HASH/);
    expect(R.RelayTable).toMatch(/AttributeName: sk, KeyType: RANGE/);
  });

  it('keeps the function role least-privilege: no wildcard actions, no wildcard resources', () => {
    const role = R.RelayFunctionRole as string;
    expect(role).not.toMatch(/Action:\s*['"]?\*/);
    expect(role).not.toMatch(/dynamodb:\*/);
    expect(role).not.toMatch(/Resource:\s*['"]?\*['"]?\s*$/m);
    expect(role).toMatch(/dynamodb:GetItem, dynamodb:PutItem, dynamodb:UpdateItem, dynamodb:DeleteItem/);
    expect(role).not.toMatch(/dynamodb:Scan|dynamodb:Query|dynamodb:BatchWrite/);
    expect(role).toMatch(/Resource: !GetAtt RelayTable\.Arn/);
    // ManageConnections only on this API, this stage, and only POST and DELETE
    expect(role).toContain("${RelayApi}/${Stage}/POST/@connections/*");
    expect(role).toContain("${RelayApi}/${Stage}/DELETE/@connections/*");
    expect(role).not.toMatch(/\/GET\/@connections/);
    expect(role).toContain("Resource: !Sub '${RelayLogGroup.Arn}:*'");
    expect(R.RelayFunction).toMatch(/Role: !GetAtt RelayFunctionRole\.Arn/);
  });

  it('keeps the S3 bucket private and reads it only through CloudFront OAC on the REST origin', () => {
    const b = R.PhoneBucket as string;
    for (const k of ['BlockPublicAcls', 'BlockPublicPolicy', 'IgnorePublicAcls', 'RestrictPublicBuckets']) {
      expect(b).toMatch(new RegExp(`${k}: true`));
    }
    expect(b).toMatch(/ObjectOwnership: BucketOwnerEnforced/);
    expect(b).toMatch(/SSEAlgorithm: AES256/);
    expect(b).toMatch(/Status: Enabled/);
    expect(template).not.toMatch(/WebsiteConfiguration|WebsiteURL|s3-website/);
    const p = R.PhoneBucketPolicy as string;
    expect(p).toMatch(/Service: cloudfront\.amazonaws\.com/);
    expect(p).toMatch(/Action: s3:GetObject/);
    expect(p).toContain("'AWS:SourceArn': !Sub 'arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${PhoneDistribution}'");
    expect(p).toMatch(/aws:SecureTransport/);
    expect(p).not.toMatch(/Principal: '\*'\s+Action: s3:GetObject/);
    expect(R.PhoneOriginAccessControl).toMatch(/SigningBehavior: always/);
    expect(R.PhoneOriginAccessControl).toMatch(/SigningProtocol: sigv4/);
    expect(R.PhoneOriginAccessControl).toMatch(/OriginAccessControlOriginType: s3/);
    const d = R.PhoneDistribution as string;
    expect(d).toMatch(/DomainName: !GetAtt PhoneBucket\.RegionalDomainName/);
    expect(d).toMatch(/OriginAccessControlId: !GetAtt PhoneOriginAccessControl\.Id/);
    expect(d).toMatch(/OriginAccessIdentity: ''/);
    expect(d).toMatch(/ViewerProtocolPolicy: redirect-to-https/);
    expect(d).toMatch(/ResponseHeadersPolicyId: !Ref PhoneResponseHeadersPolicy/);
  });

  it('serves the same security headers as the local relay server, with the relay wss origin', () => {
    const h = R.PhoneResponseHeadersPolicy as string;
    for (const part of [
      "default-src 'self'",
      "connect-src 'self' wss://${RelayApi}.execute-api.${AWS::Region}.${AWS::URLSuffix}",
      "script-src 'self'",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
    ]) {
      expect(h, part).toContain(part);
    }
    expect(h).toMatch(/StrictTransportSecurity:/);
    expect(h).toMatch(/ContentTypeOptions:\s+Override: true/);
    expect(h).toMatch(/ReferrerPolicy: no-referrer/);
    expect(h).toMatch(/Header: Permissions-Policy\s+Value: microphone=\(self\)/);
    // the same directives appear in the local server
    const local = readFileSync(join(repo, 'services/relay/src/local/static.ts'), 'utf8');
    for (const part of ["default-src 'self'", "script-src 'self'", "worker-src 'self' blob:", "frame-ancestors 'none'", 'microphone=(self)', 'no-referrer', 'nosniff']) {
      expect(local, part).toContain(part);
    }
  });

  it('throttles the stage, wires every alarm to the SNS topic and creates a budget with notifications', () => {
    expect(R.RelayStage).toMatch(/ThrottlingRateLimit: !FindInMap/);
    expect(R.RelayStage).toMatch(/ThrottlingBurstLimit: !FindInMap/);
    for (const id of ['LambdaErrorsAlarm', 'LambdaThrottlesAlarm', 'LambdaConcurrencyAlarm', 'ApiIntegrationErrorAlarm', 'ApiExecutionErrorAlarm', 'JoinFailureBurstAlarm']) {
      expect(R[id], id).toMatch(/AlarmActions: \[!Ref AlarmTopic\]/);
    }
    expect(R.ApiIntegrationErrorAlarm).toMatch(/MetricName: IntegrationError/);
    expect(R.ApiExecutionErrorAlarm).toMatch(/MetricName: ExecutionError/);
    expect(R.LambdaErrorsAlarm).toMatch(/MetricName: Errors/);
    expect(R.LambdaThrottlesAlarm).toMatch(/MetricName: Throttles/);
    expect(R.LambdaConcurrencyAlarm).toMatch(/ConcurrentExecutions/);
    expect(R.AlarmEmailSubscription).toMatch(/Protocol: email/);
    expect((R.MonthlyBudget as string).match(/NotificationType:/g)?.length).toBe(4);
    expect(R.MonthlyBudget).toMatch(/BudgetLimit:\s+Amount: !Ref MonthlyBudgetUsd/);
  });

  it('never hard-codes an account id, a region endpoint or a secret', () => {
    expect(template).not.toMatch(/\b\d{12}\b/);
    expect(template).not.toMatch(/execute-api\.(us|eu|ap|sa|ca|me|af)-[a-z]+-\d\.amazonaws/);
    expect(template).not.toMatch(/AKIA[0-9A-Z]{16}/);
    expect(template).toMatch(/HashPepper:\s+Type: String\s+NoEcho: true/);
  });

  it('keeps the IAM drafts valid, scoped by prefix, and free of account ids', () => {
    for (const f of ['deployer-policy.json', 'cloudformation-execution-role-policy.json', 'cloudformation-execution-role-trust.json']) {
      const text = readFileSync(join(repo, 'infra/iam', f), 'utf8');
      JSON.parse(text);
      expect(text, f).not.toMatch(/\b\d{12}\b/);
    }
    const deployer = JSON.parse(readFileSync(join(repo, 'infra/iam/deployer-policy.json'), 'utf8')) as { Statement: { Sid: string; Action: string | string[]; Resource: string | string[] }[] };
    for (const st of deployer.Statement) {
      const actions = ([] as string[]).concat(st.Action);
      expect(actions.every((a) => !a.endsWith(':*')), `${st.Sid} has a service wildcard`).toBe(true);
    }
    const sam = readFileSync(join(repo, 'infra/samconfig.toml.example'), 'utf8');
    expect(sam).not.toMatch(/\b\d{12}\b/);
    expect(sam).toContain('<ACCOUNT_ID>');
  });
});

describe.skipIf(!existsSync(cfnLint))('cfn-lint (venv at services/relay/.venv)', () => {
  const lint = (file: string): { status: number; out: string } => {
    const r = spawnSync(cfnLint, [file, '--regions', 'ap-south-1'], { encoding: 'utf8' });
    return { status: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
  };

  it('accepts the template (SAM transform included)', () => {
    const r = lint(templatePath);
    expect(r.out).toBe('');
    expect(r.status).toBe(0);
  });

  it('is not vacuous: it rejects a deprecated runtime and an unknown SAM property', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atr-lint-'));
    try {
      const bad1 = join(dir, 'bad1.yaml');
      writeFileSync(bad1, template.replace('Runtime: nodejs24.x', 'Runtime: nodejs12.x'));
      const r1 = lint(bad1);
      expect(r1.status).not.toBe(0);
      expect(r1.out).toMatch(/E2533|nodejs12/);
      const bad2 = join(dir, 'bad2.yaml');
      writeFileSync(bad2, template.replace('      AutoPublishAlias: live', '      AutoPublishAlias: live\n      NotARealSamProperty: true'));
      const r2 = lint(bad2);
      expect(r2.status).not.toBe(0);
      expect(r2.out).toMatch(/NotARealSamProperty/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
