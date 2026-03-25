import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

const {
  authContext,
  mockConsumeArtifact,
  mockHasAdminSubject,
  mockIssueArtifact,
  mockRevokeToken,
  mockSessionService,
  mockSub2apiClient,
  mockLinuxDoOAuthService
} = vi.hoisted(() => ({
  authContext: {
    user: {
      sub2apiUserId: 1,
      linuxdoSubject: 'subject',
      syntheticEmail: 'linuxdo-subject@linuxdo-connect.invalid',
      username: 'tester',
      avatarUrl: null
    },
    tokenId: 'token-id',
    expiresAtMs: 1_900_000_000_000
  },
  mockConsumeArtifact: vi.fn(),
  mockHasAdminSubject: vi.fn(),
  mockIssueArtifact: vi.fn(),
  mockRevokeToken: vi.fn(),
  mockSessionService: {
    sign: vi.fn()
  },
  mockSub2apiClient: {
    findUserBySyntheticEmail: vi.fn()
  },
  mockLinuxDoOAuthService: {
    exchangeCode: vi.fn(),
    fetchUserInfo: vi.fn()
  }
}));

vi.mock('../middleware/auth-middleware.js', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.sessionUser = authContext.user;
    req.sessionTokenId = authContext.tokenId;
    req.sessionTokenExpiresAtMs = authContext.expiresAtMs;
    next();
  }
}));

vi.mock('../services/checkin-service.js', () => ({
  welfareRepository: {
    hasAdminSubject: mockHasAdminSubject
  }
}));

vi.mock('../services/session-state-service.js', () => ({
  sessionStateService: {
    revokeToken: mockRevokeToken
  }
}));

vi.mock('../services/auth-artifact-service.js', () => ({
  authArtifactService: {
    issueArtifact: mockIssueArtifact,
    consumeArtifact: mockConsumeArtifact
  }
}));

vi.mock('../services/session-service.js', () => ({
  sessionService: mockSessionService
}));

vi.mock('../services/sub2api-client.js', () => ({
  sub2apiClient: mockSub2apiClient
}));

vi.mock('../services/linuxdo-oauth-service.js', () => ({
  linuxDoOAuthService: mockLinuxDoOAuthService
}));

function applyBaseEnv() {
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    PORT: '8787',
    DATABASE_URL: 'postgres://localhost:5432/test',
    WELFARE_FRONTEND_URL: 'https://example.com/welfare/',
    WELFARE_CORS_ORIGINS: 'https://example.com',
    WELFARE_JWT_SECRET: 'test-secret-123456',
    WELFARE_JWT_EXPIRES_IN: '12h',
    LINUXDO_CLIENT_ID: 'client-id',
    LINUXDO_CLIENT_SECRET: 'client-secret',
    LINUXDO_AUTHORIZE_URL: 'https://example.com/oauth/authorize',
    LINUXDO_TOKEN_URL: 'https://example.com/oauth/token',
    LINUXDO_USERINFO_URL: 'https://example.com/oauth/userinfo',
    LINUXDO_REDIRECT_URI: 'http://localhost:8787/api/auth/linuxdo/callback',
    LINUXDO_SCOPE: 'user',
    SUB2API_BASE_URL: 'https://example.com',
    SUB2API_ADMIN_API_KEY: 'api-key',
    SUB2API_TIMEOUT_MS: '10000',
    DEFAULT_CHECKIN_ENABLED: 'true',
    DEFAULT_DAILY_REWARD: '10',
    DEFAULT_TIMEZONE: 'Asia/Shanghai',
    BOOTSTRAP_ADMIN_SUBJECTS: ''
  };
}

async function createTestApp() {
  const { authRouter } = await import('./auth-routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({
      code: 500,
      message: 'INTERNAL_ERROR',
      detail: error instanceof Error ? error.message : 'unknown error'
    });
  });
  return app;
}

describe('authRouter', () => {
  beforeEach(() => {
    applyBaseEnv();
    vi.resetModules();
    mockConsumeArtifact.mockReset();
    mockHasAdminSubject.mockReset();
    mockIssueArtifact.mockReset();
    mockRevokeToken.mockReset();
    mockSessionService.sign.mockReset();
    mockSub2apiClient.findUserBySyntheticEmail.mockReset();
    mockLinuxDoOAuthService.exchangeCode.mockReset();
    mockLinuxDoOAuthService.fetchUserInfo.mockReset();

    mockConsumeArtifact.mockResolvedValue('consumed');
    mockIssueArtifact.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('GET /linuxdo/start 会创建一次性 state 工件并跳转到 OAuth 授权页', async () => {
    const app = await createTestApp();
    const response = await request(app).get('/api/auth/linuxdo/start?redirect=/admin');

    expect(response.status).toBe(302);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(mockIssueArtifact).toHaveBeenCalledTimes(1);
    expect(response.headers.location).toContain('https://example.com/oauth/authorize');
    expect(response.headers.location).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A8787%2Fapi%2Fauth%2Flinuxdo%2Fcallback');
  });

  it('GET /linuxdo/callback 会拒绝已使用的 state', async () => {
    const { signOAuthState } = await import('../utils/oauth.js');
    const signedState = signOAuthState(
      {
        state: 'oauth-state-id',
        codeVerifier: 'verifier',
        redirectPath: '/admin',
        issuedAt: Date.now()
      },
      process.env.WELFARE_JWT_SECRET!
    );
    mockConsumeArtifact.mockResolvedValue('used');

    const app = await createTestApp();
    const response = await request(app)
      .get('/api/auth/linuxdo/callback')
      .query({ code: 'oauth-code', state: signedState });

    expect(response.status).toBe(302);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.location).toContain('/welfare/auth/callback#error=state_used');
  });

  it('POST /session-handoff/exchange 会返回 no-store 并换取 token', async () => {
    const { signSessionHandoff } = await import('../utils/oauth.js');
    const handoff = signSessionHandoff(
      {
        handoffId: 'handoff-id',
        token: 'session-token',
        redirectPath: '/admin',
        issuedAt: Date.now()
      },
      process.env.WELFARE_JWT_SECRET!
    );

    const app = await createTestApp();
    const response = await request(app)
      .post('/api/auth/session-handoff/exchange')
      .send({ handoff });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(mockConsumeArtifact).toHaveBeenCalledWith('handoff-id', 'session_handoff');
    expect(response.body.data).toEqual({
      session_token: 'session-token',
      redirect: '/admin'
    });
  });

  it('POST /session-handoff/exchange 会拒绝重复使用的 handoff', async () => {
    const { signSessionHandoff } = await import('../utils/oauth.js');
    const handoff = signSessionHandoff(
      {
        handoffId: 'handoff-id',
        token: 'session-token',
        redirectPath: '/admin',
        issuedAt: Date.now()
      },
      process.env.WELFARE_JWT_SECRET!
    );
    mockConsumeArtifact.mockResolvedValue('used');

    const app = await createTestApp();
    const response = await request(app)
      .post('/api/auth/session-handoff/exchange')
      .send({ handoff });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('HANDOFF_ALREADY_USED');
  });

  it('GET /me 返回当前登录用户与管理员标记', async () => {
    mockHasAdminSubject.mockResolvedValue(true);

    const app = await createTestApp();
    const response = await request(app).get('/api/auth/me');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data.is_admin).toBe(true);
    expect(response.body.data.linuxdo_subject).toBe('subject');
  });

  it('POST /logout 会撤销当前 token', async () => {
    const app = await createTestApp();
    const response = await request(app).post('/api/auth/logout');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(mockRevokeToken).toHaveBeenCalledWith('token-id', 1_900_000_000_000);
  });
});
