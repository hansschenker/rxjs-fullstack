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

export type ViewChild = PrimitiveView | ViewNode | Observable<unknown> | readonly ViewChild[];

export type EventObservers = Partial<{
  [K in keyof GlobalEventHandlersEventMap]: Observer<GlobalEventHandlersEventMap[K]>;
}>;

type Bindable<T> = T | Observable<unknown>;

interface KnownHtmlAttributes {
  readonly action?: Bindable<string>;
  readonly alt?: Bindable<string>;
  readonly autocomplete?: Bindable<string>;
  readonly checked?: Bindable<boolean>;
  readonly class?: Bindable<string>;
  readonly className?: Bindable<string>;
  readonly disabled?: Bindable<boolean>;
  readonly height?: Bindable<string | number>;
  readonly hidden?: Bindable<boolean>;
  readonly href?: Bindable<string>;
  readonly id?: Bindable<string>;
  readonly maxlength?: Bindable<string | number>;
  readonly method?: Bindable<string>;
  readonly minlength?: Bindable<string | number>;
  readonly name?: Bindable<string>;
  readonly placeholder?: Bindable<string>;
  readonly rel?: Bindable<string>;
  readonly required?: Bindable<boolean>;
  readonly role?: Bindable<string>;
  readonly selected?: Bindable<boolean>;
  readonly src?: Bindable<string>;
  readonly style?: Bindable<string>;
  readonly target?: Bindable<string>;
  readonly title?: Bindable<string>;
  readonly type?: Bindable<string>;
  readonly value?: Bindable<string | number | readonly string[]>;
  readonly width?: Bindable<string | number>;
}

type CustomHtmlAttributes = {
  readonly [Name in `data-${string}` | `aria-${string}`]?: unknown;
};

export type ElementProps = KnownHtmlAttributes &
  CustomHtmlAttributes & {
    readonly children?: ViewChild | readonly ViewChild[];
    readonly on?: EventObservers;
  };

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

type HtmlIntrinsicElements = {
  readonly [TagName in keyof HTMLElementTagNameMap]: ElementProps;
};

declare global {
  namespace JSX {
    type Element = ViewChild;
    type IntrinsicElements = HtmlIntrinsicElements;

    interface ElementChildrenAttribute {
      children: unknown;
    }
  }
}
