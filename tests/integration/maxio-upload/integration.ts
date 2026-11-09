import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { auth } from '../../../packages/auth/src/server';
import { prisma } from '../../../packages/database/src/index';
import { headObject, presignPutUrl } from '../../../packages/storage/src/index';

const email = 'maxio-upload@example.test';
const otp = await auth.api.createVerificationOTP({ body: { email, type: 'sign-in' } });
const response = await auth.api.signInEmailOTP({ body: { email, otp, name: 'Upload QA' }, asResponse: true });
assert.equal(response.status, 200);
const cookie = response.headers
  .getSetCookie()
  .map((value) => value.split(';')[0])
  .join('; ');
const user = await prisma.user.findUniqueOrThrow({ where: { email } });
const member = await prisma.member.findFirstOrThrow({ where: { userId: user.id } });
const project = await prisma.project.findFirstOrThrow({ where: { organizationId: member.organizationId } });
const page = await prisma.page.findFirstOrThrow({ where: { projectId: project.id } });
// This database and fictional workspace are owned by this fixture.
await prisma.page.update({ where: { id: page.id }, data: { content: 'Choose an image for the upload regression.\n' } });
const base = `http://127.0.0.1:4530/api/app/projects/${project.id}/assets`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1XkAAAAASUVORK5CYII=', 'base64');
const direct = await presignPutUrl({ key: `projects/${project.id}/assets/direct.png`, contentLength: png.length, contentType: 'image/png' });
const broken = await fetch(direct, { method: 'PUT', body: png, headers: { 'content-type': 'image/png' } });
assert.equal(broken.status, 403);
assert.match(await broken.text(), /SignatureDoesNotMatch/);
const presign = await fetch(`${base}/presign`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ filename: 'proxy.png', contentType: 'image/png', size: png.length }),
});
assert.equal(presign.status, 200, await presign.clone().text());
const { data } = await presign.json();
assert.match(data.uploadUrl, /^\/api\/app\/projects\/.+\/assets\/upload\//);
const put = await fetch(`http://127.0.0.1:4530${data.uploadUrl}`, { method: 'PUT', body: png, headers: { cookie, 'content-type': 'image/png' } });
assert.equal(put.status, 204, await put.text());
const duplicate = await fetch(`http://127.0.0.1:4530${data.uploadUrl}`, {
  method: 'PUT',
  body: png,
  headers: { cookie, 'content-type': 'image/png' },
});
assert.equal(duplicate.status, 400);
const confirm = await fetch(`${base}/confirm`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ key: data.key, contentType: 'image/png', size: png.length }),
});
assert.equal(confirm.status, 201, await confirm.clone().text());
assert.equal((await headObject(data.key)).ContentLength, png.length);
// Exercise the full 50 MiB route through the actual app proxy and Node adapter.
const large = Buffer.alloc(50 * 1024 * 1024, 1);
const largeReservation = await fetch(`${base}/presign`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ filename: 'limit.png', contentType: 'image/png', size: large.length }),
});
assert.equal(largeReservation.status, 200);
const { data: limit } = await largeReservation.json();
const full = await fetch(`http://127.0.0.1:4530${limit.uploadUrl}`, {
  method: 'PUT',
  body: large,
  headers: { cookie, 'content-type': 'image/png' },
});
assert.equal(full.status, 204, await full.text());
assert.equal((await headObject(limit.key)).ContentLength, large.length);
writeFileSync(
  new URL('./.local.json', import.meta.url),
  JSON.stringify({ cookie, projectId: project.id, pageId: page.id, organizationId: member.organizationId }),
);
console.log(
  JSON.stringify({
    directViaTraefik: broken.status,
    apiPut: put.status,
    reusedToken: duplicate.status,
    confirm: confirm.status,
    storedBytes: png.length,
    maximumUploadBytes: large.length,
  }),
);
await prisma.$disconnect();
process.exit(0);
