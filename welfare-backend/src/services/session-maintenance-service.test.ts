import { beforeEach, describe, expect, it, vi } from 'vitest';

const { purgeExpiredTokens, purgeExpiredArtifacts } = vi.hoisted(() => ({
  purgeExpiredTokens: vi.fn(),
  purgeExpiredArtifacts: vi.fn()
}));

vi.mock('./session-state-service.js', () => ({
  sessionStateService: {
    purgeExpiredTokens
  }
}));

vi.mock('./auth-artifact-service.js', () => ({
  authArtifactService: {
    purgeExpiredArtifacts
  }
}));

describe('SessionMaintenanceService', () => {
  const logger = {
    info: vi.fn(),
    error: vi.fn()
  };

  beforeEach(() => {
    purgeExpiredTokens.mockReset();
    purgeExpiredArtifacts.mockReset();
    logger.info.mockReset();
    logger.error.mockReset();
    vi.useRealTimers();
  });

  it('runCleanup 会清理过期 token 和鉴权工件并记录日志', async () => {
    const { SessionMaintenanceService } = await import('./session-maintenance-service.js');
    purgeExpiredTokens.mockResolvedValue(3);
    purgeExpiredArtifacts.mockResolvedValue(2);
    const service = new SessionMaintenanceService(
      { purgeExpiredTokens },
      { purgeExpiredArtifacts },
      logger
    );

    const removed = await service.runCleanup();

    expect(removed).toEqual({
      revokedTokens: 3,
      authArtifacts: 2
    });
    expect(logger.info).toHaveBeenCalledWith('[session] 已清理 3 条过期撤销 token');
    expect(logger.info).toHaveBeenCalledWith('[auth] 已清理 2 条过期一次性鉴权工件');
  });

  it('startCleanupLoop 会立即执行一次并按间隔继续调度', async () => {
    const { SessionMaintenanceService } = await import('./session-maintenance-service.js');
    vi.useFakeTimers();
    purgeExpiredTokens.mockResolvedValue(0);
    purgeExpiredArtifacts.mockResolvedValue(0);
    const service = new SessionMaintenanceService(
      { purgeExpiredTokens },
      { purgeExpiredArtifacts },
      logger
    );

    service.startCleanupLoop(5_000);
    await vi.runAllTicks();

    expect(purgeExpiredTokens).toHaveBeenCalledTimes(1);
    expect(purgeExpiredArtifacts).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(purgeExpiredTokens).toHaveBeenCalledTimes(2);
    expect(purgeExpiredArtifacts).toHaveBeenCalledTimes(2);
  });
});
