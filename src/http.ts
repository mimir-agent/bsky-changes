// JSON over HTTP with the two politeness rules this tool needs: at most
// `maxConcurrent` requests in flight, and retries with backoff on 429, 5xx and
// network failures. Anything else (a 4xx) is returned to the caller to judge.

export const USER_AGENT = "bsky-changes (+https://github.com/mimir-agent/bsky-changes)";

export type FetchFn = (url: string, init: { headers: Record<string, string> }) => Promise<Response>;
export type SleepFn = (ms: number) => Promise<void>;

export interface HttpOptions {
  fetch?: FetchFn;
  sleep?: SleepFn;
  maxConcurrent?: number;
  /** Total attempts per request, including the first. */
  attempts?: number;
  baseDelayMs?: number;
}

export class HttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(url: string, status: number, body: string) {
    super(`HTTP ${status} from ${new URL(url).host}${body ? `: ${body.slice(0, 200)}` : ""}`);
    this.status = status;
    this.body = body;
  }
}

/** Limits how many async tasks run at once. */
export class Limiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  private readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Seconds from a Retry-After header, when it is a plain number. */
function retryAfterMs(res: Response): number | undefined {
  const value = res.headers.get("retry-after");
  if (value === null || !/^\d+$/.test(value)) return undefined;
  return Number(value) * 1000;
}

export class Http {
  private readonly fetchFn: FetchFn;
  private readonly sleep: SleepFn;
  private readonly limiter: Limiter;
  private readonly attempts: number;
  private readonly baseDelayMs: number;

  constructor(options: HttpOptions = {}) {
    this.fetchFn = options.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.limiter = new Limiter(options.maxConcurrent ?? 4);
    this.attempts = options.attempts ?? 4;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
  }

  /** GET a URL and parse JSON. Throws HttpError for a non-2xx answer after retries. */
  async getJson(url: string): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      const last = attempt >= this.attempts;
      const backoff = this.baseDelayMs * 2 ** (attempt - 1);
      let res: Response;
      try {
        res = await this.limiter.run(() =>
          this.fetchFn(url, { headers: { accept: "application/json", "user-agent": USER_AGENT } }),
        );
      } catch (err) {
        if (last) throw err;
        await this.sleep(backoff);
        continue;
      }
      if (res.ok) return await res.json();
      const body = await res.text();
      if (!retryable(res.status) || last) throw new HttpError(url, res.status, body);
      await this.sleep(retryAfterMs(res) ?? backoff);
    }
  }
}
