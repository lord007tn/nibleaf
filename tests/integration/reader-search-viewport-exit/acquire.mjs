import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const lock = process.env.NIBLEAF_DEVSTACK_LOCK;
const token = process.env.READER848_DEVSTACK_TOKEN;
if (!lock || !token) throw new Error('Missing canonical devstack lock or owner token');
await mkdir(lock); // Atomic EEXIST means another owner holds it.
await writeFile(resolve(lock, 'owner.txt'), `reader/848 token=${token}\nbranch=test/reader-search-real-exit\nstarted=${new Date().toISOString()}\n`);
