import type { Observable, Observer } from 'rxjs';

export type PrimitiveView = string | number | boolean | null | undefined;

export interface ElementNode {
  readonly kind: 'element';
  readonly tag: string;
  readonly props: ElementProps;
  readonly children: readonly ViewChild[];
}

export interface FragmentNode {
  readonly kind: 'fragment';
  readonly children: readonly ViewChild[];
}

export type ViewNode = ElementNode | FragmentNode;

export type ViewChild =
  | PrimitiveView
  | ViewNode
  | Observable<unknown>
  | readonly ViewChild[];

export type EventObservers = Partial<{
  [K in keyof GlobalEventHandlersEventMap]: Observer<GlobalEventHandlersEventMap[K]>;
}>;

export interface ElementProps {
  readonly children?: ViewChild | readonly ViewChild[];
  readonly on?: EventObservers;
  readonly className?: string | Observable<unknown>;
  readonly [name: string]: unknown;
}

export type Component<Props extends object = Record<string, never>> = (
  props: Props & { readonly children?: readonly ViewChild[] },
) => ViewChild;

export const Fragment = Symbol('RxJSFullstack.Fragment');

export type JsxType<Props extends object = Record<string, never>> =
  | string
  | Component<Props>
  | typeof Fragment;

const flattenChildren = (children: readonly unknown[]): ViewChild[] => {
  const flattened: ViewChild[] = [];

  const append = (child: unknown): void => {
    if (Array.isArray(child)) {
      child.forEach(append);
      return;
    }

    flattened.push(child as ViewChild);
  };

  children.forEach(append);
  return flattened;
};

export function jsx<Props extends object>(
  type: JsxType<Props>,
  props: Props | null,
  ...children: unknown[]
): ViewChild {
  const normalizedChildren = flattenChildren(children);

  if (type === Fragment) {
    return {
      kind: 'fragment',
      children: normalizedChildren,
    } satisfies FragmentNode;
  }

  if (typeof type === 'function') {
    return type({
      ...(props ?? ({} as Props)),
      children: normalizedChildren,
    });
  }

  return {
    kind: 'element',
    tag: type,
    props: (props ?? {}) as ElementProps,
    children: normalizedChildren,
  } satisfies ElementNode;
}

export const isViewNode = (value: unknown): value is ViewNode => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const kind = Reflect.get(value, 'kind');
  return kind === 'element' || kind === 'fragment';
};

declare global {
  namespace JSX {
    type Element = ViewChild;
    type IntrinsicElements = Record<string, ElementProps>;

    interface ElementChildrenAttribute {
      children: unknown;
    }
  }
}
