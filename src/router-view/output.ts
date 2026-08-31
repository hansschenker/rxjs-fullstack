import type { Observable } from 'rxjs';

import type { ViewChild } from '../jsx/runtime';

/**
 * The framework-owned view output produced by a matched route.
 *
 * M14 gives the existing PageData contract its route-runtime name: this is the
 * output consumed by RouterOutlet and eventually interpreted by the DOM/HTML
 * renderers.
 */
export interface RouteComponentOutput {
  readonly title: string;
  readonly view: ViewChild;
  readonly stream$?: Observable<ViewChild>;
}

/** Backward-compatible name used by existing route loaders. */
export type PageData = RouteComponentOutput;

export const isRouteComponentOutput = (value: unknown): value is RouteComponentOutput => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as { readonly title?: unknown };
  return typeof candidate.title === 'string' && 'view' in value;
};

export const routeComponentOutputFrom = (value: unknown): RouteComponentOutput | undefined =>
  isRouteComponentOutput(value) ? value : undefined;
