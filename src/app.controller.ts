import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/public.decorator';

@Controller()
@Public()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Unauthenticated root ping (AUTH-01.4); not a feature route.
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
