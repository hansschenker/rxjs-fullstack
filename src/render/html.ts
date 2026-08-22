import { isObservable } from 'rxjs';

import {
  isViewNode,
  type ElementNode,
  type ViewChild,
} from '../jsx/runtime';

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

export const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const renderAttribute = (name: string, value: unknown): string => {
  if (name === 'children' || name === 'on' || value === undefined || value === null || value === false) {
    return '';
  }

  if (isObservable(value)) {
    throw new TypeError(
      `Observable attribute "${name}" must be resolved by the server RxJS pipeline before HTML rendering.`,
    );
  }

  const attributeName = name === 'className' ? 'class' : name;

  if (value === true) {
    return ` ${attributeName}`;
  }

  return ` ${attributeName}="${escapeHtml(String(value))}"`;
};

const renderElement = (node: ElementNode): string => {
  const attributes = Object.entries(node.props)
    .map(([name, value]) => renderAttribute(name, value))
    .join('');

  if (VOID_ELEMENTS.has(node.tag)) {
    return `<${node.tag}${attributes}>`;
  }

  return `<${node.tag}${attributes}>${node.children.map(renderToString).join('')}</${node.tag}>`;
};

export const renderToString = (view: ViewChild): string => {
  if (Array.isArray(view)) {
    return view.map(renderToString).join('');
  }

  if (view === null || view === undefined || typeof view === 'boolean') {
    return '';
  }

  if (typeof view === 'string' || typeof view === 'number') {
    return escapeHtml(String(view));
  }

  if (isObservable(view)) {
    throw new TypeError(
      'Observable children are live bindings. Resolve server data in the request Observable before calling renderToString().',
    );
  }

  if (!isViewNode(view)) {
    throw new TypeError('Unsupported JSX value passed to renderToString().');
  }

  if (view.kind === 'fragment') {
    return view.children.map(renderToString).join('');
  }

  return renderElement(view);
};

export interface HtmlJsonScript {
  readonly id: string;
  readonly value: unknown;
}

export interface HtmlDocumentOptions {
  readonly title: string;
  readonly body: string;
  readonly jsonScripts?: readonly HtmlJsonScript[];
}

const serializeJsonForHtml = (value: unknown): string => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError('JSON bootstrap data must be serializable.');
  }

  return serialized
    .replaceAll('&', '\\u0026')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
};

const renderJsonScript = ({ id, value }: HtmlJsonScript): string =>
  `<script id="${escapeHtml(id)}" type="application/json">${serializeJsonForHtml(value)}</script>`;

export const renderDocumentPrefix = ({
  title,
  body,
}: Pick<HtmlDocumentOptions, 'title' | 'body'>): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body>${body}`;

export const renderDocumentSuffix = ({
  jsonScripts = [],
}: Pick<HtmlDocumentOptions, 'jsonScripts'> = {}): string => {
  const scripts = jsonScripts.map(renderJsonScript).join('');
  return `${scripts}</body></html>`;
};

export const renderDocument = ({
  title,
  body,
  jsonScripts = [],
}: HtmlDocumentOptions): string =>
  `${renderDocumentPrefix({ title, body })}${renderDocumentSuffix({ jsonScripts })}`;
