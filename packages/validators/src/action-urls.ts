import { z } from 'zod';

const allowedActionUrl = (value: string, allowMailto: boolean): boolean => {
  if ([...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return false;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return false;
    return (
      (/^https?:\/\//i.test(value) && ['http:', 'https:'].includes(parsed.protocol)) ||
      (allowMailto && /^mailto:/i.test(value) && parsed.protocol === 'mailto:' && parsed.pathname.length > 0)
    );
  } catch {
    return false;
  }
};

export const webActionUrlSchema = z
  .string()
  .max(500)
  .refine((value) => value === '' || allowedActionUrl(value, false), 'Use an http:// or https:// link.');
export const supportActionUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((value) => allowedActionUrl(value, true), 'Use an http://, https://, or mailto: link.');
