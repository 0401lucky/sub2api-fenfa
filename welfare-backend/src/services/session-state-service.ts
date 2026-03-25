import { pool } from '../db.js';
import { SessionRepository } from '../repositories/session-repository.js';

export class SessionStateService {
  constructor(
    private readonly repository: Pick<
      SessionRepository,
      'purgeExpiredTokens' | 'revokeToken' | 'isTokenRevoked'
    >
  ) {}

  async purgeExpiredTokens(): Promise<number> {
    return this.repository.purgeExpiredTokens();
  }

  async revokeToken(tokenId: string, expiresAtMs: number): Promise<void> {
    await this.repository.revokeToken(tokenId, expiresAtMs);
  }

  async isTokenRevoked(tokenId: string): Promise<boolean> {
    return this.repository.isTokenRevoked(tokenId);
  }
}

const repository = new SessionRepository(pool);

export const sessionStateService = new SessionStateService(repository);
