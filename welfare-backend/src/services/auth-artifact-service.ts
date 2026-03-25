import { pool } from '../db.js';
import {
  AuthArtifactRepository,
  type AuthArtifactType
} from '../repositories/auth-artifact-repository.js';

export type ConsumeArtifactResult = 'consumed' | 'missing' | 'used' | 'expired';

function isExpired(expiresAt: string): boolean {
  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
}

export class AuthArtifactService {
  constructor(
    private readonly repository: Pick<
      AuthArtifactRepository,
      'createArtifact' | 'findArtifact' | 'consumeActiveArtifact' | 'purgeExpiredArtifacts'
    >
  ) {}

  async issueArtifact(input: {
    artifactId: string;
    artifactType: AuthArtifactType;
    expiresAtMs: number;
  }): Promise<void> {
    await this.repository.createArtifact(input);
  }

  async consumeArtifact(
    artifactId: string,
    artifactType: AuthArtifactType
  ): Promise<ConsumeArtifactResult> {
    const current = await this.repository.findArtifact(artifactId, artifactType);
    if (!current) {
      return 'missing';
    }

    if (current.consumedAt) {
      return 'used';
    }

    if (isExpired(current.expiresAt)) {
      return 'expired';
    }

    const consumed = await this.repository.consumeActiveArtifact(artifactId, artifactType);
    return consumed ? 'consumed' : 'used';
  }

  async purgeExpiredArtifacts(): Promise<number> {
    return this.repository.purgeExpiredArtifacts();
  }
}

const repository = new AuthArtifactRepository(pool);

export const authArtifactService = new AuthArtifactService(repository);
