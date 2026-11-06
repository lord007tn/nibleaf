interface AuthErrorLike {
  code?: string;
  message?: string;
  status?: number;
}

/**
 * Better Auth's `error.message` is English, technical copy. Auth screens show a
 * localized message chosen from the error's code/status instead, so an Arabic
 * writer never meets raw English exactly when they're stuck.
 */
export function friendlyAuthError(
  error: AuthErrorLike | null | undefined,
  messages: { fallback: string; tooManyAttempts: string; emailUnavailable?: string },
): string {
  const code = (error?.code ?? '').toUpperCase();
  if (error?.status === 429 || code.includes('TOO_MANY')) {
    return messages.tooManyAttempts;
  }
  if (code === 'AUTH_EMAIL_UNAVAILABLE' && messages.emailUnavailable) {
    return messages.emailUnavailable;
  }
  return messages.fallback;
}
