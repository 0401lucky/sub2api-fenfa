import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const booleanFromString = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (value == null) return undefined;
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === '') return undefined;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}, z.boolean().optional());

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL 不能为空'),

  WELFARE_FRONTEND_URL: z.string().url('WELFARE_FRONTEND_URL 必须是合法 URL'),
  WELFARE_CORS_ORIGINS: z.string().default(''),
  WELFARE_JWT_SECRET: z.string().min(16, 'WELFARE_JWT_SECRET 至少 16 位'),
  WELFARE_JWT_EXPIRES_IN: z.string().default('7d'),
  WELFARE_COOKIE_SECURE: booleanFromString.default(false),
  WELFARE_SESSION_COOKIE_SAME_SITE: z
    .enum(['lax', 'strict', 'none'])
    .default('lax'),

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

  DEFAULT_CHECKIN_ENABLED: booleanFromString.default(true),
  DEFAULT_DAILY_REWARD: z.coerce.number().positive().default(10),
  DEFAULT_TIMEZONE: z.string().default('Asia/Shanghai'),
  BOOTSTRAP_ADMIN_SUBJECTS: z.string().default('')
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
if (
  raw.WELFARE_SESSION_COOKIE_SAME_SITE === 'none' &&
  !raw.WELFARE_COOKIE_SECURE
) {
  throw new Error(
    'WELFARE_SESSION_COOKIE_SAME_SITE=none 时，WELFARE_COOKIE_SECURE 必须为 true'
  );
}

const frontendOrigin = normalizeOrigin(raw.WELFARE_FRONTEND_URL, 'WELFARE_FRONTEND_URL');
const configuredCorsOrigins = raw.WELFARE_CORS_ORIGINS.split(',')
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => normalizeOrigin(item, 'WELFARE_CORS_ORIGINS'));
const bootstrapAdminSubjects = raw.BOOTSTRAP_ADMIN_SUBJECTS.split(',')
  .map((item) => item.trim())
  .filter(Boolean);

export const config = {
  ...raw,
  WELFARE_FRONTEND_ORIGIN: frontendOrigin,
  WELFARE_CORS_ORIGINS:
    configuredCorsOrigins.length > 0 ? configuredCorsOrigins : [frontendOrigin],
  BOOTSTRAP_ADMIN_SUBJECTS: bootstrapAdminSubjects,
  SUB2API_BASE_URL: raw.SUB2API_BASE_URL.replace(/\/+$/, '')
};

export type AppConfig = typeof config;
