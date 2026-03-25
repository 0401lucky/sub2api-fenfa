import type { NextFunction, Request, Response } from 'express';
import { sessionService } from '../services/session-service.js';
import { sessionStateService } from '../services/session-state-service.js';

function extractToken(req: Request): string | null {
  const authHeader = req.header('Authorization')?.trim();
  if (authHeader) {
    const [scheme, token] = authHeader.split(/\s+/);
    if (scheme?.toLowerCase() === 'bearer' && token) {
      return token;
    }
  }
  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({
      code: 401,
      message: 'UNAUTHORIZED',
      detail: '请先登录'
    });
    return;
  }

  const verifiedSession = (() => {
    try {
      return sessionService.verifySession(token);
    } catch {
      res.status(401).json({
        code: 401,
        message: 'INVALID_TOKEN',
        detail: '登录已失效，请重新登录'
      });
      return null;
    }
  })();

  if (!verifiedSession) {
    return;
  }

  void sessionStateService
    .isTokenRevoked(verifiedSession.tokenId)
    .then((isRevoked) => {
      if (isRevoked) {
        res.status(401).json({
          code: 401,
          message: 'REVOKED_TOKEN',
          detail: '当前登录已退出，请重新登录'
        });
        return;
      }

      req.sessionUser = verifiedSession.user;
      req.sessionToken = token;
      req.sessionTokenId = verifiedSession.tokenId;
      req.sessionTokenExpiresAtMs = verifiedSession.expiresAtMs;
      next();
    })
    .catch(next);
}
