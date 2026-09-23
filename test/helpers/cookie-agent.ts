import { INestApplication } from '@nestjs/common';
import request from 'supertest';

// `request.agent()`'s built-in cookie jar refuses to replay `Secure`-flagged
// cookies over a plain-http connection (see `cookiejar`'s
// `access_info.secure` check), and the auth cookies set by `AuthController`
// are always `secure: true`. Since this test server runs over http, the
// stock agent silently drops the session after login. This minimal
// hand-rolled jar captures `Set-Cookie` headers (honoring each cookie's
// `Path` attribute, the way a real cookie jar would) and replays them
// regardless of the `Secure` attribute, which is what we want for an http
// test server standing in for a real https deployment.
interface CapturedCookie {
  name: string;
  value: string;
  path: string;
}

function cookieAppliesToPath(cookiePath: string, requestPath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
}

export type CookieAgentMethod = 'post' | 'get' | 'patch' | 'delete';

export function createCookieAgent(
  app: INestApplication,
): Record<CookieAgentMethod, (path: string) => request.Test> {
  const cookies: CapturedCookie[] = [];

  function captureCookies(res: request.Response): void {
    const setCookie = res.headers['set-cookie'] as unknown as
      string[] | undefined;
    if (!setCookie) return;
    for (const raw of setCookie) {
      const [namePair, ...attrs] = raw.split(';').map((part) => part.trim());
      const eq = namePair.indexOf('=');
      if (eq === -1) continue;
      const name = namePair.slice(0, eq);
      const value = namePair.slice(eq + 1);
      const pathAttr = attrs.find((a) => a.toLowerCase().startsWith('path='));
      const path = pathAttr ? pathAttr.slice('path='.length) : '/';
      const existing = cookies.find((c) => c.name === name && c.path === path);
      if (existing) {
        existing.value = value;
      } else {
        cookies.push({ name, value, path });
      }
    }
  }

  function build(method: CookieAgentMethod) {
    return (path: string): request.Test => {
      const req = request(app.getHttpServer())[method](path);
      const applicable = cookies.filter((c) =>
        cookieAppliesToPath(c.path, path),
      );
      if (applicable.length > 0) {
        const header = applicable.map((c) => `${c.name}=${c.value}`).join('; ');
        req.set('Cookie', header);
      }
      type EndCallback = (err: Error | null, res: request.Response) => void;
      const originalEnd = req.end.bind(req) as (cb?: EndCallback) => void;
      req.end = (callback?: EndCallback): request.Test => {
        originalEnd((err, res) => {
          if (res) captureCookies(res);
          callback?.(err, res);
        });
        return req;
      };
      return req;
    };
  }

  return {
    post: build('post'),
    get: build('get'),
    patch: build('patch'),
    delete: build('delete'),
  };
}
