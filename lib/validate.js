import crypto from 'crypto';

export const MAX_ASS_SIZE = 200 * 1024; // 200 KB

export function validateAssContent(content) {
  const s = String(content || '');
  const errors = [];
  if (!/\[Script Info\]/i.test(s)) errors.push('Missing [Script Info] section');
  if (!/\[Events\]/i.test(s)) errors.push('Missing [Events] section');
  if (!/\[V4\+ Styles\]|\[V4 Styles\]/i.test(s)) errors.push('Missing [V4+ Styles] or [V4 Styles] section');
  return { valid: errors.length === 0, errors };
}

export function computeSHA256(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}
