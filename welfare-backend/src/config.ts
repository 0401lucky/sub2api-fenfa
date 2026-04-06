import dotenv from 'dotenv';
import { z } from 'zod';
import { isValidTimezone } from './utils/date.js';
import { isSafeLinuxDoSubject } from './utils/oauth.js';

dotenv.config();

const booleanFromString = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (value == null) return undefined;
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === '') return undefined;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return value;
}, z.boolean().optional());

const optionalTrimmedString = z.preprocess((value) => {
  if (value == null) return undefined;
  if (typeof value !== 'string') return value;
  const normalized = value.trim();
  return normalized === '' ? undefined : normalized;
}, z.string().optional());

function parseDurationMs(value: string, fieldName: string): number {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(
    /^(\d+(?:\.\d+)?)\s*(ms|msec|msecs|millisecond|milliseconds|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks|y|yr|yrs|year|years)?$/
  );

  if (!match) {
    throw new Error(
      `${fieldName} 格式非法，支持如 15m、24h、7d、30s 或 5000ms`
    );
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? 'ms';
  const multiplierMap: Record<string, number> = {
    ms: 1,
    msec: 1,
    msecs: 1,
    millisecond: 1,
    milliseconds: 1,
    s: 1000,
    sec: 1000,
    secs: 1000,
    second: 1000,
    seconds: 1000,
    m: 60 * 1000,
    min: 60 * 1000,
    mins: 60 * 1000,
    minute: 60 * 1000,
    minutes: 60 * 1000,
    h: 60 * 60 * 1000,
    hr: 60 * 60 * 1000,
    hrs: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    hours: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000,
    yr: 365 * 24 * 60 * 60 * 1000,
    yrs: 365 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
    years: 365 * 24 * 60 * 60 * 1000
  };
  const multiplier = multiplierMap[unit];

  if (!Number.isFinite(amount) || amount <= 0 || !multiplier) {
    throw new Error(`${fieldName} 必须是大于 0 的合法时长`);
  }

  return Math.round(amount * multiplier);
}

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL 不能为空'),

  WELFARE_FRONTEND_URL: z.string().url('WELFARE_FRONTEND_URL 必须是合法 URL'),
  WELFARE_CORS_ORIGINS: z.string().default(''),
  WELFARE_JWT_SECRET: z.string().min(16, 'WELFARE_JWT_SECRET 至少 16 位'),
  WELFARE_JWT_EXPIRES_IN: z.string().default('12h'),

  LINUXDO_CLIENT_ID: z.string().min(1, 'LINUXDO_CLIENT_ID 不能为空'),
  LINUXDO_CLIENT_SECRET: z.string().min(1, 'LINUXDO_CLIENT_SECRET 不能为空'),
  LINUXDO_AUTHORIZE_URL: z.string().url('LINUXDO_AUTHORIZE_URL 必须是合法 URL'),
  LINUXDO_TOKEN_URL: z.string().url('LINUXDO_TOKEN_URL 必须是合法 URL'),
  LINUXDO_USERINFO_URL: z.string().url('LINUXDO_USERINFO_URL 必须是合法 URL'),
  LINUXDO_REDIRECT_URI: z.string().url('LINUXDO_REDIRECT_URI 必须是合法 URL'),
  LINUXDO_SCOPE: z.string().default('user'),

  SUB2API_BASE_URL: z.string().url('SUB2API_BASE_URL 必须是合法 URL'),
  SUB2API_ADMIN_API_KEY: z.string().min(1, 'SUB2API_ADMIN_API_KEY 不能为空'),
  SUB2API_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  CLOUDFLARE_API_TOKEN: optionalTrimmedString,
  CLOUDFLARE_ZONE_ID: optionalTrimmedString,
  CLOUDFLARE_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  WELFARE_REVOKED_TOKEN_CLEANUP_INTERVAL: z.string().default('6h'),
  WELFARE_MONITOR_SCAN_INTERVAL: z.string().default('5m'),
  WELFARE_MONITOR_SNAPSHOT_INTERVAL: z.string().default('1h'),
  WELFARE_MONITOR_OBSERVE_IP_THRESHOLD: z.coerce.number().int().positive().default(4),
  WELFARE_MONITOR_BLOCK_IP_THRESHOLD: z.coerce.number().int().positive().default(6),
  WELFARE_MONITOR_LOCK_DURATION: z.string().default('24h'),
  WELFARE_MONITOR_LIVE_CACHE_TTL: z.string().default('30s'),
  WELFARE_MONITOR_SNAPSHOT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  WELFARE_USAGE_SYNC_INTERVAL: z.string().default('5m'),
  WELFARE_USAGE_CACHE_RETENTION: z.string().default('48h'),
  WELFARE_RATE_LIMIT_AUTH_WINDOW: z.string().default('10m'),
  WELFARE_RATE_LIMIT_AUTH_LIMIT: z.coerce.number().int().positive().default(20),
  WELFARE_RATE_LIMIT_CHECKIN_WINDOW: z.string().default('5m'),
  WELFARE_RATE_LIMIT_CHECKIN_LIMIT: z.coerce.number().int().positive().default(6),
  WELFARE_RATE_LIMIT_REDEEM_WINDOW: z.string().default('10m'),
  WELFARE_RATE_LIMIT_REDEEM_LIMIT: z.coerce.number().int().positive().default(10),
  WELFARE_RATE_LIMIT_ADMIN_MUTATION_WINDOW: z.string().default('1m'),
  WELFARE_RATE_LIMIT_ADMIN_MUTATION_LIMIT: z.coerce.number().int().positive().default(30),

  DEFAULT_CHECKIN_ENABLED: booleanFromString.default(true),
  DEFAULT_DAILY_REWARD: z.coerce.number().positive().default(10),
  DEFAULT_TIMEZONE: z
    .string()
    .default('Asia/Shanghai')
    .refine(isValidTimezone, 'DEFAULT_TIMEZONE 必须是合法时区'),
  BOOTSTRAP_ADMIN_USER_IDS: z.string().default(''),
  BOOTSTRAP_ADMIN_SUBJECTS: z.string().default(''),
  BOOTSTRAP_ADMIN_EMAILS: z.string().default('')
});

function normalizeOrigin(value: string, fieldName: string): string {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`${fieldName} 包含非法来源: ${value}`);
  }
}

const parsed = configSchema.safeParse(process.env);
if (!parsed.success) {
  const message = parsed.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  throw new Error(`环境变量校验失败：${message}`);
}

const raw = parsed.data;
const revokedTokenCleanupIntervalMs = parseDurationMs(
  raw.WELFARE_REVOKED_TOKEN_CLEANUP_INTERVAL,
  'WELFARE_REVOKED_TOKEN_CLEANUP_INTERVAL'
);
const monitorScanIntervalMs = parseDurationMs(
  raw.WELFARE_MONITOR_SCAN_INTERVAL,
  'WELFARE_MONITOR_SCAN_INTERVAL'
);
const monitorSnapshotIntervalMs = parseDurationMs(
  raw.WELFARE_MONITOR_SNAPSHOT_INTERVAL,
  'WELFARE_MONITOR_SNAPSHOT_INTERVAL'
);
const monitorLockDurationMs = parseDurationMs(
  raw.WELFARE_MONITOR_LOCK_DURATION,
  'WELFARE_MONITOR_LOCK_DURATION'
);
const monitorLiveCacheTtlMs = parseDurationMs(
  raw.WELFARE_MONITOR_LIVE_CACHE_TTL,
  'WELFARE_MONITOR_LIVE_CACHE_TTL'
);
const usageSyncIntervalMs = parseDurationMs(
  raw.WELFARE_USAGE_SYNC_INTERVAL,
  'WELFARE_USAGE_SYNC_INTERVAL'
);
const usageCacheRetentionMs = parseDurationMs(
  raw.WELFARE_USAGE_CACHE_RETENTION,
  'WELFARE_USAGE_CACHE_RETENTION'
);
const authRateLimitWindowMs = parseDurationMs(
  raw.WELFARE_RATE_LIMIT_AUTH_WINDOW,
  'WELFARE_RATE_LIMIT_AUTH_WINDOW'
);
const checkinRateLimitWindowMs = parseDurationMs(
  raw.WELFARE_RATE_LIMIT_CHECKIN_WINDOW,
  'WELFARE_RATE_LIMIT_CHECKIN_WINDOW'
);
const redeemRateLimitWindowMs = parseDurationMs(
  raw.WELFARE_RATE_LIMIT_REDEEM_WINDOW,
  'WELFARE_RATE_LIMIT_REDEEM_WINDOW'
);
const adminMutationRateLimitWindowMs = parseDurationMs(
  raw.WELFARE_RATE_LIMIT_ADMIN_MUTATION_WINDOW,
  'WELFARE_RATE_LIMIT_ADMIN_MUTATION_WINDOW'
);
parseDurationMs(raw.WELFARE_JWT_EXPIRES_IN, 'WELFARE_JWT_EXPIRES_IN');

const frontendOrigin = normalizeOrigin(raw.WELFARE_FRONTEND_URL, 'WELFARE_FRONTEND_URL');
const sub2apiOrigin = normalizeOrigin(raw.SUB2API_BASE_URL, 'SUB2API_BASE_URL');
const cloudflareEnabled = Boolean(raw.CLOUDFLARE_API_TOKEN && raw.CLOUDFLARE_ZONE_ID);
const cloudflareDisabledReason = cloudflareEnabled
  ? ''
  : raw.CLOUDFLARE_API_TOKEN || raw.CLOUDFLARE_ZONE_ID
    ? 'CLOUDFLARE_API_TOKEN 与 CLOUDFLARE_ZONE_ID 需要同时配置'
    : '未配置 Cloudflare IP 访问规则集成';
const configuredCorsOrigins = raw.WELFARE_CORS_ORIGINS.split(',')
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => normalizeOrigin(item, 'WELFARE_CORS_ORIGINS'));
const bootstrapAdminUserIds = raw.BOOTSTRAP_ADMIN_USER_IDS.split(',')
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => Number(item));
const bootstrapAdminSubjects = raw.BOOTSTRAP_ADMIN_SUBJECTS.split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const bootstrapAdminEmails = raw.BOOTSTRAP_ADMIN_EMAILS.split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const invalidBootstrapUserId = bootstrapAdminUserIds.find(
  (item) => !Number.isInteger(item) || item <= 0
);
const invalidBootstrapSubject = bootstrapAdminSubjects.find(
  (item) => !isSafeLinuxDoSubject(item)
);
const invalidBootstrapEmail = bootstrapAdminEmails.find(
  (item) => !z.string().email().safeParse(item).success
);

if (invalidBootstrapUserId) {
  throw new Error(
    `环境变量校验失败：BOOTSTRAP_ADMIN_USER_IDS 包含非法用户 ID: ${invalidBootstrapUserId}`
  );
}

if (invalidBootstrapSubject) {
  throw new Error(
    `环境变量校验失败：BOOTSTRAP_ADMIN_SUBJECTS 包含非法 subject: ${invalidBootstrapSubject}`
  );
}

if (invalidBootstrapEmail) {
  throw new Error(
    `环境变量校验失败：BOOTSTRAP_ADMIN_EMAILS 包含非法邮箱: ${invalidBootstrapEmail}`
  );
}

if (raw.WELFARE_MONITOR_BLOCK_IP_THRESHOLD <= raw.WELFARE_MONITOR_OBSERVE_IP_THRESHOLD) {
  throw new Error(
    '环境变量校验失败：WELFARE_MONITOR_BLOCK_IP_THRESHOLD 必须大于 WELFARE_MONITOR_OBSERVE_IP_THRESHOLD'
  );
}

export const config = {
  ...raw,
  WELFARE_FRONTEND_ORIGIN: frontendOrigin,
  WELFARE_CORS_ORIGINS:
    configuredCorsOrigins.length > 0 ? configuredCorsOrigins : [frontendOrigin],
  WELFARE_REVOKED_TOKEN_CLEANUP_INTERVAL_MS: revokedTokenCleanupIntervalMs,
  WELFARE_MONITOR_SCAN_INTERVAL_MS: monitorScanIntervalMs,
  WELFARE_MONITOR_SNAPSHOT_INTERVAL_MS: monitorSnapshotIntervalMs,
  WELFARE_MONITOR_LOCK_DURATION_MS: monitorLockDurationMs,
  WELFARE_MONITOR_LIVE_CACHE_TTL_MS: monitorLiveCacheTtlMs,
  WELFARE_USAGE_SYNC_INTERVAL_MS: usageSyncIntervalMs,
  WELFARE_USAGE_CACHE_RETENTION_MS: usageCacheRetentionMs,
  WELFARE_RATE_LIMIT_AUTH_WINDOW_MS: authRateLimitWindowMs,
  WELFARE_RATE_LIMIT_CHECKIN_WINDOW_MS: checkinRateLimitWindowMs,
  WELFARE_RATE_LIMIT_REDEEM_WINDOW_MS: redeemRateLimitWindowMs,
  WELFARE_RATE_LIMIT_ADMIN_MUTATION_WINDOW_MS: adminMutationRateLimitWindowMs,
  BOOTSTRAP_ADMIN_USER_IDS: bootstrapAdminUserIds,
  BOOTSTRAP_ADMIN_SUBJECTS: bootstrapAdminSubjects,
  BOOTSTRAP_ADMIN_EMAILS: bootstrapAdminEmails,
  SUB2API_BASE_URL: raw.SUB2API_BASE_URL.replace(/\/+$/, ''),
  SUB2API_ORIGIN: sub2apiOrigin,
  CLOUDFLARE_API_TOKEN: raw.CLOUDFLARE_API_TOKEN ?? null,
  CLOUDFLARE_ZONE_ID: raw.CLOUDFLARE_ZONE_ID ?? null,
  CLOUDFLARE_IP_ACCESS_ENABLED: cloudflareEnabled,
  CLOUDFLARE_IP_ACCESS_DISABLED_REASON: cloudflareDisabledReason
};

export type AppConfig = typeof config;
