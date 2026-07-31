import { createHmac, timingSafeEqual } from 'node:crypto';

// Short-lived, project-scoped upload ticket. Minted via the session-guarded
// /files/ticket endpoint (through the Vercel proxy), then used as a Bearer to
// upload the file DIRECTLY to the backend origin — bypassing the proxy's
// ~4.5 MB request-body limit so uploads can reach the real 25 MB cap.

const TTL_MS = 10 * 60 * 1000; // 10 minutes

function secret(): string {
  return process.env['SESSION_SECRET'] ?? 'dev-upload-secret';
}

export function signUploadTicket(userId: string, projectId: string): string {
  const exp = Date.now() + TTL_MS;
  const payload = `${userId}.${projectId}.${exp}`;
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

export function verifyUploadTicket(token: string, projectId: string): { userId: string } | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const payload = Buffer.from(b64, 'base64url').toString();
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const [userId, pid, expStr] = payload.split('.');
  if (!userId || pid !== projectId) return null;
  if (!expStr || Date.now() > Number(expStr)) return null;
  return { userId };
}
