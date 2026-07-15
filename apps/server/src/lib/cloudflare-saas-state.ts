export interface DomainRecord {
  type: 'CNAME' | 'TXT';
  name: string;
  value: string;
  ttl: number;
}

interface ValidationRecord {
  cname?: string;
  cname_target?: string;
  txt_name?: string;
  txt_value?: string;
  status?: string;
}

export interface CloudflareCustomHostname {
  id: string;
  hostname: string;
  status?: string;
  verification_errors?: string[];
  ownership_verification?: { name?: string; type?: string; value?: string };
  ssl?: {
    status?: string;
    validation_errors?: Array<{ message?: string }>;
    validation_records?: ValidationRecord[];
  };
  nibleafWorkerRouteId?: string;
}

// HTTP DCV lets a customer finish setup with the routing CNAME alone. Cloudflare
// serves the validation response at the SaaS edge once the fallback origin is active.
export const cloudflareCustomHostnameSsl = {
  method: 'http',
  type: 'dv',
  bundle_method: 'ubiquitous',
} as const;

export const customHostnameRecords = (hostname: CloudflareCustomHostname, cnameTarget: string): DomainRecord[] => {
  const records: DomainRecord[] = [{ type: 'CNAME', name: hostname.hostname, value: cnameTarget, ttl: 3600 }];
  const ownership = hostname.ownership_verification;
  if (ownership?.name && ownership.value) {
    records.push({ type: ownership.type?.toUpperCase() === 'CNAME' ? 'CNAME' : 'TXT', name: ownership.name, value: ownership.value, ttl: 3600 });
  }
  for (const validation of hostname.ssl?.validation_records ?? []) {
    if (validation.cname && validation.cname_target)
      records.push({ type: 'CNAME', name: validation.cname, value: validation.cname_target, ttl: 3600 });
    else if (validation.txt_name && validation.txt_value)
      records.push({ type: 'TXT', name: validation.txt_name, value: validation.txt_value, ttl: 3600 });
  }
  return records.filter(
    (record, index, all) =>
      all.findIndex((other) => other.type === record.type && other.name === record.name && other.value === record.value) === index,
  );
};

export const customHostnameState = (hostname: CloudflareCustomHostname) => {
  const dnsActive = hostname.status === 'active';
  const sslActive = hostname.ssl?.status === 'active';
  const providerErrors = [
    ...(hostname.verification_errors ?? []),
    ...(hostname.ssl?.validation_errors ?? []).map((error) => error.message).filter((message): message is string => Boolean(message)),
  ];
  const terminal = /(?:timed_out|expired|inactive|blocked|deleted)/;
  const dnsError = terminal.test(hostname.status ?? '') || providerErrors.length > 0;
  const sslError = terminal.test(hostname.ssl?.status ?? '');
  return {
    verified: dnsActive && sslActive,
    dnsStatus: dnsActive ? ('VERIFIED' as const) : dnsError ? ('ERROR' as const) : ('PENDING' as const),
    sslStatus: sslActive ? ('ACTIVE' as const) : sslError ? ('ERROR' as const) : ('PROVISIONING' as const),
    lastError: providerErrors[0] ?? null,
  };
};
