export type EmailDeliveryProvider = 'postmark' | 'smtp';

export interface EmailDeliveryConfig {
  postmarkApiKey?: string;
  smtpUrl?: string;
  required: boolean;
}

export interface EmailDeliveryReadiness {
  provider: EmailDeliveryProvider | null;
  ready: boolean;
  required: boolean;
}

/** Resolve the active provider without exposing provider credentials. */
export function resolveEmailDelivery(config: EmailDeliveryConfig): EmailDeliveryReadiness {
  const provider = config.postmarkApiKey?.trim() ? 'postmark' : config.smtpUrl?.trim() ? 'smtp' : null;

  return {
    provider,
    ready: provider !== null || !config.required,
    required: config.required,
  };
}
