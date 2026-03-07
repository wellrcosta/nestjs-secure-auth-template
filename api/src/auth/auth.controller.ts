import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Public } from '../common/public.decorator';

import { CsrfGuard } from './csrf.guard';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await this.auth.login({
      email: dto.email,
      password: dto.password,
      deviceId: dto.deviceId,
      userAgent: req.get('user-agent') ?? undefined,
      ip: req.ip,
    });

    this.auth.setAuthCookies(res, result.refreshToken, result.csrfToken);

    return res.json({
      access_token: result.accessToken,
      user: result.user,
    });
  }

  @Public()
  @UseGuards(CsrfGuard)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res() res: Response) {
    const cookies = req.cookies as unknown as
      | Record<string, string>
      | undefined;
    const refreshToken = cookies?.refresh_token;
    const csrfToken = cookies?.csrf_token;

    const result = await this.auth.refresh({
      refreshToken,
      csrfToken,
      userAgent: req.get('user-agent') ?? undefined,
      ip: req.ip,
    });

    this.auth.setAuthCookies(res, result.refreshToken, result.csrfToken);

    return res.json({
      access_token: result.accessToken,
    });
  }

  @UseGuards(CsrfGuard)
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res() res: Response) {
    const cookies = req.cookies as unknown as
      | Record<string, string>
      | undefined;
    const refreshToken = cookies?.refresh_token;
    await this.auth.logout({
      refreshToken,
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
    this.auth.clearAuthCookies(res);
    return res.send();
  }

  @UseGuards(CsrfGuard)
  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(@Req() req: Request, @Res() res: Response) {
    const cookies = req.cookies as unknown as
      | Record<string, string>
      | undefined;
    const refreshToken = cookies?.refresh_token;
    await this.auth.logoutAll({
      refreshToken,
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
    this.auth.clearAuthCookies(res);
    return res.send();
  }

  @ApiBearerAuth()
  @Get('sessions')
  async listSessions(@Req() req: Request) {
    const payload = (req as Request & { user?: { sub: string; sid: string } })
      .user;
    return this.auth.listSessions(payload?.sub);
  }

  @ApiBearerAuth()
  @ApiParam({ name: 'sessionId', type: String })
  @Delete('sessions/:sessionId')
  @HttpCode(204)
  async revokeSession(
    @Req() req: Request,
    @Param('sessionId') sessionId: string,
    @Res() res: Response,
  ) {
    const payload = (req as Request & { user?: { sub: string; sid: string } })
      .user;

    await this.auth.revokeSessionById({
      userId: payload?.sub,
      sessionId,
      currentSessionId: payload?.sid,
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });

    return res.send();
  }
}
