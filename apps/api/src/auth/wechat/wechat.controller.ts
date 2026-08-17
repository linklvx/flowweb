import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { WechatService } from './wechat.service';
import { SESSION_COOKIE_OPTIONS } from '../auth';

@Controller('api/auth/wechat')
export class WechatController {
  constructor(private readonly wechatService: WechatService) {}

  @Get('config')
  async config(@Res() res: Response) {
    return res.json({ appid: process.env.WECHAT_APP_ID || '' });
  }

  @Get('callback')
  async callback(@Query() query: Record<string, string>, @Res() res: Response) {
    const { code } = query;
    try {
      const { openid, unionid, accessToken } = await this.wechatService.getAccessToken(code);
      const { nickname, headimgurl } = await this.wechatService.getUserInfo(accessToken, openid);
      const user = await this.wechatService.findOrCreateUser({ openid, unionid, nickname, headimgurl });
      const { token } = await this.wechatService.createSession(user.id);
      res.cookie('flowweb.session_token', token, SESSION_COOKIE_OPTIONS);
      return res.redirect('/canvas');
    } catch {
      return res.redirect('/login?error=wechat_failed');
    }
  }
}
