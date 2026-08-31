import { isObservable, Subscription } from 'rxjs';

import { isViewNode, type ElementNode, type EventObservers, type ViewChild } from '../jsx/runtime';

export interface MountOptions {
  /**
   * Called when an Observable child or attribute binding errors. Recovery
   * belongs in the application dataflow (`catchError`); this hook only decides
   * where an unrecovered error is reported. The default rethrows it as an
   * unhandled error so failures stay loud.
   */
  readonly onError?: (error: unknown) => void;
}

type ErrorReporter = (error: unknown) => void;

const reportUnhandledError: ErrorReporter = (error) => {
  setTimeout(() => {
    throw error;
  });
};

const normalizeAttributeName = (name: string): string => (name === 'className' ? 'class' : name);

// value/checked/selected attributes only set a control's DEFAULT state; once
// the user has interacted, the attribute no longer reflects into the control.
// Live form state therefore binds to the DOM property, not the attribute.
const setLiveFormProperty = (element: Element, name: string, value: unknown): boolean => {
  if (
    name === 'value' &&
    (element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement)
  ) {
    element.value =
      value === undefined || value === null || typeof value === 'boolean' ? '' : String(value);
    return true;
  }

  if (name === 'checked' && element instanceof HTMLInputElement) {
    element.checked = value !== undefined && value !== null && value !== false;
    return true;
  }

  if (name === 'selected' && element instanceof HTMLOptionElement) {
    element.selected = value !== undefined && value !== null && value !== false;
    return true;
  }

  return false;
};

const setElementValue = (element: Element, name: string, value: unknown): void => {
  const attributeName = normalizeAttributeName(name);

  if (setLiveFormProperty(element, attributeName, value)) {
    return;
  }

  if (value === undefined || value === null || value === false) {
    element.removeAttribute(attributeName);
    return;
  }

  if (value === true) {
    element.setAttribute(attributeName, '');
    return;
  }

  element.setAttribute(attributeName, String(value));
};

const bindEvents = (element: Element, observers: EventObservers, lifetime: Subscription): void => {
  for (const [eventName, observer] of Object.entries(observers)) {
    if (!observer) {
      continue;
    }

    const listener: EventListener = (event) => observer.next(event as never);
    element.addEventListener(eventName, listener);
    lifetime.add(() => element.removeEventListener(eventName, listener));
  }
};

const bindProps = (
  element: Element,
  node: ElementNode,
  lifetime: Subscription,
  onError: ErrorReporter,
): void => {
  for (const [name, value] of Object.entries(node.props)) {
    if (name === 'children') {
      continue;
    }

    if (name === 'on') {
      if (value && typeof value === 'object') {
        bindEvents(element, value as EventObservers, lifetime);
      }
      continue;
    }

    if (isObservable(value)) {
      lifetime.add(
        value.subscribe({
          next: (nextValue) => setElementValue(element, name, nextValue),
          error: (error) => {
            setElementValue(element, name, undefined);
            onError(error);
          },
        }),
      );
      continue;
    }

    setElementValue(element, name, value);
  }
};

const removeBetween = (start: Comment, end: Comment): void => {
  let current = start.nextSibling;

  while (current && current !== end) {
    const next = current.nextSibling;
    current.parentNode?.removeChild(current);
    current = next;
  }
};

const renderChild = (
  view: ViewChild,
  parent: Node,
  before: Node | null,
  lifetime: Subscription,
  onError: ErrorReporter,
): void => {
  if (Array.isArray(view)) {
    view.forEach((child) => renderChild(child, parent, before, lifetime, onError));
    return;
  }

  if (view === null || view === undefined || typeof view === 'boolean') {
    return;
  }

  if (typeof view === 'string' || typeof view === 'number') {
    parent.insertBefore(document.createTextNode(String(view)), before);
    return;
  }

  if (isObservable(view)) {
    const start = document.createComment('rxjs:start');
    const end = document.createComment('rxjs:end');
    parent.insertBefore(start, before);
    parent.insertBefore(end, before);

    let currentViewLifetime = new Subscription();
    lifetime.add(currentViewLifetime);

    lifetime.add(
      view.subscribe({
        next: (nextView) => {
          currentViewLifetime.unsubscribe();
          currentViewLifetime = new Subscription();
          lifetime.add(currentViewLifetime);
          removeBetween(start, end);
          renderChild(nextView as ViewChild, parent, end, currentViewLifetime, onError);
        },
        error: (error) => {
          currentViewLifetime.unsubscribe();
          removeBetween(start, end);
          onError(error);
        },
      }),
    );
    return;
  }

  if (!isViewNode(view)) {
    throw new TypeError('Unsupported JSX value passed to DOM renderer.');
  }

  if (view.kind === 'fragment') {
    view.children.forEach((child) => renderChild(child, parent, before, lifetime, onError));
    return;
  }

  const element = document.createElement(view.tag);
  bindProps(element, view, lifetime, onError);
  view.children.forEach((child) => renderChild(child, element, null, lifetime, onError));
  parent.insertBefore(element, before);
};

export const mount = (
  view: ViewChild,
  container: Element,
  { onError = reportUnhandledError }: MountOptions = {},
): Subscription => {
  const lifetime = new Subscription(() => container.replaceChildren());
  container.replaceChildren();
  renderChild(view, container, null, lifetime, onError);
  return lifetime;
};
