import type { SessionUser } from './domain.js';

declare global {
  namespace Express {
    interface Request {
      sessionUser?: SessionUser;
      sessionToken?: string;
      sessionTokenId?: string;
      sessionTokenExpiresAtMs?: number;
    }
  }
}

export {};

