/**
 * SEC-I01 / A2-05: assertions over infra/template.yaml as a pure function of the template text, so that the same
 * checker can be run on the real template (must return no violation) and on deliberately broken copies (must return
 * the specific violation). A checker that was never shown to fail proves nothing.
 *
 * The template is YAML with CloudFormation tags, so these are structural text checks over the resource blocks (the
 * two-space indentation of the template), not a YAML parse. cfn-lint (infra.test.ts) validates the schema.
 */

/** `$context` fields an API Gateway access-log format may contain: ids, route, event type, status and latencies only. */
export const ACCESS_LOG_WHITELIST = [
  '$context.requestId',
  '$context.routeKey',
  '$context.eventType',
  '$context.status',
  '$context.integrationStatus',
  '$context.integrationLatency',
  '$context.responseLatency',
  '$context.requestTimeEpoch',
] as const;

/** Returns the violations of one access-log format string (empty when it is within the whitelist). */
export function accessLogFormatViolations(format: string): string[] {
  const out: string[] = [];
  const tokens = format.match(/\$(?:context|input|stageVariables|util)[A-Za-z0-9_.[\]'-]*/g) ?? [];
  for (const t of tokens) {
    if (!(ACCESS_LOG_WHITELIST as readonly string[]).includes(t)) out.push(`access-log-field:${t}`);
  }
  // a format that is not JSON-ish key/value over whitelisted tokens only (free text is fine, tokens are not)
  if (/\$\{[^}]*\}/.test(format) && !/\$\{AWS::|\$\{Stage\}/.test(format)) out.push('access-log-substitution');
  return out;
}

/** Splits the Resources section into { LogicalId: text }. */
export function resourceBlocks(template: string): Record<string, string> {
  const start = template.indexOf('\nResources:\n');
  const end = template.indexOf('\nOutputs:\n');
  const body = template.slice(start + '\nResources:\n'.length, end === -1 ? undefined : end);
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

const typeOf = (block: string): string => /\n?\s{4}Type: ([A-Za-z0-9:]+)/.exec(`\n${block}`)?.[1] ?? '';

/** Statements of an IAM role block: [{ sid, actions, resources, text }]. */
export function roleStatements(block: string): { sid: string; actions: string[]; resources: string; text: string }[] {
  const stripped = block
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  const parts = stripped.split(/\n\s+- Sid: /).slice(1);
  return parts.map((p) => {
    const sid = p.split('\n')[0]?.trim() ?? '';
    const actionLine = /Action: (\[[^\]]*\]|[^\n]+)/.exec(p)?.[1] ?? '';
    const actions = actionLine.replace(/[[\]'"]/g, '').split(',').map((a) => a.trim()).filter(Boolean);
    const resources = p.slice(p.indexOf('Resource:'));
    return { sid, actions, resources, text: p };
  });
}

const SECRET_NAME = /SECRET|PEPPER|PASSWORD|TOKEN|PRIVATE|CREDENTIAL|API_?KEY|ACCESS_?KEY/i;

/** Every violation of the privacy, logging, secret and IAM guarantees in `template`. Empty means clean. */
export function iacViolations(template: string): string[] {
  const v: string[] = [];
  const R = resourceBlocks(template);
  const ids = Object.keys(R);

  // ---- execution logging, data tracing, access logs (A2-05) ----------------------------------------------------
  if (/DataTraceEnabled:\s*true/i.test(template)) v.push('data-trace-on');
  if (/LoggingLevel:\s*['"]?(INFO|ERROR)\b/i.test(template)) v.push('execution-logging-on');
  const stages = ids.filter((id) => typeOf(R[id] as string) === 'AWS::ApiGatewayV2::Stage');
  if (stages.length === 0) v.push('no-stage');
  for (const id of stages) {
    const b = R[id] as string;
    if (!/DataTraceEnabled:\s*false/.test(b)) v.push(`data-trace-not-explicitly-off:${id}`);
    if (!/LoggingLevel:\s*['"]?OFF['"]?/.test(b)) v.push(`logging-level-not-explicitly-off:${id}`);
  }
  for (const m of template.matchAll(/AccessLogSettings:[\s\S]*?(?:\n\s{6}\S|\n\s{4}\S|$)/g)) {
    const fmt = /Format:\s*(.+)/.exec(m[0])?.[1] ?? '';
    if (fmt === '') v.push('access-log-without-format');
    for (const x of accessLogFormatViolations(fmt)) v.push(x);
  }
  for (const id of ids) {
    const b = R[id] as string;
    const t = typeOf(b);
    if (t === 'AWS::CloudFront::Distribution' && /\n\s+Logging:/.test(b)) v.push(`cloudfront-logging:${id}`);
    if (t === 'AWS::S3::Bucket' && /LoggingConfiguration:/.test(b)) v.push(`s3-access-logging:${id}`);
  }

  // ---- X-Ray -----------------------------------------------------------------------------------------------------
  if (/Tracing:\s*Active/.test(template) || /TracingEnabled:\s*true/i.test(template) || /Mode:\s*Active/.test(template)) v.push('xray-on');
  if (/xray:/i.test(template) || /AWS::XRay::/.test(template)) v.push('xray-resources-or-permissions');
  for (const id of ids) {
    if (typeOf(R[id] as string) === 'AWS::Serverless::Function' && !/Tracing:\s*PassThrough/.test(R[id] as string)) {
      v.push(`tracing-not-explicit:${id}`);
    }
  }

  // ---- point-in-time recovery (documented off) ------------------------------------------------------------------
  for (const id of ids) {
    const b = R[id] as string;
    if (typeOf(b) !== 'AWS::DynamoDB::Table') continue;
    if (/PointInTimeRecoveryEnabled:\s*true/.test(b)) v.push(`pitr-on:${id}`);
    if (!/PointInTimeRecoveryEnabled:\s*false/.test(b)) v.push(`pitr-not-explicit:${id}`);
    if (!/Point-in-time recovery is deliberately OFF/.test(b)) v.push(`pitr-undocumented:${id}`);
    if (/SSEEnabled:\s*false/i.test(b)) v.push(`table-encryption-disabled:${id}`);
  }

  // ---- bounded log retention -------------------------------------------------------------------------------------
  const groups = ids.filter((id) => typeOf(R[id] as string) === 'AWS::Logs::LogGroup');
  for (const id of groups) {
    const days = /RetentionInDays:\s*(\d+)/.exec(R[id] as string)?.[1];
    if (days === undefined) v.push(`log-retention-missing:${id}`);
    else if (Number(days) > 14) v.push(`log-retention-too-long:${id}`);
  }
  for (const id of ids) {
    const b = R[id] as string;
    if (typeOf(b) !== 'AWS::Serverless::Function' && typeOf(b) !== 'AWS::Lambda::Function') continue;
    const ref = /LogGroup:\s*!Ref\s+([A-Za-z0-9]+)/.exec(b)?.[1];
    if (!ref || !groups.includes(ref)) v.push(`function-log-group-not-managed:${id}`);
  }

  // ---- no secret in the template or the function configuration --------------------------------------------------
  if (/\{\{resolve:/.test(template)) v.push('dynamic-reference');
  if (/NoEcho:\s*true/.test(template)) v.push('secret-parameter');
  if (/AKIA[0-9A-Z]{16}/.test(template) || /\b\d{12}\b/.test(template)) v.push('credential-or-account-id');
  for (const id of ids) {
    const b = R[id] as string;
    const env = /Variables:\n([\s\S]*?)(?:\n\s{6}\S|\n\s{4}\S|$)/.exec(b)?.[1];
    if (!env) continue;
    for (const line of env.split('\n')) {
      const m = /^\s{10}([A-Z0-9_]+):\s*(.*)$/.exec(line);
      if (!m) continue;
      const [, name, value] = m as unknown as [string, string, string];
      if (SECRET_NAME.test(name)) {
        // the only allowed secret-looking name is the parameter NAME of the SecureString, as a path
        const ok = name === 'HASH_SECRET_PARAM' && /!Sub '\/atr\/relay\/\$\{Stage\}\/[a-z-]+'/.test(value);
        if (!ok) v.push(`secret-in-environment:${id}:${name}`);
      }
    }
  }

  // ---- IAM: least privilege on the function roles ----------------------------------------------------------------
  for (const id of ids.filter((x) => typeOf(R[x] as string) === 'AWS::IAM::Role')) {
    const b = R[id] as string;
    for (const st of roleStatements(b)) {
      for (const a of st.actions) {
        if (a === '*' || a.endsWith(':*')) v.push(`iam-wildcard-action:${id}:${st.sid}`);
        if (a === 'dynamodb:Scan') v.push(`iam-scan:${id}`);
        if (a.startsWith('iam:') || a.startsWith('kms:')) v.push(`iam-unexpected-service:${id}:${a}`);
      }
      if (/Resource:\s*['"]?\*['"]?\s*$/m.test(st.resources)) v.push(`iam-wildcard-resource:${id}:${st.sid}`);
      if (st.actions.includes('dynamodb:Query') && !/\/index\/live-rooms/.test(st.resources)) v.push(`iam-query-not-on-index:${id}`);
      if (st.actions.includes('ssm:GetParameter') && !/parameter\/atr\/relay\/\$\{Stage\}\/hash-secret'?\s*$/m.test(st.resources.trim())) {
        v.push(`iam-ssm-not-exact:${id}`);
      }
      if (st.actions.some((a) => a.startsWith('ssm:')) && st.actions.some((a) => a !== 'ssm:GetParameter')) v.push(`iam-ssm-beyond-get:${id}`);
      if (st.actions.includes('execute-api:ManageConnections') && /\/GET\/|\/\*\/\*|\/\$\{Stage\}\/\*/.test(st.resources)) v.push(`iam-manage-connections-too-broad:${id}`);
    }
  }

  // ---- queues -----------------------------------------------------------------------------------------------------
  for (const id of ids.filter((x) => typeOf(R[x] as string) === 'AWS::SQS::Queue')) {
    const b = R[id] as string;
    if (!/SqsManagedSseEnabled:\s*true/.test(b)) v.push(`queue-unencrypted:${id}`);
    const ret = /MessageRetentionPeriod:\s*(\d+)/.exec(b)?.[1];
    if (ret === undefined || Number(ret) > 86400) v.push(`queue-retention-unbounded:${id}`);
  }
  const policies = ids.filter((x) => typeOf(R[x] as string) === 'AWS::SQS::QueuePolicy');
  if (!policies.some((id) => /aws:SecureTransport/.test(R[id] as string) && /Effect: Deny/.test(R[id] as string))) v.push('queue-tls-only-missing');

  return [...new Set(v)];
}
