interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: { errors?: Array<string | { path?: string; message?: string }> };
  };
}

type ResponseData<TResponse extends Response> = Awaited<ReturnType<TResponse['json']>> extends { data: infer TData } ? TData : never;
type ResolvedData<TData, TResponse extends Response> = [TData] extends [never] ? ResponseData<TResponse> : TData;

const readApiError = async (res: Response, fallback: string) => {
  try {
    const body = (await res.json()) as ApiErrorBody;
    const message = body.error?.message ?? fallback;
    const issue = body.error?.details?.errors?.[0];
    const detailMessage = typeof issue === 'string' ? issue : issue?.message;
    const detailPath = typeof issue === 'string' ? undefined : issue?.path;
    if (detailMessage) {
      return {
        code: body.error?.code,
        message: `${message} ${detailPath && detailPath !== '$' ? `${detailPath}: ` : ''}${detailMessage}`,
      };
    }
    return { code: body.error?.code, message };
  } catch {
    return { code: undefined, message: fallback };
  }
};

/** Unwrap a `{ data }` envelope, throwing a readable error on failure. */
export class ApiResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiResponseError';
  }
}

export async function getData<TData = never, TResponse extends Response = Response>(res: TResponse, what: string) {
  if (!res.ok) {
    const error = await readApiError(res, `Failed to load ${what}.`);
    throw new ApiResponseError(error.message, res.status, error.code);
  }
  return (await res.json()).data as ResolvedData<TData, TResponse>;
}

/** Unwrap a `{ data }` envelope for a mutation, throwing a readable error. */
export async function mutateData<TData = never, TResponse extends Response = Response>(res: TResponse, fallback: string) {
  if (!res.ok) {
    const error = await readApiError(res, fallback);
    throw new ApiResponseError(error.message, res.status, error.code);
  }
  return (await res.json()).data as ResolvedData<TData, TResponse>;
}
