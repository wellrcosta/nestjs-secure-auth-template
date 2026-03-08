import crypto from 'node:crypto';

import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { Response } from 'express';
import * as argon2 from 'argon2';

import { PrismaService } from '../prisma/prisma.service';

import type { JwtPayload } from './jwt.strategy';

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: { email: string; password: string }) {
    const emailNorm = normalizeEmail(dto.email);

    const passwordHash = await argon2.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        emailNorm,
        passwordHash,
      },
      select: { id: true, email: true, createdAt: true },
    });

    await this.audit({
      action: 'AUTH_REGISTER',
      outcome: 'SUCCESS',
      userId: user.id,
    });

    return { user };
  }

  async login(input: {
    email: string;
    password: string;
    deviceId?: string;
    userAgent?: string;
    ip?: string;
  }) {
    const emailNorm = normalizeEmail(input.email);

    const user = await this.prisma.user.findUnique({
      where: { emailNorm },
    });

    if (!user) {
      await this.audit({
        action: 'AUTH_LOGIN',
        outcome: 'FAILURE',
        ip: input.ip,
        userAgent: input.userAgent,
        details: { reason: 'invalid_email' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'ACTIVE') {
      await this.audit({
        action: 'AUTH_LOGIN',
        outcome: 'FAILURE',
        userId: user.id,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { reason: 'user_disabled' },
      });
      throw new ForbiddenException('User disabled');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.audit({
        action: 'AUTH_LOGIN',
        outcome: 'FAILURE',
        userId: user.id,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { reason: 'user_locked' },
      });
      throw new ForbiddenException('User temporarily locked');
    }

    const ok = await argon2.verify(user.passwordHash, input.password);
    if (!ok) {
      const failed = user.failedLoginAttempts + 1;
      const maxAttempts = 8;
      const lockMinutes = 10;

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: failed,
          lockedUntil:
            failed >= maxAttempts
              ? new Date(Date.now() + lockMinutes * 60_000)
              : null,
        },
      });

      await this.audit({
        action: 'AUTH_LOGIN',
        outcome: 'FAILURE',
        userId: user.id,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { reason: 'invalid_password' },
      });

      throw new UnauthorizedException('Invalid credentials');
    }

    // reset counters
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        deviceId: input.deviceId,
        userAgent: input.userAgent,
        ip: input.ip,
      },
      select: { id: true },
    });

    const accessToken = await this.signAccessToken({
      sub: user.id,
      sid: session.id,
      email: user.email,
    });

    const { refreshToken, refreshTokenHash, expiresAt } =
      this.issueRefreshToken();

    await this.prisma.refreshToken.create({
      data: {
        sessionId: session.id,
        tokenHash: refreshTokenHash,
        expiresAt,
      },
    });

    const csrfToken = randomToken(24);

    await this.audit({
      action: 'AUTH_LOGIN',
      outcome: 'SUCCESS',
      userId: user.id,
      sessionId: session.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return {
      accessToken,
      refreshToken,
      csrfToken,
      user: { id: user.id, email: user.email },
    };
  }

  async refresh(input: {
    refreshToken?: string;
    csrfToken?: string;
    userAgent?: string;
    ip?: string;
  }) {
    if (!input.refreshToken)
      throw new UnauthorizedException('Missing refresh token');

    const hash = this.hashRefreshToken(input.refreshToken);

    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
      include: {
        session: {
          include: { user: true },
        },
      },
    });

    if (!token) {
      await this.audit({
        action: 'AUTH_REFRESH',
        outcome: 'FAILURE',
        ip: input.ip,
        userAgent: input.userAgent,
        details: { reason: 'token_not_found' },
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    // session revoked
    if (token.session.revokedAt) {
      await this.audit({
        action: 'AUTH_REFRESH',
        outcome: 'FAILURE',
        userId: token.session.userId,
        sessionId: token.sessionId,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { reason: 'session_revoked' },
      });
      throw new UnauthorizedException('Session revoked');
    }

    // reuse detection
    if (token.revokedAt) {
      await this.revokeSession(token.sessionId);
      await this.audit({
        action: 'AUTH_REFRESH',
        outcome: 'FAILURE',
        userId: token.session.userId,
        sessionId: token.sessionId,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { reason: 'refresh_reuse_detected' },
      });
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    if (token.expiresAt <= new Date()) {
      await this.prisma.refreshToken.update({
        where: { id: token.id },
        data: { revokedAt: new Date() },
      });
      await this.audit({
        action: 'AUTH_REFRESH',
        outcome: 'FAILURE',
        userId: token.session.userId,
        sessionId: token.sessionId,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { reason: 'token_expired' },
      });
      throw new UnauthorizedException('Refresh token expired');
    }

    if (token.session.user.status !== 'ACTIVE') {
      throw new ForbiddenException('User disabled');
    }

    // rotate
    const { refreshToken, refreshTokenHash, expiresAt } =
      this.issueRefreshToken();

    const newToken = await this.prisma.refreshToken.create({
      data: {
        sessionId: token.sessionId,
        tokenHash: refreshTokenHash,
        expiresAt,
      },
      select: { id: true },
    });

    await this.prisma.refreshToken.update({
      where: { id: token.id },
      data: {
        revokedAt: new Date(),
        replacedById: newToken.id,
      },
    });

    await this.prisma.session.update({
      where: { id: token.sessionId },
      data: {
        lastSeenAt: new Date(),
        userAgent: input.userAgent,
        ip: input.ip,
      },
    });

    const accessToken = await this.signAccessToken({
      sub: token.session.userId,
      sid: token.sessionId,
      email: token.session.user.email,
    });

    const csrfToken = randomToken(24);

    await this.audit({
      action: 'AUTH_REFRESH',
      outcome: 'SUCCESS',
      userId: token.session.userId,
      sessionId: token.sessionId,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return { accessToken, refreshToken, csrfToken };
  }

  async logout(input: {
    refreshToken?: string;
    ip?: string;
    userAgent?: string;
  }) {
    if (!input.refreshToken) return;
    const hash = this.hashRefreshToken(input.refreshToken);

    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
      include: { session: true },
    });

    if (!token) return;

    await this.prisma.refreshToken.update({
      where: { id: token.id },
      data: { revokedAt: new Date() },
    });

    await this.audit({
      action: 'AUTH_LOGOUT',
      outcome: 'SUCCESS',
      userId: token.session.userId,
      sessionId: token.sessionId,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }

  async logoutAll(input: {
    refreshToken?: string;
    ip?: string;
    userAgent?: string;
  }) {
    if (!input.refreshToken) return;
    const hash = this.hashRefreshToken(input.refreshToken);

    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
      include: { session: true },
    });

    if (!token) return;

    await this.prisma.session.updateMany({
      where: {
        userId: token.session.userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    await this.prisma.refreshToken.updateMany({
      where: {
        session: { userId: token.session.userId },
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    await this.audit({
      action: 'AUTH_LOGOUT_ALL',
      outcome: 'SUCCESS',
      userId: token.session.userId,
      sessionId: token.sessionId,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }

  async listSessions(userId?: string) {
    if (!userId) throw new UnauthorizedException();

    const sessions = await this.prisma.session.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        deviceId: true,
        userAgent: true,
        ip: true,
        lastSeenAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });

    return { sessions };
  }

  setAuthCookies(res: Response, refreshToken: string, csrfToken: string) {
    const secure = this.config.get('COOKIE_SECURE') === 'true';
    const domain = this.config.get<string>('COOKIE_DOMAIN') || undefined;
    const sameSite = (this.config.get<string>('COOKIE_SAMESITE') ?? 'lax') as
      | 'lax'
      | 'strict'
      | 'none';

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure,
      sameSite,
      domain,
      path: '/auth',
    });

    // CSRF cookie must be readable by the frontend JS on any route.
    // If we scope it to /auth, `document.cookie` won't include it on `/`.
    //
    // Also: we explicitly clear any legacy csrf_token cookie scoped to `/auth`
    // to avoid having two cookies with the same name but different paths.
    res.cookie('csrf_token', csrfToken, {
      httpOnly: false,
      secure,
      sameSite,
      domain,
      path: '/',
    });

    // Clear legacy cookie if present
    res.clearCookie('csrf_token', { path: '/auth' });
  }

  clearAuthCookies(res: Response) {
    res.clearCookie('refresh_token', { path: '/auth' });

    // Clear both paths to be safe
    res.clearCookie('csrf_token', { path: '/' });
    res.clearCookie('csrf_token', { path: '/auth' });
  }

  private issueRefreshToken() {
    const refreshToken = randomToken(48);
    const refreshTokenHash = this.hashRefreshToken(refreshToken);
    const days = 30;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    return { refreshToken, refreshTokenHash, expiresAt };
  }

  private hashRefreshToken(token: string) {
    const pepper = this.config.getOrThrow<string>('REFRESH_TOKEN_PEPPER');
    return crypto
      .createHash('sha256')
      .update(token)
      .update(pepper)
      .digest('hex');
  }

  private async signAccessToken(payload: JwtPayload) {
    const ttlSeconds = Number(this.config.get('JWT_ACCESS_TTL_SECONDS') ?? 900);

    return this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: ttlSeconds,
    });
  }

  async revokeSessionById(input: {
    userId?: string;
    sessionId: string;
    currentSessionId?: string;
    ip?: string;
    userAgent?: string;
  }) {
    if (!input.userId) throw new UnauthorizedException();

    const session = await this.prisma.session.findUnique({
      where: { id: input.sessionId },
      select: { id: true, userId: true, revokedAt: true },
    });

    if (!session || session.userId !== input.userId) {
      throw new UnauthorizedException();
    }

    if (!session.revokedAt) {
      await this.revokeSession(session.id);

      await this.audit({
        action: 'SESSION_REVOKE',
        outcome: 'SUCCESS',
        userId: input.userId,
        sessionId: session.id,
        ip: input.ip,
        userAgent: input.userAgent,
        details: {
          revokedSessionId: session.id,
          bySessionId: input.currentSessionId,
        },
      });
    }
  }

  private async revokeSession(sessionId: string) {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });

    await this.prisma.refreshToken.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async audit(input: {
    action:
      | 'AUTH_REGISTER'
      | 'AUTH_LOGIN'
      | 'AUTH_REFRESH'
      | 'AUTH_LOGOUT'
      | 'AUTH_LOGOUT_ALL'
      | 'SESSION_REVOKE'
      | 'PASSWORD_CHANGE';
    outcome: 'SUCCESS' | 'FAILURE';
    userId?: string;
    sessionId?: string;
    ip?: string;
    userAgent?: string;
    details?: Prisma.InputJsonValue;
  }) {
    await this.prisma.auditLog.create({
      data: {
        action: input.action,
        outcome: input.outcome,
        userId: input.userId,
        sessionId: input.sessionId,
        ip: input.ip,
        userAgent: input.userAgent,
        details: input.details,
      },
    });
  }
}
