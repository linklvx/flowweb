import { Injectable } from '@nestjs/common';
import { auth } from './auth';

@Injectable()
export class AuthService {
  async signIn(email: string, password: string) {
    return auth.api.signInEmail({ body: { email, password } });
  }

  async signUp(email: string, password: string, name: string) {
    return auth.api.signUpEmail({ body: { email, password, name } });
  }

  async signOut(sessionToken: string) {
    return auth.api.signOut({
      headers: new Headers({ cookie: `flowweb.session_token=${sessionToken}` }),
    });
  }

  async getSession(headers: Record<string, string>) {
    return auth.api.getSession({ headers: new Headers(headers) });
  }
}
