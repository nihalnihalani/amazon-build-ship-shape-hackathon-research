import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LIVE_ROOMS_INDEX } from '../src/aws/dynamo-store.js';
import { securityHeaders } from '../src/local/static.js';
import { ACCESS_LOG_WHITELIST, accessLogFormatViolations, cspViolations, iacViolations, resourceBlocks, roleStatements, templateCsp } from './helpers/iac-assertions.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const templatePath = join(repo, 'infra/template.yaml');
const template = readFileSync(templatePath, 'utf8');
const cfnLint = join(repo, 'services/relay/.venv/bin/cfn-lint');

const R = resourceBlocks(template);

describe('infra/template.yaml static guarantees (text checks; cfn-lint below does the real validation)', () => {
  it('defines the required resources and parameters', () => {
    for (const id of [
      'RelayTable', 'RelayFunction', 'RelayFunctionRole', 'RelayLogGroup', 'RelayApi', 'RelayIntegration', 'ConnectRoute',
      'DisconnectRoute', 'DefaultRoute', 'RelayStage', 'PhoneBucket', 'PhoneBucketPolicy', 'PhoneOriginAccessControl',
      'PhoneResponseHeadersPolicy', 'PhoneDistribution', 'AlarmTopic', 'AlarmEmailSubscription', 'LambdaErrorsAlarm',
      'LambdaThrottlesAlarm', 'LambdaConcurrencyAlarm', 'ApiIntegrationErrorAlarm', 'ApiExecutionErrorAlarm', 'MonthlyBudget',
      'JoinFailureBurstAlarm', 'AuthFailureBurstAlarm', 'CredentialReuseAlarm', 'RoomCapAlarm', 'DeadlineErrorsAlarm',
      'DeadlineQueueAgeAlarm', 'DeadlineDeadLetterAlarm', 'DeadlineFunction', 'DeadlineFunctionRole', 'DeadlineLogGroup',
      'DeadlineQueue', 'DeadlineDeadLetterQueue', 'DeadlineQueuePolicy',
    ]) {
      expect(R[id], id).toBeDefined();
    }
    for (const p of ['Stage', 'AllowedOrigins', 'TvPreviewOrigins', 'AlarmEmail', 'MonthlyBudgetUsd', 'ReservedConcurrency', 'LiveRoomCap', 'RelayDisabled']) {
      expect(template).toMatch(new RegExp(`\\n  ${p}:\\n    Type:`));
    }
    expect(template).not.toMatch(/\n  HashPepper:/); // no secret parameter: the secret is an SSM SecureString created out of band
    expect(template).toMatch(/AllowedValues: \[staging, prod\]/);
  });

  it('runs on nodejs24.x arm64 with 14-day logs and a PAY_PER_REQUEST table with TTL', () => {
    expect(R.RelayFunction).toMatch(/Runtime: nodejs24\.x/);
    expect(R.RelayFunction).toMatch(/Architectures: \[arm64\]/);
    expect(R.RelayFunction).toMatch(/Handler: relay\.handler/);
    expect(R.DeadlineFunction).toMatch(/Runtime: nodejs24\.x/);
    expect(R.DeadlineFunction).toMatch(/Architectures: \[arm64\]/);
    expect(R.DeadlineFunction).toMatch(/Handler: deadline\.handler/);
    expect(R.RelayLogGroup).toMatch(/RetentionInDays: 14/);
    expect(R.DeadlineLogGroup).toMatch(/RetentionInDays: 14/);
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
    expect(role).not.toMatch(/dynamodb:Scan|dynamodb:BatchWrite/);
    expect(role).toMatch(/Resource: !GetAtt RelayTable\.Arn/);
    // the one Query is on the sparse live-rooms index and nothing else
    const queries = roleStatements(role).filter((st) => st.actions.includes('dynamodb:Query'));
    expect(queries).toHaveLength(1);
    expect(queries[0]?.resources).toContain("${RelayTable.Arn}/index/live-rooms");
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
      "worker-src 'self';",
      "frame-ancestors 'none'",
    ]) {
      expect(h, part).toContain(part);
    }
    expect(h).not.toContain('blob:');
    expect(h).toMatch(/StrictTransportSecurity:/);
    expect(h).toMatch(/ContentTypeOptions:\s+Override: true/);
    expect(h).toMatch(/ReferrerPolicy: no-referrer/);
    expect(h).toMatch(/Header: Permissions-Policy\s+Value: microphone=\(self\)/);
    // the same directives appear in the local server
    const local = readFileSync(join(repo, 'services/relay/src/local/static.ts'), 'utf8');
    for (const part of ["default-src 'self'", "script-src 'self'", `"worker-src 'self'"`, "frame-ancestors 'none'", 'microphone=(self)', 'no-referrer', 'nosniff']) {
      expect(local, part).toContain(part);
    }
    expect(local).not.toContain('blob:');
  });

  it('the local server and the template send the same CSP except for the relay hosts in connect-src (T16 N-02)', () => {
    const tpl = templateCsp(template) as Record<string, string[]>;
    const header = securityHeaders({ tls: true, hstsMaxAgeSeconds: 300, connectOrigins: ['wss://phone.example.test'] })['Content-Security-Policy'] as string;
    const local: Record<string, string[]> = {};
    for (const part of header.split(';')) {
      const [name, ...sources] = part.trim().split(/\s+/);
      if (name) local[name] = sources;
    }
    expect(Object.keys(local).sort()).toEqual(Object.keys(tpl).sort());
    for (const name of Object.keys(tpl)) {
      if (name === 'connect-src') continue;
      expect(local[name], name).toEqual(tpl[name]);
    }
    expect(local['connect-src']).toEqual(["'self'", 'wss://phone.example.test']);
    expect(tpl['connect-src']).toEqual(["'self'", 'wss://${RelayApi}.execute-api.${AWS::Region}.${AWS::URLSuffix}']);
  });

  it('throttles the stage, wires every alarm to the SNS topic and creates a budget with notifications', () => {
    expect(R.RelayStage).toMatch(/ThrottlingRateLimit: !FindInMap/);
    expect(R.RelayStage).toMatch(/ThrottlingBurstLimit: !FindInMap/);
    const alarms = Object.keys(R).filter((id) => /Type: AWS::CloudWatch::Alarm/.test(R[id] as string));
    expect(alarms.sort()).toEqual([
      'ApiExecutionErrorAlarm', 'ApiIntegrationErrorAlarm', 'AuthFailureBurstAlarm', 'CredentialReuseAlarm', 'DeadlineDeadLetterAlarm',
      'DeadlineErrorsAlarm', 'DeadlineQueueAgeAlarm', 'JoinFailureBurstAlarm', 'LambdaConcurrencyAlarm', 'LambdaErrorsAlarm',
      'LambdaThrottlesAlarm', 'RoomCapAlarm',
    ]);
    for (const id of alarms) {
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
    expect(template).not.toMatch(/HashPepper|HASH_PEPPER|NoEcho/);
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

describe('IaC assertions: privacy, logging, secrets, IAM (A2-05, SEC-I01)', () => {
  it('the template has no violation', () => {
    expect(iacViolations(template)).toEqual([]);
  });

  const insertAfter = (anchor: string, text: string) => (t: string) => {
    expect(t, `anchor missing: ${anchor}`).toContain(anchor);
    return t.replace(anchor, `${anchor}${text}`);
  };
  const swap = (from: string, to: string, all = false) => (t: string) => {
    expect(t, `text missing: ${from}`).toContain(from);
    return all ? t.split(from).join(to) : t.replace(from, to);
  };
  const accessLog = (format: string) =>
    insertAfter('      DeploymentId: !Ref RelayDeployment\n', `      AccessLogSettings:\n        DestinationArn: !GetAtt RelayLogGroup.Arn\n        Format: '${format}'\n`);

  // Every guarantee is shown to fail: a checker that never fires proves nothing.
  const mutations: [string, (t: string) => string, string][] = [
    ['execution data tracing on', swap('DataTraceEnabled: false', 'DataTraceEnabled: true'), 'data-trace-on'],
    ['execution logging at INFO', swap("LoggingLevel: 'OFF'", 'LoggingLevel: INFO'), 'execution-logging-on'],
    ['execution logging at ERROR', swap("LoggingLevel: 'OFF'", "LoggingLevel: 'ERROR'"), 'execution-logging-on'],
    ['data trace setting dropped', swap('        DataTraceEnabled: false\n', ''), 'data-trace-not-explicitly-off:RelayStage'],
    ['logging level setting dropped', swap("        LoggingLevel: 'OFF'\n", ''), 'logging-level-not-explicitly-off:RelayStage'],
    [
      'access log with the source address and user agent',
      accessLog('{"ip":"$context.identity.sourceIp","ua":"$context.identity.userAgent","route":"$context.routeKey"}'),
      'access-log-field:$context.identity.sourceIp',
    ],
    ['access log with the connection id', accessLog('{"c":"$context.connectionId","s":"$context.status"}'), 'access-log-field:$context.connectionId'],
    ['access log with the request body', accessLog('{"body":"$input.body"}'), 'access-log-field:$input.body'],
    ['access log with an authorizer field', accessLog('{"a":"$context.authorizer.principalId"}'), 'access-log-field:$context.authorizer.principalId'],
    ['CloudFront standard logging', insertAfter('        PriceClass: PriceClass_All\n', '        Logging:\n          Bucket: logs.s3.amazonaws.com\n'), 'cloudfront-logging:PhoneDistribution'],
    ['S3 access logging', insertAfter('      VersioningConfiguration:\n        Status: Enabled\n', '      LoggingConfiguration:\n        DestinationBucketName: logs\n'), 's3-access-logging:PhoneBucket'],
    ['X-Ray active on the relay function', swap('Tracing: PassThrough', 'Tracing: Active'), 'xray-on'],
    ['X-Ray permission in a role', swap('Action: [logs:CreateLogStream, logs:PutLogEvents]', 'Action: [logs:CreateLogStream, logs:PutLogEvents, xray:PutTraceSegments]'), 'xray-resources-or-permissions'],
    ['tracing setting dropped', swap('      Tracing: PassThrough\n', ''), 'tracing-not-explicit:RelayFunction'],
    ['point-in-time recovery on', swap('PointInTimeRecoveryEnabled: false', 'PointInTimeRecoveryEnabled: true'), 'pitr-on:RelayTable'],
    ['point-in-time recovery undocumented', swap('Point-in-time recovery is deliberately OFF', 'PITR is off'), 'pitr-undocumented:RelayTable'],
    ['table encryption disabled', insertAfter('      BillingMode: PAY_PER_REQUEST\n', '      SSESpecification:\n        SSEEnabled: false\n'), 'table-encryption-disabled:RelayTable'],
    ['log retention of 30 days', swap('RetentionInDays: 14', 'RetentionInDays: 30'), 'log-retention-too-long:RelayLogGroup'],
    ['log retention of a year', swap("LogGroupName: !Sub '/aws/lambda/atr-relay-${Stage}-deadline'\n      RetentionInDays: 14", "LogGroupName: !Sub '/aws/lambda/atr-relay-${Stage}-deadline'\n      RetentionInDays: 365"), 'log-retention-too-long:DeadlineLogGroup'],
    ['log retention missing (never expire)', swap("LogGroupName: !Sub '/aws/lambda/atr-relay-${Stage}-deadline'\n      RetentionInDays: 14\n", "LogGroupName: !Sub '/aws/lambda/atr-relay-${Stage}-deadline'\n"), 'log-retention-missing:DeadlineLogGroup'],
    ['function writing to an unmanaged log group', swap('        LogGroup: !Ref DeadlineLogGroup\n', ''), 'function-log-group-not-managed:DeadlineFunction'],
    ['plain secret in the environment', swap('          LIVE_ROOM_CAP: !Ref LiveRoomCap\n', '          HASH_PEPPER: abc123abc123abc123\n'), 'secret-in-environment:RelayFunction:HASH_PEPPER'],
    ['secret value in HASH_SECRET_PARAM', swap("HASH_SECRET_PARAM: !Sub '/atr/relay/${Stage}/hash-secret'", 'HASH_SECRET_PARAM: hunter2hunter2'), 'secret-in-environment:RelayFunction:HASH_SECRET_PARAM'],
    ['a NoEcho secret parameter', swap('Parameters:\n  Stage:', 'Parameters:\n  Pepper:\n    Type: String\n    NoEcho: true\n  Stage:'), 'secret-parameter'],
    ['a dynamic reference to a secret', swap('          TV_PREVIEW_ORIGINS: !Ref TvPreviewOrigins\n', "          TV_PREVIEW_ORIGINS: '{{resolve:ssm-secure:/atr/relay/staging/hash-secret}}'\n"), 'dynamic-reference'],
    ['an account id in the template', swap('Description: >-\n  Across the Room relay', 'Description: >-\n  Account 123456789012 Across the Room relay'), 'credential-or-account-id'],
    ['Scan permission', swap('Action: [dynamodb:GetItem, dynamodb:PutItem, dynamodb:UpdateItem, dynamodb:DeleteItem]', 'Action: [dynamodb:GetItem, dynamodb:PutItem, dynamodb:UpdateItem, dynamodb:DeleteItem, dynamodb:Scan]'), 'iam-scan:RelayFunctionRole'],
    ['Query on the whole table', swap("Resource: !Sub '${RelayTable.Arn}/index/live-rooms'", 'Resource: !GetAtt RelayTable.Arn'), 'iam-query-not-on-index:RelayFunctionRole'],
    ['service wildcard action', swap('Action: sqs:SendMessage', 'Action: sqs:*'), 'iam-wildcard-action:RelayFunctionRole:QueueDeadlineChecks'],
    ['full wildcard action', swap('Action: ssm:GetParameter', "Action: '*'"), 'iam-wildcard-action:RelayFunctionRole:ReadTheHashSecretOnly'],
    ['wildcard resource', swap('                Resource: !GetAtt DeadlineQueue.Arn', "                Resource: '*'"), 'iam-wildcard-resource:RelayFunctionRole:QueueDeadlineChecks'],
    ['KMS permission in a function role', swap('Action: sqs:SendMessage', 'Action: [sqs:SendMessage, kms:Decrypt]'), 'iam-unexpected-service:RelayFunctionRole:kms:Decrypt'],
    ['SSM read of every parameter', swap("parameter/atr/relay/${Stage}/hash-secret'\n              - Sid: QueueDeadlineChecks", "parameter/atr/relay/*'\n              - Sid: QueueDeadlineChecks"), 'iam-ssm-not-exact:RelayFunctionRole'],
    ['SSM write permission', swap('Action: ssm:GetParameter', 'Action: [ssm:GetParameter, ssm:PutParameter]'), 'iam-ssm-beyond-get:RelayFunctionRole'],
    ['ManageConnections on every route', swap("${RelayApi}/${Stage}/POST/@connections/*", '${RelayApi}/*/*'), 'iam-manage-connections-too-broad:RelayFunctionRole'],
    ['unencrypted queue', swap('      SqsManagedSseEnabled: true\n', ''), 'queue-unencrypted:DeadlineDeadLetterQueue'],
    ['queue retention of 14 days', swap('MessageRetentionPeriod: 86400', 'MessageRetentionPeriod: 1209600'), 'queue-retention-unbounded:DeadlineDeadLetterQueue'],
    ['no TLS-only queue policy', swap("'aws:SecureTransport': 'false'", "'aws:SourceAccount': 'x'"), 'queue-tls-only-missing'],
    // the page CSP and the outputs the clients are configured from (T16 N-02, N-03)
    ['a bare wss: scheme in connect-src', swap("connect-src 'self' wss://${RelayApi}.execute-api.${AWS::Region}.${AWS::URLSuffix};", "connect-src 'self' wss:;"), 'csp-connect-wildcard'],
    ['a wildcard host in connect-src', swap("connect-src 'self' wss://${RelayApi}", "connect-src 'self' wss://*.execute-api.${AWS::Region}.${AWS::URLSuffix} wss://${RelayApi}"), 'csp-connect-wildcard'],
    ['the API host missing from connect-src', swap("connect-src 'self' wss://${RelayApi}.execute-api.${AWS::Region}.${AWS::URLSuffix};", "connect-src 'self';"), 'csp-connect-api-host-missing'],
    ['an extra origin in connect-src', swap("connect-src 'self' wss://${RelayApi}", "connect-src 'self' wss://evil.example.test wss://${RelayApi}"), 'csp-connect-extra-sources'],
    ['blob: in worker-src', swap("worker-src 'self';", "worker-src 'self' blob:;"), 'csp-worker-blob'],
    ['unsafe-inline in script-src', swap("script-src 'self';", "script-src 'self' 'unsafe-inline';"), 'csp-unsafe:script-src'],
    ['framing allowed', swap("frame-ancestors 'none';", "frame-ancestors 'self';"), 'csp-frame-ancestors'],
    ['the RelayWssUrl output dropped', swap('  RelayWssUrl:', '  RelayWssUrlRenamed:'), 'output-relay-wss-url'],
    ['the RelayWssUrl output without the stage', swap("Value: !Sub 'wss://${RelayApi}.execute-api.${AWS::Region}.${AWS::URLSuffix}/${Stage}'", "Value: !Sub 'wss://${RelayApi}.execute-api.${AWS::Region}.${AWS::URLSuffix}'"), 'output-relay-wss-url'],
    ['the PhonePageOrigin output with a path', swap("the relay allows to act as a phone.\n    Value: !Sub 'https://${PhoneDistribution.DomainName}'", "the relay allows to act as a phone.\n    Value: !Sub 'https://${PhoneDistribution.DomainName}/ws'"), 'output-phone-page-origin'],
  ];

  it.each(mutations)('detects: %s', (_name, mutate, expected) => {
    const broken = mutate(template);
    expect(broken).not.toBe(template);
    expect(iacViolations(broken)).toContain(expected);
  });

  it('does not over-fire: a whitelisted access-log format is accepted', () => {
    const fields = ACCESS_LOG_WHITELIST.map((f) => `"${f.slice(f.lastIndexOf('.') + 1)}":"${f}"`).join(',');
    const ok = accessLog(`{${fields}}`)(template);
    expect(ok).not.toBe(template);
    expect(iacViolations(ok)).toEqual([]);
  });

  it('the access-log checker rejects every address, agent, header, body and variable field', () => {
    for (const bad of [
      '$context.identity.sourceIp', '$context.identity.userAgent', '$context.identity.caller', '$context.connectionId',
      '$context.requestTime', '$context.domainName', '$context.apiId', '$context.authorizer.claims', '$context.error.message',
      '$input.body', '$input.params()', '$stageVariables.x', '$util.escapeJavaScript($input.body)',
    ]) {
      expect(accessLogFormatViolations(`{"x":"${bad}"}`), bad).not.toEqual([]);
    }
    for (const good of ACCESS_LOG_WHITELIST) expect(accessLogFormatViolations(`{"x":"${good}"}`), good).toEqual([]);
  });

  it('keeps the stage free of execution data and access logs, and says why', () => {
    const stage = R.RelayStage as string;
    expect(stage).toMatch(/DataTraceEnabled: false/);
    expect(stage).toMatch(/LoggingLevel: 'OFF'/);
    expect(stage).not.toMatch(/AccessLogSettings/);
    expect(stage).toMatch(/message\s+(#\s*)?bodies/);
    expect(R.PhoneDistribution).not.toMatch(/Logging:/);
    expect(R.PhoneBucket).not.toMatch(/LoggingConfiguration/);
  });

  it('documents why point-in-time recovery is off, next to the setting', () => {
    expect(R.RelayTable).toMatch(/PointInTimeRecoveryEnabled: false/);
    expect(R.RelayTable).toMatch(/Point-in-time recovery is deliberately OFF/);
    expect(R.RelayTable).toMatch(/35 days/);
  });

  it('bounds log retention to 14 days on every log group, one per function', () => {
    const groups = Object.keys(R).filter((id) => /Type: AWS::Logs::LogGroup/.test(R[id] as string));
    const fns = Object.keys(R).filter((id) => /Type: AWS::Serverless::Function/.test(R[id] as string));
    expect(groups.sort()).toEqual(['DeadlineLogGroup', 'RelayLogGroup']);
    expect(fns.sort()).toEqual(['DeadlineFunction', 'RelayFunction']);
    for (const g of groups) expect(Number(/RetentionInDays: (\d+)/.exec(R[g] as string)?.[1])).toBeLessThanOrEqual(14);
    expect(R.RelayFunction).toMatch(/LogGroup: !Ref RelayLogGroup/);
    expect(R.DeadlineFunction).toMatch(/LogGroup: !Ref DeadlineLogGroup/);
  });

  it('turns X-Ray off on both functions (PassThrough, never Active)', () => {
    for (const f of ['RelayFunction', 'DeadlineFunction']) expect(R[f]).toMatch(/Tracing: PassThrough/);
    expect(template).not.toMatch(/Tracing: Active|TracingEnabled: true|xray:/i);
  });

  it('passes no secret value anywhere: the hashing secret is only a parameter NAME, read from SSM at runtime', () => {
    for (const f of ['RelayFunction', 'DeadlineFunction']) {
      expect(R[f]).toMatch(/HASH_SECRET_PARAM: !Sub '\/atr\/relay\/\$\{Stage\}\/hash-secret'/);
      expect(R[f]).not.toMatch(/HASH_PEPPER|HASH_SECRET:|\{\{resolve:/);
    }
    expect(template).toMatch(/HashSecretParameterName:/);
    for (const role of ['RelayFunctionRole', 'DeadlineFunctionRole']) {
      const st = roleStatements(R[role] as string).filter((x) => x.actions.includes('ssm:GetParameter'));
      expect(st, role).toHaveLength(1);
      expect(st[0]?.actions).toEqual(['ssm:GetParameter']);
      expect(st[0]?.resources).toContain('parameter/atr/relay/${Stage}/hash-secret');
    }
  });

  it('reads production from the stage: ATR_ENV is production exactly when Stage is prod', () => {
    for (const f of ['RelayFunction', 'DeadlineFunction']) expect(R[f]).toMatch(/ATR_ENV: !If \[IsProd, production, staging\]/);
    expect(template).toMatch(/IsProd: !Equals \[!Ref Stage, prod\]/);
  });

  it('refuses a TV preview origin on prod and only lets https phone origins in through the parameters', () => {
    expect(template).toMatch(/Rules:\n {2}PreviewOriginsNeverInProduction:\n {4}RuleCondition: !Equals \[!Ref Stage, prod\]\n {4}Assertions:\n {6}- Assert: !Equals \[!Ref TvPreviewOrigins, ''\]/);
    const allowed = /AllowedOrigins:\n {4}Type: String\n {4}Default: ''\n {4}AllowedPattern: '([^']+)'/.exec(template)?.[1] as string;
    const re = new RegExp(allowed);
    expect(re.test('https://phone.example.test')).toBe(true);
    expect(re.test('https://a.example,https://b.example:8443')).toBe(true);
    expect(re.test('')).toBe(true);
    for (const bad of ['http://phone.example.test', '*', 'https://a.example/', 'https://a.example, https://b.example', 'https://a.example,http://b.example', 'phone.example.test']) {
      expect(re.test(bad), bad).toBe(false);
    }
    expect(R.RelayFunction).toMatch(/TV_PREVIEW_ORIGINS: !Ref TvPreviewOrigins/);
  });

  it('keeps the live-room cap parameter within the bounds the relay accepts', () => {
    expect(template).toMatch(/LiveRoomCap:\n {4}Type: Number\n {4}Default: 200\n {4}MinValue: 1\n {4}MaxValue: 100000/);
    expect(R.RelayFunction).toMatch(/LIVE_ROOM_CAP: !Ref LiveRoomCap/);
  });
});

describe('the template and the code agree (environment, index, queue, handlers)', () => {
  const read = (rel: string) => readFileSync(join(repo, rel), 'utf8');
  const configSrc = read('services/relay/src/aws/config.ts');
  const envBlock = (id: string) => /Variables:\n([\s\S]*?)\n {6}(?:Events|Tags):/.exec(R[id] as string)?.[1] ?? '';

  it('sets every environment variable the Lambda config reads, on both functions', () => {
    const read_ = [...configSrc.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1] as string);
    const names = [...new Set(read_)];
    expect(names.sort()).toEqual(
      ['ALLOWED_ORIGINS', 'ATR_ENV', 'DEADLINE_QUEUE_URL', 'HASH_SECRET_PARAM', 'LIVE_ROOM_CAP', 'RELAY_DISABLED', 'STAGE_NAME', 'TABLE_NAME', 'TV_PREVIEW_ORIGINS'].sort(),
    );
    for (const f of ['RelayFunction', 'DeadlineFunction']) {
      const block = envBlock(f);
      for (const n of names) expect(block, `${f} sets ${n}`).toMatch(new RegExp(`\\n? {10}${n}:`));
    }
  });

  it('sets nothing the code does not read (no stale variable such as the old pepper)', () => {
    for (const f of ['RelayFunction', 'DeadlineFunction']) {
      const set = [...envBlock(f).matchAll(/^ {10}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1] as string);
      for (const n of set) expect(configSrc, `${f} sets ${n}`).toContain(`env.${n}`);
    }
  });

  it('indexes live rooms exactly as the DynamoDB store does', () => {
    expect(LIVE_ROOMS_INDEX).toBe('live-rooms');
    const t = R.RelayTable as string;
    expect(t).toMatch(/IndexName: live-rooms/);
    expect(t).toMatch(/AttributeName: gsi1pk, KeyType: HASH/);
    expect(t).toMatch(/AttributeName: gsi1sk, KeyType: RANGE/);
    expect(t).toMatch(/AttributeName: gsi1pk, AttributeType: S/);
    expect(t).toMatch(/AttributeName: gsi1sk, AttributeType: N/);
    expect(t).toMatch(/ProjectionType: KEYS_ONLY/);
    const store = read('services/relay/src/aws/dynamo-store.ts');
    expect(store).toContain("item.gsi1pk = 'LIVE'");
    expect(store).toMatch(/IndexName: LIVE_ROOMS_INDEX/);
    expect(R.RelayFunctionRole).toContain("${RelayTable.Arn}/index/live-rooms");
  });

  it('wires the deadline queue as the relay expects: 5 s default delay, bounded retention, redrive, partial batch failures, capped concurrency', () => {
    const q = R.DeadlineQueue as string;
    expect(q).toMatch(/DelaySeconds: 5\b/);
    expect(q).toMatch(/MessageRetentionPeriod: 3600/);
    expect(q).toMatch(/VisibilityTimeout: 60/); // six times the 10 s consumer timeout
    expect(q).toMatch(/maxReceiveCount: 3/);
    expect(q).toMatch(/deadLetterTargetArn: !GetAtt DeadlineDeadLetterQueue\.Arn/);
    const fn = R.DeadlineFunction as string;
    expect(fn).toMatch(/Timeout: 10/);
    expect(fn).toMatch(/Type: SQS/);
    expect(fn).toMatch(/FunctionResponseTypes: \[ReportBatchItemFailures\]/);
    const conc = Number(/MaximumConcurrency: (\d+)/.exec(fn)?.[1]);
    expect(conc).toBeGreaterThanOrEqual(2); // the SQS event source minimum (cfn-lint does not check it)
    expect(conc).toBeLessThanOrEqual(10);
    expect(R.RelayFunction).toMatch(/DEADLINE_QUEUE_URL: !Ref DeadlineQueue/);
    expect(R.DeadlineFunction).toMatch(/DEADLINE_QUEUE_URL: !Ref DeadlineQueue/); // an expired join queues a follow-up check
  });

  it('gives each function role only the queue actions it needs', () => {
    const relay = roleStatements(R.RelayFunctionRole as string).flatMap((x) => x.actions).filter((a) => a.startsWith('sqs:'));
    expect(relay).toEqual(['sqs:SendMessage']);
    const deadline = roleStatements(R.DeadlineFunctionRole as string).flatMap((x) => x.actions).filter((a) => a.startsWith('sqs:'));
    expect(deadline.sort()).toEqual(['sqs:DeleteMessage', 'sqs:GetQueueAttributes', 'sqs:ReceiveMessage', 'sqs:SendMessage']);
    const dl = roleStatements(R.DeadlineFunctionRole as string).flatMap((x) => x.actions);
    expect(dl).not.toContain('dynamodb:Query'); // creating rooms (the cap) is the relay function's job
    expect(dl).not.toContain('dynamodb:Scan');
    expect(dl).toContain('execute-api:ManageConnections');
  });

  it('points both handlers at exports that exist in the bundle entries', () => {
    expect(read('services/relay/src/aws/lambda.ts')).toMatch(/export const handler/);
    expect(read('services/relay/src/aws/deadline-lambda.ts')).toMatch(/export const handler/);
    const bundle = read('services/relay/scripts/bundle-lambda.mjs');
    expect(bundle).toContain("relay: 'src/aws/lambda.ts'");
    expect(bundle).toContain("deadline: 'src/aws/deadline-lambda.ts'");
    expect(R.RelayFunction).toMatch(/CodeUri: \.\.\/services\/relay\/dist-lambda\//);
    expect(R.DeadlineFunction).toMatch(/CodeUri: \.\.\/services\/relay\/dist-lambda\//);
  });

  it('ships only what the code uses: no Scan call is reachable from either Lambda entry', () => {
    const runtimeSrc = read('services/relay/src/aws/runtime.ts') + read('services/relay/src/aws/handlers.ts');
    expect(runtimeSrc).not.toMatch(/onTick|listConnections|ScanCommand/);
  });
});

describe('IAM drafts cover what the template creates (and nothing is granted by service wildcard)', () => {
  const policy = JSON.parse(readFileSync(join(repo, 'infra/iam/cloudformation-execution-role-policy.json'), 'utf8')) as {
    Statement: { Sid: string; Action: string | string[]; Resource: string | string[]; Condition?: unknown }[];
  };
  const deployer = JSON.parse(readFileSync(join(repo, 'infra/iam/deployer-policy.json'), 'utf8')) as typeof policy;
  const actions = (p: typeof policy) => p.Statement.flatMap((x) => ([] as string[]).concat(x.Action));
  const byService = (p: typeof policy, svc: string) => actions(p).filter((a) => a.startsWith(`${svc}:`));

  it('lets the CloudFormation role manage every service the template uses', () => {
    const needs: Record<string, string> = {
      'AWS::DynamoDB::Table': 'dynamodb:CreateTable',
      'AWS::SQS::Queue': 'sqs:CreateQueue',
      'AWS::Serverless::Function': 'lambda:CreateFunction',
      'AWS::IAM::Role': 'iam:CreateRole',
      'AWS::Logs::LogGroup': 'logs:CreateLogGroup',
      'AWS::ApiGatewayV2::Api': 'apigateway:POST',
      'AWS::S3::Bucket': 's3:CreateBucket',
      'AWS::CloudFront::Distribution': 'cloudfront:CreateDistribution',
      'AWS::SNS::Topic': 'sns:CreateTopic',
      'AWS::CloudWatch::Alarm': 'cloudwatch:PutMetricAlarm',
      'AWS::Budgets::Budget': 'budgets:CreateBudget',
    };
    for (const [type, action] of Object.entries(needs)) {
      expect(template, type).toContain(`Type: ${type}`);
      expect(actions(policy), `${type} needs ${action}`).toContain(action);
    }
    // the SQS event source mapping of the deadline function
    for (const a of ['lambda:CreateEventSourceMapping', 'lambda:DeleteEventSourceMapping', 'lambda:UpdateEventSourceMapping', 'lambda:GetEventSourceMapping']) {
      expect(actions(policy)).toContain(a);
    }
    const mapping = policy.Statement.find((x) => x.Sid === 'SqsEventSourceOfTheDeadlineFunction');
    expect(JSON.stringify(mapping?.Condition)).toContain('function:atr-relay-*');
  });

  it('scopes the new grants by the atr-relay- prefix and never by a wildcard action', () => {
    const sqs = policy.Statement.find((x) => x.Sid === 'SqsDeadlineQueues');
    expect(sqs?.Resource).toBe('arn:aws:sqs:*:*:atr-relay-*');
    const dynamo = policy.Statement.find((x) => x.Sid === 'DynamoDbRelayTable');
    expect(dynamo?.Resource).toContain('arn:aws:dynamodb:*:*:table/atr-relay-*/index/*');
    for (const p of [policy, deployer]) {
      for (const a of actions(p)) expect(a.endsWith(':*') || a === '*', a).toBe(false);
    }
    expect(byService(policy, 'sqs')).not.toContain('sqs:SendMessage'); // the CloudFormation role provisions queues, it never uses them
  });

  it('lets the deployer create and rotate the hashing secret for this app only, and read nothing of it', () => {
    const ssm = deployer.Statement.find((x) => x.Sid === 'HashSecretParameter');
    expect(ssm?.Action).toEqual(['ssm:PutParameter']);
    expect(ssm?.Resource).toBe('arn:aws:ssm:*:*:parameter/atr/relay/*');
    expect(byService(deployer, 'ssm')).not.toContain('ssm:GetParameter');
    expect(byService(deployer, 'ssm')).not.toContain('ssm:GetParameters');
    expect(byService(deployer, 'ssm')).not.toContain('ssm:GetParametersByPath');
    expect(byService(deployer, 'kms')).toEqual([]);
  });

  it('lets the deployer inspect, purge and drain the deadline queues, and nothing else on SQS', () => {
    const sqs = deployer.Statement.find((x) => x.Sid === 'DeadlineQueueInspectionAndPurge');
    expect(sqs?.Resource).toBe('arn:aws:sqs:*:*:atr-relay-*');
    expect(byService(deployer, 'sqs').sort()).toEqual(['sqs:DeleteMessage', 'sqs:GetQueueAttributes', 'sqs:GetQueueUrl', 'sqs:PurgeQueue', 'sqs:ReceiveMessage']);
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
      // the new resources are linted for real too: a queue property that does not exist, a non-integer redrive count,
      // an index projection that is not allowed, and a Rule that names a parameter that does not exist
      for (const [from, to, expected] of [
        ['      DelaySeconds: 5\n', '      DelaySeconds: 5\n      NotAQueueProperty: 1\n', /NotAQueueProperty/],
        ['maxReceiveCount: 3', 'maxReceiveCount: three', /E3012/],
        ['ProjectionType: KEYS_ONLY', 'ProjectionType: EVERYTHING', /E3030|EVERYTHING/],
        ["Assert: !Equals [!Ref TvPreviewOrigins, '']", "Assert: !Equals [!Ref NoSuchParameter, '']", /NoSuchParameter/],
      ] as const) {
        expect(template).toContain(from);
        const f = join(dir, `bad-${expected.source.length}.yaml`);
        writeFileSync(f, template.replace(from, to));
        const r = lint(f);
        expect(r.status, from).not.toBe(0);
        expect(r.out, from).toMatch(expected);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
