import type { RelayEnvironment } from '../core/index.js';

export class AwsConfigError extends Error {
  override name = 'AwsConfigError';
}

export interface AwsConfig {
  tableName: string;
  /** Exact phone page origins. */
  phoneOrigins: string[];
  /** TV web-preview origins (refused when ATR_ENV=production). */
  tvPreviewOrigins: string[];
  environment: RelayEnvironment;
  /** Name of the SSM SecureString parameter that holds the master secret for the keyed hashes. Never the value. */
  hashSecretParameter: string;
  /** URL of the SQS delay queue for authentication-deadline checks (relay function only). */
  deadlineQueueUrl: string | null;
  liveRoomCap: number;
  /** RELAY_DISABLED=true: the documented kill switch. */
  disabled: boolean;
  stage: string;
}

const isTrue = (v: string | undefined): boolean => v?.trim().toLowerCase() === 'true';

function parseOrigins(name: string, raw: string | undefined, production: boolean): string[] {
  const origins = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  for (const o of origins) {
    let u: URL;
    try {
      u = new URL(o);
    } catch {
      throw new AwsConfigError(`${name} contains an entry that is not a URL origin`);
    }
    if (u.origin !== o) throw new AwsConfigError(`${name} entries must be exact origins (scheme://host[:port])`);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === 'localhost')) {
      throw new AwsConfigError(`${name} entries must be https (http only for localhost)`);
    }
    if (production && (u.protocol !== 'https:' || u.hostname === 'localhost')) {
      throw new AwsConfigError(`${name} must not contain localhost or http origins when ATR_ENV=production`);
    }
  }
  return origins;
}

/**
 * Reads the Lambda environment. Fails closed: a missing table name, an empty or invalid origin allowlist, a missing
 * secret parameter name, or preview origins in production is a cold-start error, never an "allow" default.
 * The hash secret itself is never an environment value: only the name of an SSM SecureString parameter is.
 */
export function loadAwsConfig(env: Record<string, string | undefined>): AwsConfig {
  const tableName = env.TABLE_NAME?.trim() ?? '';
  if (tableName === '') throw new AwsConfigError('TABLE_NAME is required');
  const envName = env.ATR_ENV?.trim() || 'development';
  if (envName !== 'development' && envName !== 'staging' && envName !== 'production') {
    throw new AwsConfigError('ATR_ENV must be development, staging or production');
  }
  const production = envName === 'production';
  const phoneOrigins = parseOrigins('ALLOWED_ORIGINS', env.ALLOWED_ORIGINS, production);
  if (phoneOrigins.length === 0) throw new AwsConfigError('ALLOWED_ORIGINS must list at least one exact origin');
  const tvPreviewOrigins = parseOrigins('TV_PREVIEW_ORIGINS', env.TV_PREVIEW_ORIGINS, false);
  if (production && tvPreviewOrigins.length > 0) {
    throw new AwsConfigError('TV_PREVIEW_ORIGINS must be empty when ATR_ENV=production');
  }
  const hashSecretParameter = env.HASH_SECRET_PARAM?.trim() ?? '';
  if (!/^\/[A-Za-z0-9_./-]{1,200}$/.test(hashSecretParameter)) {
    throw new AwsConfigError('HASH_SECRET_PARAM must be the name of an SSM parameter (for example /atr/relay/staging/hash-secret)');
  }
  const capRaw = env.LIVE_ROOM_CAP?.trim();
  const liveRoomCap = capRaw ? Number(capRaw) : 200;
  if (!Number.isInteger(liveRoomCap) || liveRoomCap < 1 || liveRoomCap > 100_000) {
    throw new AwsConfigError('LIVE_ROOM_CAP must be an integer between 1 and 100000');
  }
  return {
    tableName,
    phoneOrigins,
    tvPreviewOrigins,
    environment: envName,
    hashSecretParameter,
    deadlineQueueUrl: env.DEADLINE_QUEUE_URL?.trim() || null,
    liveRoomCap,
    disabled: isTrue(env.RELAY_DISABLED),
    stage: env.STAGE_NAME?.trim() || 'staging',
  };
}
