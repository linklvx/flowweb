import { Controller, Get, Req } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  async getMe(@Req() req: any) {
    const session = await this.authService.getSession(req.headers);
    if (!session) return { user: null };
    return { user: session.user };
  }
}
