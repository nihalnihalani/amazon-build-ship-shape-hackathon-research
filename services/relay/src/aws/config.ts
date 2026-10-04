export class AwsConfigError extends Error {
  override name = 'AwsConfigError';
}

export interface AwsConfig {
  tableName: string;
  allowedOrigins: string[];
  /** RELAY_DISABLED=true: the documented kill switch. */
  disabled: boolean;
  stage: string;
  hashPepper: string;
}

const isTrue = (v: string | undefined): boolean => v?.trim().toLowerCase() === 'true';

/**
 * Reads the Lambda environment. Fails closed: a missing table name or an empty/invalid origin allowlist is a
 * cold-start error, never an "allow everything" default.
 */
export function loadAwsConfig(env: Record<string, string | undefined>): AwsConfig {
  const tableName = env.TABLE_NAME?.trim() ?? '';
  if (tableName === '') throw new AwsConfigError('TABLE_NAME is required');
  const origins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (origins.length === 0) throw new AwsConfigError('ALLOWED_ORIGINS must list at least one exact origin');
  for (const o of origins) {
    let u: URL;
    try {
      u = new URL(o);
    } catch {
      throw new AwsConfigError('ALLOWED_ORIGINS contains an entry that is not a URL origin');
    }
    if (u.origin !== o) throw new AwsConfigError('ALLOWED_ORIGINS entries must be exact origins (scheme://host[:port])');
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === 'localhost')) {
      throw new AwsConfigError('ALLOWED_ORIGINS entries must be https (http only for localhost)');
    }
  }
  return {
    tableName,
    allowedOrigins: origins,
    disabled: isTrue(env.RELAY_DISABLED),
    stage: env.STAGE_NAME?.trim() || 'staging',
    hashPepper: env.HASH_PEPPER ?? '',
  };
}
