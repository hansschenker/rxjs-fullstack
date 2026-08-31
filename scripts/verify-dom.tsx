import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { Observable, Subject, filter, firstValueFrom } from 'rxjs';
import type { RouteMatch } from 'rxjs-router';

import { Counter } from '../src/examples/counter';
import type { ViewChild } from '../src/jsx/runtime';
import { mount } from '../src/render/dom';
import { createActivatedRouteTree } from '../src/router-view';

GlobalRegistrator.register({ url: 'http://localhost:3100/' });

const { createTodosShell } = await import('../src/examples/todos-shell');

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertEqual = (actual: unknown, expected: unknown, message: string): void => {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
  }
};

// M02: static rendering — fragments, arrays, elements, attributes, teardown.
// (Real <>...</> syntax: the automatic JSX runtime type-checks fragments,
// which the classic transform could not do against the symbol factory.)
const staticContainer = document.createElement('div');
const staticLifetime = mount(
  <>
    <section className="panel">
      {['alpha', 'beta'].map(
        (item): ViewChild => (
          <span>{item}</span>
        ),
      )}
    </section>
  </>,
  staticContainer,
);
assertEqual(
  staticContainer.innerHTML,
  '<section class="panel"><span>alpha</span><span>beta</span></section>',
  'M02: mount should render fragments, arrays, elements, and attributes into real DOM.',
);
staticLifetime.unsubscribe();
assertEqual(
  staticContainer.innerHTML,
  '',
  'M02: unsubscribing the mount Subscription must remove the mounted DOM.',
);

// M02: events flow through Observers into the explicit RxJS state machine and
// the resulting Observable state flows back into the DOM (the counter proof).
const counterContainer = document.createElement('div');
const counterLifetime = mount(<Counter />, counterContainer);
const counterButton = counterContainer.querySelector('button');
assert(counterButton !== null, 'M02: the counter should render its button.');
assertEqual(
  counterButton.textContent,
  'Count: 0',
  'M02: the counter should render its startWith(0) state.',
);

counterButton.dispatchEvent(new Event('click'));
assertEqual(
  counterButton.textContent,
  'Count: 1',
  'M02: a click should flow through the Subject into scan and back into the DOM.',
);
counterButton.dispatchEvent(new Event('click'));
assertEqual(
  counterButton.textContent,
  'Count: 2',
  'M02: each click should advance the RxJS state machine.',
);

counterLifetime.unsubscribe();
assertEqual(counterContainer.innerHTML, '', 'M02: unmounting the counter must clear its DOM.');

// M02: live-region cancellation has one owner — the previous child's
// subscription is torn down BEFORE the replacement renders.
const lifecycleEvents: Array<string> = [];
const tracked = (label: string): Observable<string> =>
  new Observable<string>((subscriber) => {
    lifecycleEvents.push(`subscribe:${label}`);
    subscriber.next(label);
    return () => {
      lifecycleEvents.push(`teardown:${label}`);
    };
  });

const view$ = new Subject<ViewChild>();
const regionContainer = document.createElement('div');
const regionLifetime = mount(<div>{view$}</div>, regionContainer);

view$.next(<p>{tracked('first')}</p>);
assertEqual(
  regionContainer.querySelector('p')?.textContent,
  'first',
  'M02: an Observable child should render as a live region.',
);

view$.next(<p>{tracked('second')}</p>);
assertEqual(
  regionContainer.querySelector('p')?.textContent,
  'second',
  'M02: each emission should replace the live-region contents.',
);
assertEqual(
  lifecycleEvents.join(','),
  'subscribe:first,teardown:first,subscribe:second',
  'M02: the previous child subscription must be torn down before the replacement renders.',
);

regionLifetime.unsubscribe();
assertEqual(
  lifecycleEvents.join(','),
  'subscribe:first,teardown:first,subscribe:second,teardown:second',
  'M02: unmounting must tear down the current live-region child subscription.',
);
assertEqual(
  view$.observed,
  false,
  'M02: unmounting must unsubscribe from the live-region source Observable.',
);

// M02: replacing a live region must remove the previous child's listeners.
const swap$ = new Subject<ViewChild>();
const innerClick$ = new Subject<MouseEvent>();
let innerClicks = 0;
innerClick$.subscribe(() => {
  innerClicks += 1;
});

const swapContainer = document.createElement('div');
const swapLifetime = mount(<div>{swap$}</div>, swapContainer);

swap$.next(<button on={{ click: innerClick$ }}>inner</button>);
const innerButton = swapContainer.querySelector('button');
assert(innerButton !== null, 'M02: the emitted child should render its button.');
innerButton.dispatchEvent(new Event('click'));
assertEqual(innerClicks, 1, 'M02: events on an emitted child should reach its Observer.');

swap$.next(<p>replaced</p>);
innerButton.dispatchEvent(new Event('click'));
assertEqual(
  innerClicks,
  1,
  'M02: replacing a live region must remove the previous child event listeners.',
);

swapLifetime.unsubscribe();

// M02: Observable props are live attribute bindings owned by the mount lifetime.
const class$ = new Subject<string>();
const attributeContainer = document.createElement('div');
const attributeLifetime = mount(<p className={class$}>styled</p>, attributeContainer);
const paragraph = attributeContainer.querySelector('p');
assert(paragraph !== null, 'M02: the attribute host should render.');
assertEqual(
  paragraph.getAttribute('class'),
  null,
  'M02: an Observable attribute should be absent before the first emission.',
);

class$.next('accent');
assertEqual(
  paragraph.getAttribute('class'),
  'accent',
  'M02: Observable props should become live attribute bindings.',
);
class$.next('muted');
assertEqual(
  paragraph.getAttribute('class'),
  'muted',
  'M02: attribute bindings should follow later emissions.',
);

attributeLifetime.unsubscribe();
assertEqual(class$.observed, false, 'M02: unmounting must unsubscribe attribute bindings.');

// M02: an erroring Observable child fails loudly — the current child is torn
// down, the region is cleared instead of freezing stale DOM, and the error
// reaches mount's onError hook. Siblings and the mount lifetime survive.
const childErrors: Array<unknown> = [];
const failing$ = new Subject<ViewChild>();
const errorContainer = document.createElement('div');
const errorLifetime = mount(
  <div>
    <p>stable</p>
    {failing$}
  </div>,
  errorContainer,
  { onError: (error) => childErrors.push(error) },
);

let innerActive = 0;
const innerProbe$ = new Observable<string>((subscriber) => {
  innerActive += 1;
  subscriber.next('inner');
  return () => {
    innerActive -= 1;
  };
});

failing$.next(<p>{innerProbe$}</p>);
assertEqual(
  errorContainer.querySelectorAll('p').length,
  2,
  'M02: the live region should render before the error.',
);
assertEqual(
  innerActive,
  1,
  'M02: the emitted child subscription should be active before the error.',
);

failing$.error(new Error('child stream failed'));
assertEqual(
  errorContainer.querySelectorAll('p').length,
  1,
  'M02: an erroring live region must clear its content instead of freezing stale DOM.',
);
assertEqual(
  errorContainer.querySelector('p')?.textContent,
  'stable',
  'M02: sibling content must survive a live-region error.',
);
assertEqual(
  innerActive,
  0,
  'M02: an erroring live region must tear down the current child subscription.',
);
assertEqual(childErrors.length, 1, 'M02: the mount onError hook should receive the child error.');
assert(
  childErrors[0] instanceof Error && childErrors[0].message === 'child stream failed',
  'M02: the reported error should be the original stream error.',
);
errorLifetime.unsubscribe();
assertEqual(
  errorContainer.innerHTML,
  '',
  'M02: the mount lifetime must remain usable after a binding error.',
);

// M02: an erroring Observable attribute removes the stale value and reports.
const attributeErrors: Array<unknown> = [];
const failingClass$ = new Subject<string>();
const attrErrorContainer = document.createElement('div');
const attrErrorLifetime = mount(<p className={failingClass$}>styled</p>, attrErrorContainer, {
  onError: (error) => attributeErrors.push(error),
});
const attrErrorParagraph = attrErrorContainer.querySelector('p');
assert(attrErrorParagraph !== null, 'M02: the failing-attribute host should render.');
failingClass$.next('accent');
assertEqual(
  attrErrorParagraph.getAttribute('class'),
  'accent',
  'M02: the attribute should bind before the error.',
);
failingClass$.error(new Error('attribute stream failed'));
assertEqual(
  attrErrorParagraph.getAttribute('class'),
  null,
  'M02: an erroring attribute binding must remove the stale attribute.',
);
assertEqual(
  attributeErrors.length,
  1,
  'M02: the mount onError hook should receive the attribute error.',
);
attrErrorLifetime.unsubscribe();

// M02: live form state binds to DOM properties — value/checked/selected
// attributes only set a control's default and stop reflecting after the user
// has interacted with it.
const value$ = new Subject<string | undefined>();
const checked$ = new Subject<boolean>();
const formContainer = document.createElement('div');
const formLifetime = mount(
  <div>
    <input type="text" value={value$} />
    <input type="checkbox" checked={checked$} />
  </div>,
  formContainer,
);
const textInput = formContainer.querySelector('input[type="text"]');
const checkbox = formContainer.querySelector('input[type="checkbox"]');
assert(textInput instanceof HTMLInputElement, 'M02: the text input should render.');
assert(checkbox instanceof HTMLInputElement, 'M02: the checkbox should render.');

value$.next('first');
assertEqual(
  textInput.value,
  'first',
  'M02: an Observable value binding should drive the input property.',
);
assertEqual(
  textInput.getAttribute('value'),
  null,
  'M02: live value must bind to the property, not the attribute.',
);

textInput.value = 'typed by the user';
value$.next('second');
assertEqual(
  textInput.value,
  'second',
  'M02: value emissions must keep driving the control after user edits.',
);

value$.next(undefined);
assertEqual(textInput.value, '', 'M02: clearing the value binding should reset the control.');

checked$.next(true);
assertEqual(
  checkbox.checked,
  true,
  'M02: an Observable checked binding should drive the checkbox property.',
);
assertEqual(
  checkbox.getAttribute('checked'),
  null,
  'M02: live checked must bind to the property, not the attribute.',
);
checked$.next(false);
assertEqual(checkbox.checked, false, 'M02: checked emissions should uncheck the control.');
formLifetime.unsubscribe();

const optionContainer = document.createElement('div');
const optionLifetime = mount(
  <select>
    <option value="a">a</option>
    <option value="b" selected={true}>
      b
    </option>
  </select>,
  optionContainer,
);
const selectedOption = optionContainer.querySelectorAll('option')[1];
assert(selectedOption instanceof HTMLOptionElement, 'M02: the option should render.');
assertEqual(selectedOption.selected, true, 'M02: selected should bind to the option property.');
optionLifetime.unsubscribe();

// M14: state.matches[] has a named activated route tree shape for nested outlets.
const firstMatch = {
  id: 'root',
  path: '/',
  fullPath: '/',
  pathname: '/',
  params: {},
  search: {},
  data: undefined,
} satisfies RouteMatch;
const secondMatch = {
  ...firstMatch,
  id: 'about',
  path: 'about',
  fullPath: '/about',
} satisfies RouteMatch;
const activatedRouteTree = createActivatedRouteTree([firstMatch, secondMatch]);
assertEqual(
  activatedRouteTree.root?.match.id,
  'root',
  'M14: ActivatedRouteTree should expose the root match.',
);
assertEqual(
  activatedRouteTree.root?.child?.match.id,
  'about',
  'M14: ActivatedRouteTree should link parent and child route nodes.',
);

// M02/M05/M14: client-side navigation — RouterOutlet is the named live view
// source, and nav link clicks flow through the dataflow into the router.
const shell = createTodosShell();
const shellContainer = document.createElement('div');
const shellLifetime = mount(shell.view, shellContainer);
shellLifetime.add(shell.navigation$.subscribe());

await firstValueFrom(shell.router.state$.pipe(filter((state) => state.status === 'success')));
assertEqual(
  shellContainer.querySelector('h1')?.textContent,
  'RxJS Fullstack',
  'M14: RouterOutlet should render the home route from the initial location.',
);

const aboutLink = Array.from(shellContainer.querySelectorAll('a')).find(
  (anchor) => anchor.getAttribute('href') === '/about',
);
assert(aboutLink !== undefined, 'Navigation: the shell should render an /about nav link.');
aboutLink.dispatchEvent(new Event('click', { cancelable: true }));

await firstValueFrom(
  shell.router.state$.pipe(
    filter((state) => state.status === 'success' && state.location.pathname === '/about'),
  ),
);
assertEqual(
  shellContainer.querySelector('h1')?.textContent,
  'About RxJS Fullstack',
  'M14: clicking a nav link should swap the RouterOutlet view client-side.',
);
assertEqual(
  document.title,
  'RxJS Fullstack About',
  'Navigation: the page title should follow the route.',
);

shellLifetime.unsubscribe();
assertEqual(shellContainer.innerHTML, '', 'M14: unmounting the RouterOutlet shell must clear its DOM.');

console.log('M02 DOM renderer verification passed.');
