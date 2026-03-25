import type { Pool } from 'pg';

export class SessionRepository {
  constructor(private readonly db: Pool) {}

  async purgeExpiredTokens(): Promise<number> {
    const result = await this.db.query(
      `DELETE FROM welfare_revoked_tokens
       WHERE expires_at <= NOW()`
    );

    return result.rowCount ?? 0;
  }

  async revokeToken(tokenId: string, expiresAtMs: number): Promise<void> {
    await this.db.query(
      `INSERT INTO welfare_revoked_tokens (token_id, expires_at)
       VALUES ($1, TO_TIMESTAMP($2 / 1000.0))
       ON CONFLICT (token_id) DO NOTHING`,
      [tokenId, expiresAtMs]
    );
  }

  async isTokenRevoked(tokenId: string): Promise<boolean> {
    const result = await this.db.query(
      `SELECT 1
       FROM welfare_revoked_tokens
       WHERE token_id = $1
         AND expires_at > NOW()
       LIMIT 1`,
      [tokenId]
    );

    return (result.rowCount ?? 0) > 0;
  }
}
