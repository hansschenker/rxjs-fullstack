import { isObservable, Subscription } from 'rxjs';

import {
  isViewNode,
  type ElementNode,
  type EventObservers,
  type ViewChild,
} from '../jsx/runtime';

const normalizeAttributeName = (name: string): string =>
  name === 'className' ? 'class' : name;

const setElementValue = (element: Element, name: string, value: unknown): void => {
  const attributeName = normalizeAttributeName(name);

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

const bindEvents = (
  element: Element,
  observers: EventObservers,
  lifetime: Subscription,
): void => {
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
      lifetime.add(value.subscribe((nextValue) => setElementValue(element, name, nextValue)));
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
): void => {
  if (Array.isArray(view)) {
    view.forEach((child) => renderChild(child, parent, before, lifetime));
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
          renderChild(nextView as ViewChild, parent, end, currentViewLifetime);
        },
      }),
    );
    return;
  }

  if (!isViewNode(view)) {
    throw new TypeError('Unsupported JSX value passed to DOM renderer.');
  }

  if (view.kind === 'fragment') {
    view.children.forEach((child) => renderChild(child, parent, before, lifetime));
    return;
  }

  const element = document.createElement(view.tag);
  bindProps(element, view, lifetime);
  view.children.forEach((child) => renderChild(child, element, null, lifetime));
  parent.insertBefore(element, before);
};

export const mount = (view: ViewChild, container: Element): Subscription => {
  const lifetime = new Subscription(() => container.replaceChildren());
  container.replaceChildren();
  renderChild(view, container, null, lifetime);
  return lifetime;
};
