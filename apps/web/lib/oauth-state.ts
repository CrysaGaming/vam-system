import { randomBytes } from 'crypto';

export function generateState(): string {
  return randomBytes(32).toString('hex');
}

export const STATE_COOKIE_PREFIX = 'oauth_state_';
export const STATE_COOKIE_MAX_AGE = 600; // 10 Minuten