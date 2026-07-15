import { isIP } from 'node:net';

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

/** Refuse TLS probes to loopback/private/link-local destinations. A domain must
 * point at the configured ingress before it is probed, but this is a second
 * guard against DNS rebinding and accidental internal-service scans. */
export const isPublicAddress = (address: string): boolean => {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split('.').map(Number);
    const [a, b] = parts;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b !== undefined && b >= 64 && b <= 127) ||
      (a !== undefined && a >= 224)
    );
  }
  if (version === 6) {
    const value = address.toLowerCase();
    return !(
      value === '::' ||
      value === '::1' ||
      value.startsWith('fc') ||
      value.startsWith('fd') ||
      value.startsWith('fe8') ||
      value.startsWith('fe9') ||
      value.startsWith('fea') ||
      value.startsWith('feb')
    );
  }
  return false;
};
