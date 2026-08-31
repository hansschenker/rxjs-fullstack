import { fromFetch } from 'rxjs/fetch';
import type { Observable } from 'rxjs';

declare const serverActionTypes: unique symbol;

export interface ServerActionRef<TInput, TOutput> {
  readonly id: string;
  readonly [serverActionTypes]?: {
    readonly input: TInput;
    readonly output: TOutput;
  };
}

export interface InvokeServerActionOptions {
  readonly basePath?: string;
}

export class ServerActionRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ServerActionRequestError';
    this.status = status;
  }
}

export const defineServerAction = <TInput, TOutput>(
  id: string,
): ServerActionRef<TInput, TOutput> => ({ id });

export const serverActionHref = <TInput, TOutput>(
  action: ServerActionRef<TInput, TOutput>,
  basePath = '/api/actions',
): string => `${basePath}/${encodeURIComponent(action.id)}`;

export const invokeServerAction$ = <TInput, TOutput>(
  action: ServerActionRef<TInput, TOutput>,
  input: TInput,
  options: InvokeServerActionOptions = {},
): Observable<TOutput> =>
  fromFetch<TOutput>(serverActionHref(action, options.basePath), {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
    selector: async (response) => {
      if (!response.ok) {
        const message = (await response.text()).trim();
        throw new ServerActionRequestError(
          response.status,
          message || `Server action ${action.id} failed with HTTP ${response.status}.`,
        );
      }

      return (await response.json()) as TOutput;
    },
  });
