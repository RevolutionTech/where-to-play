export type Fetch = typeof fetch;

export type Sleep = (milliseconds: number) => Promise<void>;

export const sleep: Sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Removes the query string. Query strings can hold API keys and BGG usernames, and the logs of
 * the import workflow are public.
 */
export function redactUrl(url: string) {
  return url.split("?")[0] ?? "";
}

export class HttpError extends Error {
  readonly status: number;

  constructor(response: Response, body: string) {
    super(
      `${response.status} ${response.statusText} from ${redactUrl(response.url)}: ${body.slice(0, 200)}`,
    );
    this.status = response.status;
  }
}

/** Throws an HttpError for a response that is not 2xx. */
export async function ensureOk(response: Response) {
  if (!response.ok) throw new HttpError(response, await response.text());
  return response;
}
