import { Controller, Post, Get, Patch, Req, Body, Res, UsePipes, ValidationPipe } from '@nestjs/common';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_FOLDER_NAMES } from '../modules/material-library/constants/material-library.constants';
import type { Response } from 'express';

const COOKIE_OPTIONS = {
  httpOnly: true,
  path: '/',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('sign-in')
  async signIn(
    @Body() body: { email: string; password: string },
    @Res() res: Response,
  ) {
    try {
      const result = await this.authService.signIn(body.email, body.password);
      res.cookie('flowweb.session_token', result.token, COOKIE_OPTIONS);
      return res.json({ user: result.user });
    } catch {
      return res.status(401).json({ error: '邮箱或密码错误' });
    }
  }

  @Post('sign-up')
  async signUp(
    @Body() body: { email: string; password: string; name: string },
    @Res() res: Response,
  ) {
    try {
      const result = await this.authService.signUp(body.email, body.password, body.name);

      // Create default material folders
      try {
        await this.prisma.materialFolder.createMany({
          data: DEFAULT_FOLDER_NAMES.map((name, index) => ({
            name,
            userId: result.user.id,
            isDefault: true,
            sortOrder: index,
          })),
        });
      } catch {
        // Non-fatal — user can still use the app, folders can be created later
      }

      res.cookie('flowweb.session_token', result.token, COOKIE_OPTIONS);
      return res.json({ user: result.user });
    } catch {
      return res.status(400).json({ error: '注册失败' });
    }
  }

  @Post('sign-out')
  async signOut(@Req() req: any, @Res() res: Response) {
    const cookieStr: string = req.headers.cookie || '';
    const match = cookieStr.match(/flowweb\.session_token=([^;]+)/);
    if (match) {
      await this.authService.signOut(match[1]);
    }
    res.clearCookie('flowweb.session_token', { path: '/' });
    return res.json({ success: true });
  }

  @Get('me')
  async getMe(@Req() req: any, @Res() res: Response) {
    const cookieStr: string = req.headers.cookie || '';
    const session = await this.authService.getSession({ cookie: cookieStr });
    if (!session) return res.json({ user: null });
    return res.json({ user: session.user });
  }

  @Patch('me')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async updateMe(
    @Req() req: any,
    @Body() dto: UpdateProfileDto,
    @Res() res: Response,
  ) {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: '未登录' }
    });
    try {
      const result = await this.authService.updateProfile(
        req.headers.cookie || '',
        dto
      );
      return res.json({
        success: true,
        data: { user: (result as any).user }
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '更新失败';
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message }
      });
    }
  }
}
