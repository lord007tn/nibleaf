interface AuthErrorLike {
  code?: string;
  message?: string;
}

/** The queue's stable failure code uses interface copy rather than its English server message. */
export function authEmailErrorMessage(error: AuthErrorLike | null | undefined, deliveryError: string, fallback = deliveryError): string {
  return error?.code === 'AUTH_EMAIL_UNAVAILABLE' ? deliveryError : (error?.message ?? fallback);
}

/** Better Auth returns this error when credentials are valid but verification is still required. */
export function isEmailNotVerifiedError(error: AuthErrorLike | null | undefined): boolean {
  if (!error) {
    return false;
  }
  const value = `${error.code ?? ''} ${error.message ?? ''}`.toUpperCase().replaceAll(' ', '_');
  return value.includes('EMAIL_NOT_VERIFIED');
}
