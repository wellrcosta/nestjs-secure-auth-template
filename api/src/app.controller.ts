import { Controller, Get, Redirect } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';

import { Public } from './common/public.decorator';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get('health')
  health() {
    return this.appService.getHello();
  }

  @ApiExcludeEndpoint()
  @Get()
  @Redirect('/docs', 302)
  root() {
    return;
  }
}
