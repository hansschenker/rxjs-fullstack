import {
  Fragment,
  jsx as createViewChild,
  type JsxType,
  type ViewChild,
} from './runtime';

const toChildArray = (children: unknown): readonly unknown[] => {
  if (children === undefined) {
    return [];
  }

  return Array.isArray(children) ? children : [children];
};

/**
 * Automatic JSX runtime entry (`jsx: "react-jsx"` + `jsxImportSource`). The
 * compiler passes children inside props; this adapter restores the classic
 * rest-argument shape and delegates to the framework's `jsx()` normalizer.
 * The `key` argument is accepted for transform compatibility and ignored —
 * the renderer has no keyed reconciliation.
 */
export function jsx<Props extends object>(
  type: JsxType<Props>,
  props: (Props & { readonly children?: unknown }) | null,
  _key?: unknown,
): ViewChild {
  if (props === null) {
    return createViewChild(type, null);
  }

  const { children, ...rest } = props;
  return createViewChild(type, rest as unknown as Props, ...toChildArray(children));
}

export const jsxs = jsx;

export { Fragment };
