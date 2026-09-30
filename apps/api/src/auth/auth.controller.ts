import { Controller, Post, Get, Patch, Req, Body, Res, UsePipes, ValidationPipe, Inject } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimiterService } from '../common/services/rate-limiter.service';
import { parseSessionToken } from '../common/utils/parse-session-token';
import { SmsService } from '../modules/sms/sms.service';
import { SendSmsCodeDto } from './dto/send-sms-code.dto';
import { PhoneLoginDto } from './dto/phone-login.dto';
import { SESSION_COOKIE_OPTIONS } from './auth';
import { bootstrapPersonalTeam } from '../modules/team/team.bootstrap';
import type { Response } from 'express';
import Redis from 'ioredis';

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
    private readonly rateLimiter: RateLimiterService,
    private readonly smsService: SmsService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  @Post('sign-in')
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 批0c-8：登录端点收紧（防爆破；全局 300/min 见 app.module）
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

      res.cookie('flowweb.session_token', result.token, COOKIE_OPTIONS);
      return res.json({ user: result.user });
    } catch {
      return res.status(400).json({ error: '注册失败' });
    }
  }

  @Post('sign-out')
  async signOut(@Req() req: any, @Res() res: Response) {
    const token = parseSessionToken(req.headers.cookie);
    if (token) {
      await this.authService.signOut(token);
    }
    res.clearCookie('flowweb.session_token', { path: '/' });
    return res.json({ success: true });
  }

  @Get('me')
  async getMe(@Req() req: any, @Res() res: Response) {
    const cookieStr: string = req.headers.cookie || '';
    const session = await this.authService.getSession({ cookie: cookieStr });
    if (!session) return res.json({ user: null });

    // 补偿个人团队（幂等，含素材文件夹）
    try {
      await bootstrapPersonalTeam(this.prisma, session.user.id, session.user.name);
    } catch { /* 非致命 */ }

    return res.json({ user: session.user });
  }

  @Post('send-sms-code')
  async sendSmsCode(
    @Body() dto: SendSmsCodeDto,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const e164 = '+86' + dto.phone;
    const clientIp = this.rateLimiter.getClientIp(req);

    if (!(await this.rateLimiter.checkIpRateLimit(clientIp, 'sms:send', 3600, 20))) {
      return res.status(429).json({
        error: '请求过于频繁，请稍后再试', code: 'IP_RATE_LIMITED',
      });
    }

    if (!(await this.rateLimiter.checkPhoneRateLimit(e164))) {
      return res.status(429).json({
        error: '发送过于频繁，请60秒后再试', code: 'PHONE_RATE_LIMITED',
      });
    }

    const code = this.smsService.generateOtp();
    await this.smsService.storeOtp(e164, code);

    try {
      await this.smsService.sendSms(e164, code);
      return res.json({ success: true });
    } catch {
      await this.rateLimiter.releasePhoneLock(e164);
      await this.smsService.deleteOtp(e164);
      return res.status(502).json({ error: '短信发送失败，请稍后再试' });
    }
  }

  @Post('phone-login')
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 批0c-8：登录端点收紧（防爆破；全局 300/min 见 app.module）
  async phoneLogin(
    @Body() dto: PhoneLoginDto,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const e164 = '+86' + dto.phone;
    const clientIp = this.rateLimiter.getClientIp(req);

    if (!(await this.rateLimiter.checkIpRateLimit(clientIp, 'sms:verify', 60, 10))) {
      return res.status(429).json({
        error: '请求过于频繁，请稍后再试', code: 'IP_RATE_LIMITED',
      });
    }

    try {
      const result = await this.authService.phoneLogin(e164, dto.code);
      res.cookie('flowweb.session_token', result.token, SESSION_COOKIE_OPTIONS);
      return res.json({ user: result.user });
    } catch {
      const reason = await this.redis.get(`sms:{${e164}}:last_error`);
      await this.redis.del(`sms:{${e164}}:last_error`);

      switch (reason) {
        case 'NOT_FOUND':
          return res.status(400).json({ error: '请先获取验证码', code: 'OTP_NOT_FOUND' });
        case 'WRONG':
          return res.status(400).json({ error: '验证码错误', code: 'INVALID_OTP' });
        case 'TOO_MANY':
          return res.status(403).json({ error: '错误次数过多，请重新获取验证码', code: 'TOO_MANY_ATTEMPTS' });
        default:
          return res.status(400).json({ error: '验证失败，请重试', code: 'VERIFICATION_FAILED' });
      }
    }
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
