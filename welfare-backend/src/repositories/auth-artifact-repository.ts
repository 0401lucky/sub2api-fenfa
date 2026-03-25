import type { Pool } from 'pg';

export type AuthArtifactType = 'oauth_state' | 'session_handoff';

interface AuthArtifactRecord {
  artifactId: string;
  artifactType: AuthArtifactType;
  expiresAt: string;
  consumedAt: string | null;
}

export class AuthArtifactRepository {
  constructor(private readonly db: Pool) {}

  async createArtifact(input: {
    artifactId: string;
    artifactType: AuthArtifactType;
    expiresAtMs: number;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO welfare_auth_artifacts (artifact_id, artifact_type, expires_at)
       VALUES ($1, $2, TO_TIMESTAMP($3 / 1000.0))`,
      [input.artifactId, input.artifactType, input.expiresAtMs]
    );
  }

  async findArtifact(
    artifactId: string,
    artifactType: AuthArtifactType
  ): Promise<AuthArtifactRecord | null> {
    const result = await this.db.query(
      `SELECT artifact_id, artifact_type, expires_at, consumed_at
       FROM welfare_auth_artifacts
       WHERE artifact_id = $1 AND artifact_type = $2
       LIMIT 1`,
      [artifactId, artifactType]
    );

    if ((result.rowCount ?? 0) === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      artifactId: String(row.artifact_id),
      artifactType: String(row.artifact_type) as AuthArtifactType,
      expiresAt: String(row.expires_at),
      consumedAt: row.consumed_at ? String(row.consumed_at) : null
    };
  }

  async consumeActiveArtifact(
    artifactId: string,
    artifactType: AuthArtifactType
  ): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE welfare_auth_artifacts
       SET consumed_at = NOW(),
           expires_at = NOW()
       WHERE artifact_id = $1
         AND artifact_type = $2
         AND consumed_at IS NULL
         AND expires_at > NOW()`,
      [artifactId, artifactType]
    );

    return (result.rowCount ?? 0) > 0;
  }

  async purgeExpiredArtifacts(): Promise<number> {
    const result = await this.db.query(
      `DELETE FROM welfare_auth_artifacts
       WHERE expires_at <= NOW()`
    );

    return result.rowCount ?? 0;
  }
}
