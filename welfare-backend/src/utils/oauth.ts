import crypto from 'node:crypto';

export interface OAuthStatePayload {
  state: string;
  codeVerifier: string;
  redirectPath: string;
  issuedAt: number;
}

export interface SessionHandoffPayload {
  handoffId: string;
  token: string;
  redirectPath: string;
  issuedAt: number;
}

function base64url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(`${normalized}${'='.repeat(padding)}`, 'base64');
}

function signPayload(payload: object, secret: string): string {
  const body = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signature = base64url(
    crypto.createHmac('sha256', secret).update(body).digest()
  );
  return `${body}.${signature}`;
}

function verifyPayload<T>(token: string, secret: string): T | null {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = base64url(
    crypto.createHmac('sha256', secret).update(body).digest()
  );
  if (
    expected.length !== signature.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  ) {
    return null;
  }

  try {
    return JSON.parse(decodeBase64Url(body).toString('utf8')) as T;
  } catch {
    return null;
  }
}

export function randomBase64Url(byteLength = 32): string {
  return base64url(crypto.randomBytes(byteLength));
}

export function createCodeChallenge(verifier: string): string {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

export function signOAuthState(
  payload: OAuthStatePayload,
  secret: string
): string {
  return signPayload(payload, secret);
}

export function verifyOAuthState(
  token: string,
  secret: string
): OAuthStatePayload | null {
  return verifyPayload<OAuthStatePayload>(token, secret);
}

export function signSessionHandoff(
  payload: SessionHandoffPayload,
  secret: string
): string {
  return signPayload(payload, secret);
}

export function verifySessionHandoff(
  token: string,
  secret: string
): SessionHandoffPayload | null {
  return verifyPayload<SessionHandoffPayload>(token, secret);
}

export function toSyntheticEmail(subject: string): string {
  return `linuxdo-${subject}@linuxdo-connect.invalid`;
}

export function isSafeLinuxDoSubject(subject: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(subject);
}
