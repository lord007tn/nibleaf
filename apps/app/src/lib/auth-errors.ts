interface AuthErrorLike {
  code?: string;
  message?: string;
}

/** Better Auth returns this error when credentials are valid but verification is still required. */
export function isEmailNotVerifiedError(error: AuthErrorLike | null | undefined): boolean {
  if (!error) {
    return false;
  }
  const value = `${error.code ?? ''} ${error.message ?? ''}`.toUpperCase().replaceAll(' ', '_');
  return value.includes('EMAIL_NOT_VERIFIED');
}
