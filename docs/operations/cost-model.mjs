#!/usr/bin/env node
// Cost model for the Across the Room relay (see COST.md). Pure arithmetic over stated assumptions.
// Nothing here is a measurement: no service was deployed or called. Prices are REFERENCE values taken from the
// AWS pricing pages (fetched 2026-10-05, mostly US East (N. Virginia) examples) and MUST be re-verified for the
// deployment region (ap-south-1 is intended) at deploy time. Override any value with an environment variable,
// for example PRICE_APIGW_PER_MILLION_MESSAGES=1.2 node docs/operations/cost-model.mjs
const env = (name, dflt) => (process.env[name] !== undefined ? Number(process.env[name]) : dflt);

export const PRICES = {
  apigwPerMillionMessages: env('PRICE_APIGW_PER_MILLION_MESSAGES', 1.0), // WebSocket messages, 32 KB metering units
  apigwPerMillionConnectionMinutes: env('PRICE_APIGW_PER_MILLION_CONNECTION_MINUTES', 0.25),
  lambdaPerMillionRequests: env('PRICE_LAMBDA_PER_MILLION_REQUESTS', 0.2),
  lambdaPerGbSecond: env('PRICE_LAMBDA_PER_GB_SECOND', 0.0000166667), // x86 example; arm64 is lower, used as an upper bound
  dynamoPerMillionWru: env('PRICE_DYNAMO_PER_MILLION_WRU', 0.625),
  dynamoPerMillionRru: env('PRICE_DYNAMO_PER_MILLION_RRU', 0.125),
  sqsPerMillionRequests: env('PRICE_SQS_PER_MILLION_REQUESTS', 0.4), // standard queue, after the first million per month
};

export const ASSUMPTIONS = {
  levelHz: env('A_LEVEL_HZ', 20), // 50 ms frames (PROTOCOL.md)
  controlMessages: env('A_CONTROL_MESSAGES', 150), // C: commands and observations other than level, both directions, per session
  sessionMinutes: env('A_SESSION_MINUTES', 15), // T: both clients connected
  heartbeatSeconds: 10, // ADR-0006
  pairingInbound: 6, // room.create, join.request, join.confirm, resumes
  pairingOutbound: 8, // room.created, join.pending, join.requested, join.accepted, peer.state x4
  connectInvocations: 4, // 2 x $connect + 2 x $disconnect
  deadlineMessages: 3, // authentication-deadline messages per session: TV $connect (5 s), phone $connect (5 s), join.request (65 s)
  sqsRequestsPerDeadlineMessage: 3, // SendMessage + ReceiveMessage + DeleteMessage (empty polls are listed separately in COST.md)
  deadlineRru: 1, // the consumer reads one connection item per check (a no-op for an authenticated connection)
  pairingExtraRru: 4, // measured: pairing reads 16 RRU in total, the generic accounting covers 12 (test: cost-ops.test.ts)
  lambdaSeconds: env('A_LAMBDA_SECONDS', 0.06), // average billed duration per invocation (UNMEASURED)
  lambdaMemoryGb: 0.5, // 512 MB
  rruPerInbound: 2, // strongly consistent getConnection + getRoom
  wruPerInbound: 4, // two window counters, message-id marker, sequence acceptance
  wruTouchPerInbound: 0.05, // connection touch at most every 5 s
  wruPerRelayReply: 1, // per-connection relay sequence
  wruPerConnectOrDisconnect: 3,
};

export function perSession(windowSeconds) {
  const a = ASSUMPTIONS;
  const level = a.levelHz * windowSeconds;
  const pings = (a.sessionMinutes * 60 / a.heartbeatSeconds) * 2; // two clients
  const inbound = level + a.controlMessages + pings + a.pairingInbound;
  const outbound = level + a.controlMessages + pings + a.pairingOutbound; // forwards, pongs, relay-originated
  const messages = inbound + outbound;
  const connectionMinutes = 2 * a.sessionMinutes;
  const deadlineInvocations = a.deadlineMessages; // one consumer invocation per message (batches of one: each message has its own delay)
  const invocations = inbound + a.connectInvocations + deadlineInvocations;
  const gbSeconds = invocations * a.lambdaSeconds * a.lambdaMemoryGb;
  const sqsRequests = a.deadlineMessages * a.sqsRequestsPerDeadlineMessage;
  const relayReplies = pings + a.pairingOutbound;
  const wru = inbound * (a.wruPerInbound + a.wruTouchPerInbound) + relayReplies * a.wruPerRelayReply + a.connectInvocations * a.wruPerConnectOrDisconnect;
  const rru = inbound * a.rruPerInbound + a.pairingExtraRru + deadlineInvocations * a.deadlineRru;
  const p = PRICES;
  const cost = {
    apiGatewayMessages: (messages / 1e6) * p.apigwPerMillionMessages,
    apiGatewayConnectionMinutes: (connectionMinutes / 1e6) * p.apigwPerMillionConnectionMinutes,
    lambdaRequests: (invocations / 1e6) * p.lambdaPerMillionRequests,
    lambdaCompute: gbSeconds * p.lambdaPerGbSecond,
    dynamoWrites: (wru / 1e6) * p.dynamoPerMillionWru,
    dynamoReads: (rru / 1e6) * p.dynamoPerMillionRru,
    sqsRequests: (sqsRequests / 1e6) * p.sqsPerMillionRequests,
  };
  const total = Object.values(cost).reduce((x, y) => x + y, 0);
  return { windowSeconds, level, pings, inbound, outbound, messages, connectionMinutes, invocations, sqsRequests, gbSeconds, wru, rru, cost, total };
}

/** Cost of one forwarded inbound message at steady state (level frame): the unit used for the throttle bound. */
export function perForwardedMessage() {
  const a = ASSUMPTIONS;
  const p = PRICES;
  const wru = a.wruPerInbound + a.wruTouchPerInbound;
  return (
    (2 / 1e6) * p.apigwPerMillionMessages + // inbound frame + outbound @connections post
    (1 / 1e6) * p.lambdaPerMillionRequests +
    a.lambdaSeconds * a.lambdaMemoryGb * p.lambdaPerGbSecond +
    (wru / 1e6) * p.dynamoPerMillionWru +
    (a.rruPerInbound / 1e6) * p.dynamoPerMillionRru
  );
}

/** Upper bound on spend if the stage throttle rate were sustained (all messages accepted by the throttle). */
export function throttleBound(ratePerSecond) {
  const unit = perForwardedMessage();
  return { ratePerSecond, perHour: ratePerSecond * 3600 * unit, perDay: ratePerSecond * 86400 * unit, per30Days: ratePerSecond * 86400 * 30 * unit, unit };
}

const usd = (x) => `$${x.toFixed(x < 0.1 ? 5 : 2)}`;
const n0 = (x) => Math.round(x).toLocaleString('en-US');

export function report() {
  const lines = [];
  const full = perSession(116);
  const typical = perSession(60);
  lines.push('Per-session model (reference prices; nothing measured)');
  lines.push('metric | full session (W=116 s) | typical (W=60 s)');
  const row = (label, f) => lines.push(`${label} | ${f(full)} | ${f(typical)}`);
  row('level frames', (s) => n0(s.level));
  row('inbound messages', (s) => n0(s.inbound));
  row('outbound @connections posts', (s) => n0(s.outbound));
  row('API Gateway metered messages', (s) => n0(s.messages));
  row('connection minutes', (s) => n0(s.connectionMinutes));
  row('Lambda invocations (relay + deadline consumer)', (s) => n0(s.invocations));
  row('SQS requests (deadline queue, excl. idle polling)', (s) => n0(s.sqsRequests));
  row('Lambda GB-seconds', (s) => s.gbSeconds.toFixed(1));
  row('DynamoDB WRU', (s) => n0(s.wru));
  row('DynamoDB RRU', (s) => n0(s.rru));
  row('API Gateway messages cost', (s) => usd(s.cost.apiGatewayMessages));
  row('API Gateway connection minutes cost', (s) => usd(s.cost.apiGatewayConnectionMinutes));
  row('Lambda requests cost', (s) => usd(s.cost.lambdaRequests));
  row('Lambda compute cost', (s) => usd(s.cost.lambdaCompute));
  row('DynamoDB writes cost', (s) => usd(s.cost.dynamoWrites));
  row('DynamoDB reads cost', (s) => usd(s.cost.dynamoReads));
  row('SQS requests cost', (s) => `${(s.cost.sqsRequests * 1e6).toFixed(1)} micro-USD`);
  row('TOTAL per session (excl. logs, CloudFront, S3, alarms)', (s) => usd(s.total));
  lines.push('');
  lines.push(`Per forwarded inbound message: ${(perForwardedMessage() * 1e6).toFixed(2)} micro-USD`);
  lines.push('');
  lines.push('Sustained-at-the-throttle upper bound (excl. logs)');
  lines.push('stage | rate (msg/s) | per hour | per day | per 30 days');
  for (const [stage, rate] of [['staging', 60], ['prod', 150]]) {
    const b = throttleBound(rate);
    lines.push(`${stage} | ${rate} | ${usd(b.perHour)} | ${usd(b.perDay)} | ${usd(b.per30Days)}`);
  }
  lines.push('');
  lines.push('Sessions per month at the full-session cost');
  for (const sessions of [100, 500, 5000]) lines.push(`${n0(sessions)} sessions | ${usd(sessions * full.total)}`);
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(report());
