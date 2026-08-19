export function passwordsMatch(password: string, confirmation: string): boolean {
  return password === confirmation;
}

export function resetLinkIsInvalid(token: string, callbackError: string, invalidated: boolean): boolean {
  return !token || Boolean(callbackError) || invalidated;
}
