import { authArtifactService, AuthArtifactService } from './auth-artifact-service.js';
import { sessionStateService, SessionStateService } from './session-state-service.js';

interface LoggerLike {
  info(message: string): void;
  error(message: string, error?: unknown): void;
}

export class SessionMaintenanceService {
  constructor(
    private readonly sessionState: Pick<SessionStateService, 'purgeExpiredTokens'>,
    private readonly authArtifacts: Pick<AuthArtifactService, 'purgeExpiredArtifacts'>,
    private readonly logger: LoggerLike
  ) {}

  async runCleanup(): Promise<{ revokedTokens: number; authArtifacts: number }> {
    const [revokedTokens, authArtifacts] = await Promise.all([
      this.sessionState.purgeExpiredTokens(),
      this.authArtifacts.purgeExpiredArtifacts()
    ]);

    if (revokedTokens > 0) {
      this.logger.info(`[session] 已清理 ${revokedTokens} 条过期撤销 token`);
    }
    if (authArtifacts > 0) {
      this.logger.info(`[auth] 已清理 ${authArtifacts} 条过期一次性鉴权工件`);
    }

    return {
      revokedTokens,
      authArtifacts
    };
  }

  startCleanupLoop(intervalMs: number): NodeJS.Timeout {
    const run = async () => {
      try {
        await this.runCleanup();
      } catch (error) {
        this.logger.error('[security] 清理安全工件失败', error);
      }
    };

    void run();
    const timer = setInterval(() => {
      void run();
    }, intervalMs);
    timer.unref?.();
    return timer;
  }
}

export const sessionMaintenanceService = new SessionMaintenanceService(
  sessionStateService,
  authArtifactService,
  console
);
