export interface GoogleOAuthEnvironment {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

/** Keep server registration and public capability metadata on the same rule. */
export function googleOAuthEnabled(environment: GoogleOAuthEnvironment): environment is Required<GoogleOAuthEnvironment> {
  return Boolean(environment.GOOGLE_CLIENT_ID?.trim() && environment.GOOGLE_CLIENT_SECRET?.trim());
}
