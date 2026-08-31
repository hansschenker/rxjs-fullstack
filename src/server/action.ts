import { defer, firstValueFrom } from 'rxjs';
import type { Observable } from 'rxjs';
import type { Hono } from 'hono';

import type { ServerActionRef } from '../actions/action';

export interface ServerActionContext {
  readonly request: Request;
  readonly signal: AbortSignal;
}

export interface ServerActionHandler<TInput, TOutput> {
  readonly parse: (value: unknown) => TInput;
  readonly run: (input: TInput, context: ServerActionContext) => Observable<TOutput>;
  readonly successStatus?: number;
}

export class ServerActionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerActionInputError';
  }
}

export const invalidServerActionInput = (message: string): never => {
  throw new ServerActionInputError(message);
};

export const executeServerAction$ = <TInput, TOutput>(
  handler: ServerActionHandler<TInput, TOutput>,
  rawInput: unknown,
  context: ServerActionContext,
): Observable<TOutput> =>
  defer(() => {
    const input = handler.parse(rawInput);
    return handler.run(input, context);
  });

const jsonResponse = (value: unknown, status: number): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8' },
  });

export const registerServerAction = <TInput, TOutput>(
  app: Hono,
  action: ServerActionRef<TInput, TOutput>,
  handler: ServerActionHandler<TInput, TOutput>,
): void => {
  app.post(`/${encodeURIComponent(action.id)}`, async (context) => {
    let rawInput: unknown;

    try {
      rawInput = await context.req.json<unknown>();
    } catch {
      return jsonResponse({ error: 'Invalid JSON action payload.' }, 400);
    }

    try {
      const output = await firstValueFrom(
        executeServerAction$(handler, rawInput, {
          request: context.req.raw,
          signal: context.req.raw.signal,
        }),
      );

      return jsonResponse(output, handler.successStatus ?? 200);
    } catch (error) {
      if (error instanceof ServerActionInputError) {
        return jsonResponse({ error: error.message }, 400);
      }

      return jsonResponse({ error: 'Server action failed.' }, 500);
    }
  });
};
