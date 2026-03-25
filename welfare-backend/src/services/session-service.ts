import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { SessionUser, VerifiedSession } from '../types/domain.js';
import { config } from '../config.js';
import { randomBase64Url } from '../utils/oauth.js';

interface SessionClaims {
  uid: number;
  subid: string;
  semail: string;
  uname: string;
  ava: string | null;
}

type DecodedSessionClaims = jwt.JwtPayload & SessionClaims;

function getLegacyTokenId(token: string): string {
  return `legacy:${crypto.createHash('sha256').update(token).digest('hex')}`;
}

export class SessionService {
  sign(user: SessionUser): string {
    const expiresIn = config.WELFARE_JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'];
    return jwt.sign(
      {
        uid: user.sub2apiUserId,
        subid: user.linuxdoSubject,
        semail: user.syntheticEmail,
        uname: user.username,
        ava: user.avatarUrl ?? null
      } satisfies SessionClaims,
      config.WELFARE_JWT_SECRET,
      {
        expiresIn,
        jwtid: randomBase64Url(18)
      }
    );
  }

  verify(token: string): SessionUser {
    return this.verifySession(token).user;
  }

  verifySession(token: string): VerifiedSession {
    const decoded = jwt.verify(token, config.WELFARE_JWT_SECRET) as DecodedSessionClaims;

    if (
      typeof decoded.uid !== 'number' ||
      typeof decoded.subid !== 'string' ||
      typeof decoded.semail !== 'string' ||
      typeof decoded.uname !== 'string' ||
      (decoded.ava !== null && typeof decoded.ava !== 'string') ||
      typeof decoded.exp !== 'number'
    ) {
      throw new Error('session token claims invalid');
    }

    return {
      user: {
        sub2apiUserId: decoded.uid,
        linuxdoSubject: decoded.subid,
        syntheticEmail: decoded.semail,
        username: decoded.uname,
        avatarUrl: decoded.ava ?? null
      },
      tokenId:
        typeof decoded.jti === 'string' && decoded.jti.trim() !== ''
          ? decoded.jti
          : getLegacyTokenId(token),
      expiresAtMs: decoded.exp * 1000
    };
  }
}

export const sessionService = new SessionService();
