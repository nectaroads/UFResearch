import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const ttl = 8 * 60 * 60;
const cookieName = 'ufresearch_session';

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64);
  return salt + ':' + key.toString('hex');
}

export async function verifyPassword(password, hash) {
  const [salt, expected] = hash.split(':');
  const key = await derive(password, salt, 64);
  return timingSafeEqual(key, Buffer.from(expected, 'hex'));
}

function digest(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionHash(request) {
  const authorization = request.headers.authorization;
  if (authorization !== undefined) {
    const match = /^Bearer ([a-f0-9]{64})$/.exec(authorization);
    return match ? digest(match[1]) : null;
  }
  const cookie = request.headers.cookie?.split(';').map(value => value.trim())
    .find(value => value.startsWith(cookieName + '='));
  const token = cookie?.slice(cookieName.length + 1);
  return /^[a-f0-9]{64}$/.test(token ?? '') ? digest(token) : null;
}

function setCookie(response, secure, token, maxAge) {
  const options = ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=' + maxAge];
  if (secure) options.push('Secure');
  response.setHeader('Set-Cookie', [cookieName + '=' + token, ...options].join('; '));
}

export async function startSession(db, request, response, secure, accountId, remote = false) {
  const token = randomBytes(32).toString('hex');
  await db.query('DELETE FROM sessions WHERE expires_at <= now() OR token_hash = $1', [sessionHash(request)]);
  await db.query('INSERT INTO sessions VALUES ($1, $2, $3)', [digest(token), accountId, new Date(Date.now() + ttl * 1000)]);
  if (!remote) setCookie(response, secure, token, ttl);
  return token;
}

export async function endSession(db, request, response, secure) {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [sessionHash(request)]);
  setCookie(response, secure, '', 0);
}
