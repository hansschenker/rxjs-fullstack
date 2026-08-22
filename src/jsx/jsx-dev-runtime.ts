import { Fragment, jsx } from './jsx-runtime';
import type { JsxType, ViewChild } from './runtime';

/**
 * Dev-transform entry (`react-jsxdev`): identical semantics, debug arguments
 * ignored. Present so tools that pick the dev transform keep working.
 */
export function jsxDEV<Props extends object>(
  type: JsxType<Props>,
  props: (Props & { readonly children?: unknown }) | null,
  key?: unknown,
  _isStaticChildren?: boolean,
  _source?: unknown,
  _self?: unknown,
): ViewChild {
  return jsx(type, props, key);
}

export { Fragment };
