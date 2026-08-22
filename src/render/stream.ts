import {
  concatMap,
  defaultIfEmpty,
  from,
  lastValueFrom,
  Subject,
  takeUntil,
  type Observable,
} from 'rxjs';

import type { HtmlJsonScript } from './html';
import { renderDocumentPrefix, renderDocumentSuffix } from './html';

export interface HtmlStreamSink {
  write(chunk: Uint8Array): Promise<unknown>;
  onAbort(callback: () => void): void;
}

export interface WriteDocumentStreamOptions {
  readonly sink: HtmlStreamSink;
  readonly title: string;
  readonly initialBody: string;
  readonly body$: Observable<string>;
  readonly jsonScripts?: () => readonly HtmlJsonScript[];
  readonly errorBody?: string;
}

const DEFAULT_STREAM_ERROR_BODY =
  '<section data-rxjs-stream-error="true"><p>Streaming content failed.</p></section>';

export const writeDocumentStream = async ({
  sink,
  title,
  initialBody,
  body$,
  jsonScripts = () => [],
  errorBody = DEFAULT_STREAM_ERROR_BODY,
}: WriteDocumentStreamOptions): Promise<void> => {
  const encoder = new TextEncoder();
  const abort$ = new Subject<void>();
  let aborted = false;

  const write = async (html: string): Promise<void> => {
    await sink.write(encoder.encode(html));
  };

  sink.onAbort(() => {
    if (aborted) {
      return;
    }
    aborted = true;
    abort$.next();
    abort$.complete();
  });

  try {
    await write(renderDocumentPrefix({ title, body: initialBody }));
    if (aborted) {
      return;
    }

    await lastValueFrom(
      body$.pipe(
        concatMap((html) => from(write(html))),
        takeUntil(abort$),
        defaultIfEmpty(undefined),
      ),
    );

    if (!aborted) {
      await write(renderDocumentSuffix({ jsonScripts: jsonScripts() }));
    }
  } catch {
    if (!aborted) {
      await write(errorBody);
      await write(renderDocumentSuffix({ jsonScripts: jsonScripts() }));
    }
  } finally {
    abort$.complete();
  }
};
