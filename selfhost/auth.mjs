import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const cookieName = 'chuljang_home_session';
const digest = value => createHash('sha256').update(value).digest('hex');

export async function hashPassword(password) {
  const salt = randomBytes(24).toString('hex');
  return salt + ':' + Buffer.from(await derive(password, salt, 64)).toString('hex');
}
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 512 || !/^[a-f0-9]{48}:[a-f0-9]{128}$/.test(encoded || '')) return false;
  const [salt, hash] = encoded.split(':');
  return timingSafeEqual(Buffer.from(hash, 'hex'), await derive(password, salt, 64));
}
export function safeReturn(value) {
  try { const url = new URL(value || '/', 'https://local.invalid'); return url.origin === 'https://local.invalid' && !url.pathname.startsWith('/signin-') && !url.pathname.startsWith('/signout-') ? url.pathname + url.search : '/'; }
  catch { return '/'; }
}
export function sessionToken(cookie) { return (cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || ''; }
export class HomeAuth {
  constructor(storage, origin, passwordHash, ownerId = 'home-owner') {
    if (!/^[a-f0-9]{48}:[a-f0-9]{128}$/.test(passwordHash || '')) throw new Error('Run npm run home:prepare first');
    this.storage = storage; this.origin = new URL(origin).origin; this.passwordHash = passwordHash; this.ownerId = ownerId;
    this.secure = this.origin.startsWith('https:');
  }
  cookie(value, maxAge) { return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${this.secure ? '; Secure' : ''}`; }
  user(cookie) {
    const token = sessionToken(cookie);
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    return this.storage.sql.prepare('SELECT 1 FROM home_sessions WHERE token=? AND expires>?').get(digest(token + this.passwordHash), Date.now()) ? this.ownerId : null;
  }
  async login(password) {
    const now = Date.now();
    const allowed = this.storage.transaction(() => {
      this.storage.sql.prepare('DELETE FROM home_login_attempts WHERE time<?').run(now - 300000);
      if (this.storage.sql.prepare('SELECT COUNT(*) AS count FROM home_login_attempts').get().count >= 10) return false;
      this.storage.sql.prepare('INSERT INTO home_login_attempts VALUES (?)').run(now); return true;
    });
    if (!allowed) return { status: 429 };
    if (!await verifyPassword(password, this.passwordHash)) return { status: 401 };
    const token = randomBytes(32).toString('hex'), ttl = 30 * 86400;
    this.storage.sql.prepare('DELETE FROM home_sessions WHERE expires<?').run(now);
    this.storage.sql.prepare('INSERT INTO home_sessions VALUES (?,?)').run(digest(token + this.passwordHash), now + ttl * 1000);
    return { status: 200, cookie: this.cookie(token, ttl) };
  }
  logout(cookie) { this.storage.sql.prepare('DELETE FROM home_sessions WHERE token=?').run(digest(sessionToken(cookie) + this.passwordHash)); return this.cookie('', 0); }
}
