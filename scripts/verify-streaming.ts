import { Observable, of, throwError } from 'rxjs';

import { QUERY_STATE_SCRIPT_ID } from '../src/query';
import { renderRouteDocument } from '../src/render/page';
import {
  type HtmlStreamSink,
  writeDocumentStream,
} from '../src/render/stream';
import { routes } from '../src/routes';
import { app } from '../src/server/app';

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertEqual = (
  actual: unknown,
  expected: unknown,
  message: string,
): void => {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`,
    );
  }
};

const response = await app.request('/streaming');
assertEqual(response.status, 200, 'M13: streaming route should return HTTP 200.');
assert(
  response.headers.get('content-type')?.startsWith('text/html') === true,
  'M13: streaming SSR should use an HTML content type.',
);
assertEqual(
  response.headers.get('content-encoding'),
  'Identity',
  'M13: streaming SSR should use identity content encoding.',
);
assertEqual(
  response.headers.get('cache-control'),
  'no-store',
  'M13: progressive SSR responses should not be cached as complete reusable documents.',
);
assert(response.body, 'M13: streaming SSR response should expose a ReadableStream body.');

const reader = response.body.getReader();
const decoder = new TextDecoder();
const first = await reader.read();
assert(!first.done && first.value, 'M13: the response should emit an initial shell chunk.');
const firstHtml = decoder.decode(first.value, { stream: true });
assert(firstHtml.includes('<!doctype html>'), 'M13: first chunk should begin the HTML document.');
assert(firstHtml.includes('id="streaming-shell"'), 'M13: first chunk should contain the route shell.');
assert(
  !firstHtml.includes('id="streaming-todos"'),
  'M13: first chunk must arrive before the delayed query-backed content.',
);

let streamedHtml = firstHtml;
for (;;) {
  const next = await reader.read();
  if (next.done) {
    streamedHtml += decoder.decode();
    break;
  }
  streamedHtml += decoder.decode(next.value, { stream: true });
}

assert(
  streamedHtml.includes('id="streaming-progress"'),
  'M13: the response should contain an intermediate RxJS server chunk.',
);
assert(
  streamedHtml.includes('id="streaming-todos"') &&
    streamedHtml.includes('Port TanStack Query to RxJS'),
  'M13: the response should eventually contain query-backed streamed HTML.',
);
assert(
  streamedHtml.includes(`id="${QUERY_STATE_SCRIPT_ID}"`) &&
    streamedHtml.includes('"queryKey":["todos"]'),
  'M13: Query/Cache state should be dehydrated after streamed query work completes.',
);
assert(
  streamedHtml.endsWith('</body></html>'),
  'M13: a successful stream should close the HTML document.',
);

const fetchFromApp = async (input: string, init?: RequestInit): Promise<Response> => {
  const url = new URL(input, 'http://rxjs-fullstack.streaming-verify');
  return app.request(`${url.pathname}${url.search}`, init);
};
const buffered = await renderRouteDocument({
  routes,
  request: new Request('http://rxjs-fullstack.streaming-verify/streaming'),
  fetch: fetchFromApp,
});
assert(buffered.type === 'page', 'M13: buffered rendering should collect a streaming page successfully.');
assert(
  buffered.html.includes('id="streaming-shell"') &&
    buffered.html.includes('id="streaming-progress"') &&
    buffered.html.includes('id="streaming-todos"'),
  'M13: buffered rendering should contain every streaming page phase.',
);

const decodeChunks = (chunks: readonly Uint8Array[]): string => {
  const textDecoder = new TextDecoder();
  return chunks.map((chunk) => textDecoder.decode(chunk)).join('');
};

let inFlightWrites = 0;
let maxInFlightWrites = 0;
const orderedChunks: Uint8Array[] = [];
const backpressureSink: HtmlStreamSink = {
  onAbort: () => undefined,
  write: async (chunk) => {
    inFlightWrites += 1;
    maxInFlightWrites = Math.max(maxInFlightWrites, inFlightWrites);
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
    orderedChunks.push(chunk);
    inFlightWrites -= 1;
  },
};
await writeDocumentStream({
  sink: backpressureSink,
  title: 'Backpressure proof',
  initialBody: '<p>shell</p>',
  body$: of('<p>one</p>', '<p>two</p>', '<p>three</p>'),
});
assertEqual(
  maxInFlightWrites,
  1,
  'M13: concatMap should await each downstream write before starting the next chunk.',
);
assert(
  decodeChunks(orderedChunks).includes('<p>one</p><p>two</p><p>three</p>'),
  'M13: backpressure-aware writes should preserve Observable emission order.',
);

let abortCallback: (() => void) | undefined;
let cancellationTeardown = false;
let subscribedResolve: (() => void) | undefined;
const subscribed = new Promise<void>((resolve) => {
  subscribedResolve = resolve;
});
const cancellationSource$ = new Observable<string>(() => {
  subscribedResolve?.();
  return () => {
    cancellationTeardown = true;
  };
});
const cancellationSink: HtmlStreamSink = {
  onAbort: (callback) => {
    abortCallback = callback;
  },
  write: async () => undefined,
};
const cancellationWork = writeDocumentStream({
  sink: cancellationSink,
  title: 'Cancellation proof',
  initialBody: '<p>shell</p>',
  body$: cancellationSource$,
});
await subscribed;
abortCallback?.();
await cancellationWork;
assert(
  cancellationTeardown,
  'M13: aborting the HTTP stream should unsubscribe the RxJS body source.',
);

const errorChunks: Uint8Array[] = [];
const errorSink: HtmlStreamSink = {
  onAbort: () => undefined,
  write: async (chunk) => {
    errorChunks.push(chunk);
  },
};
await writeDocumentStream({
  sink: errorSink,
  title: 'Error proof',
  initialBody: '<p>shell</p>',
  body$: throwError(() => new Error('sensitive stream failure')),
});
const errorHtml = decodeChunks(errorChunks);
assert(
  errorHtml.includes('data-rxjs-stream-error="true"'),
  'M13: a post-start stream error should become a generic in-band error fragment.',
);
assert(
  !errorHtml.includes('sensitive stream failure'),
  'M13: streamed error fallback must not leak internal error details.',
);
assert(
  errorHtml.endsWith('</body></html>'),
  'M13: post-start error handling should still close the HTML document.',
);

console.log('M13 streaming SSR verification passed.');
