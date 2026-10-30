// Copied into apps/server on the runner only. Signs the seeded demo user in
// through Better Auth's server API and writes the session cookies for the walker.
import { writeFileSync } from 'node:fs';
import { auth } from '@nibleaf/auth/server';

const email = 'demo@nibleaf.test';
const otp = await auth.api.createVerificationOTP({ body: { email, type: 'sign-in' } });
const result = await auth.api.signInEmailOTP({ body: { email, otp }, returnHeaders: true });
const cookies = result.headers.getSetCookie().map((line: string) => {
  const [pair] = line.split(';');
  const index = pair.indexOf('=');
  return { name: pair.slice(0, index).trim(), value: pair.slice(index + 1).trim() };
});
if (!cookies.some((cookie: { name: string }) => cookie.name.endsWith('session_token'))) throw new Error('no session cookie returned');
writeFileSync(process.argv[2], JSON.stringify({ cookies }));
console.log(`session cookies: ${cookies.map((cookie: { name: string }) => cookie.name).join(', ')}`);
process.exit(0);
