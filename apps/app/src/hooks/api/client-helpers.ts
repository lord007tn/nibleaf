/** Extract a readable error message from a non-2xx response. */
export async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string }; message?: string };
    return body.error?.message ?? body.message ?? fallback;
  } catch {
    return fallback;
  }
}

/** Unwrap a `{ data }` envelope, throwing a readable error on failure. */
export async function getData<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    throw new Error(await errorMessage(res, `Failed to load ${what}.`));
  }
  const json = (await res.json()) as { data: T };
  return json.data;
}

/** Unwrap a `{ data }` envelope for a mutation, throwing a readable error. */
export async function mutateData<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    throw new Error(await errorMessage(res, fallback));
  }
  const json = (await res.json()) as { data: T };
  return json.data;
}

