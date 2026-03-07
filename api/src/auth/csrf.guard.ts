import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Double-submit cookie CSRF protection.
 *
 * For cookie-authenticated endpoints, require:
 * - Cookie: csrf_token=<value>
 * - Header: x-csrf-token: <same value>
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();

    const cookies = req.cookies as unknown as
      | Record<string, string>
      | undefined;
    const cookieToken = cookies?.csrf_token;
    const headerToken = req.header('x-csrf-token');

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw new UnauthorizedException('CSRF token missing/invalid');
    }

    return true;
  }
}
