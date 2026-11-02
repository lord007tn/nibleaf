import { BlockList, isIP } from 'node:net';

export interface DomainDnsSnapshot {
  txt: string[][];
  cnames: string[];
  addresses: string[];
  targetAddresses: string[];
}

export const normalizeDnsName = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    ?.replace(/:\d+$/, '')
    .replace(/\.$/, '') ?? '';

export const hasOwnershipRecord = (records: string[][], token: string): boolean => {
  const expected = `nibleaf-verify=${token}`;
  return records.some((chunks) => chunks.join('').trim() === expected);
};

export const pointsAtTarget = (snapshot: DomainDnsSnapshot, target: string): boolean => {
  const expected = normalizeDnsName(target);
  if (snapshot.cnames.some((name) => normalizeDnsName(name) === expected)) {
    return true;
  }
  const targetAddresses = new Set(snapshot.targetAddresses);
  return snapshot.addresses.some((address) => targetAddresses.has(address));
};

// Only globally routable destinations are suitable for outbound connections.
const nonPublic = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['168.63.129.16', 32],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  nonPublic.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  nonPublic.addSubnet(address, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

export const isPublicAddress = (address: string): boolean => {
  const version = isIP(address);
  if (version === 4) return !nonPublic.check(address, 'ipv4');
  if (version !== 6 || address.includes('%')) return false;
  // Canonicalize dotted tails and expanded groups before checking embedded IPv4.
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const embedded = /^::(?:ffff:)?([a-f0-9]+):([a-f0-9]+)$/.exec(canonical);
  if (embedded?.[1] && embedded[2]) {
    const high = Number.parseInt(embedded[1], 16);
    const low = Number.parseInt(embedded[2], 16);
    return isPublicAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return globalV6.check(address, 'ipv6') && !nonPublic.check(address, 'ipv6');
};
