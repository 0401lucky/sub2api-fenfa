import { describe, expect, it } from 'vitest';
import {
  isSafeLinuxDoSubject,
  signOAuthState,
  signSessionHandoff,
  toSyntheticEmail,
  verifyOAuthState,
  verifySessionHandoff
} from './oauth.js';

describe('oauth utils', () => {
  it('creates synthetic email from subject', () => {
    expect(toSyntheticEmail('abc_123')).toBe(
      'linuxdo-abc_123@linuxdo-connect.invalid'
    );
  });

  it('validates linuxdo subject format', () => {
    expect(isSafeLinuxDoSubject('abc-123')).toBe(true);
    expect(isSafeLinuxDoSubject('abc.123')).toBe(false);
  });

  it('signs and verifies oauth state', () => {
    const secret = '01234567890123456789';
    const token = signOAuthState(
      {
        state: 'state',
        codeVerifier: 'verifier',
        redirectPath: '/checkin',
        issuedAt: 1
      },
      secret
    );
    const parsed = verifyOAuthState(token, secret);
    expect(parsed?.state).toBe('state');
    expect(parsed?.codeVerifier).toBe('verifier');
    expect(parsed?.redirectPath).toBe('/checkin');
  });

  it('signs and verifies session handoff', () => {
    const secret = '01234567890123456789';
    const token = signSessionHandoff(
      {
        handoffId: 'handoff-id',
        token: 'session-token',
        redirectPath: '/admin',
        issuedAt: 1
      },
      secret
    );
    const parsed = verifySessionHandoff(token, secret);
    expect(parsed?.handoffId).toBe('handoff-id');
    expect(parsed?.token).toBe('session-token');
    expect(parsed?.redirectPath).toBe('/admin');
  });
});
