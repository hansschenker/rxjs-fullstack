import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { Observable, Subject, filter, firstValueFrom } from 'rxjs';

import { Counter } from '../src/examples/counter';
import { Fragment, jsx, type ViewChild } from '../src/jsx/runtime';
import { mount } from '../src/render/dom';

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
// (Fragment syntax <>...</> does not typecheck against the symbol factory, so
// the fragment path is exercised through the jsx() factory directly.)
const staticContainer = document.createElement('div');
const staticLifetime = mount(
  jsx(
    Fragment,
    null,
    <section className="panel">
      {['alpha', 'beta'].map((item): ViewChild => <span>{item}</span>)}
    </section>,
  ),
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
assertEqual(counterButton.textContent, 'Count: 0', 'M02: the counter should render its startWith(0) state.');

counterButton.dispatchEvent(new Event('click'));
assertEqual(
  counterButton.textContent,
  'Count: 1',
  'M02: a click should flow through the Subject into scan and back into the DOM.',
);
counterButton.dispatchEvent(new Event('click'));
assertEqual(counterButton.textContent, 'Count: 2', 'M02: each click should advance the RxJS state machine.');

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
assertEqual(view$.observed, false, 'M02: unmounting must unsubscribe from the live-region source Observable.');

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
assertEqual(innerClicks, 1, 'M02: replacing a live region must remove the previous child event listeners.');

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
assertEqual(paragraph.getAttribute('class'), 'accent', 'M02: Observable props should become live attribute bindings.');
class$.next('muted');
assertEqual(paragraph.getAttribute('class'), 'muted', 'M02: attribute bindings should follow later emissions.');

attributeLifetime.unsubscribe();
assertEqual(class$.observed, false, 'M02: unmounting must unsubscribe attribute bindings.');

// M02/M05: client-side navigation — the router state stream is the live view
// source, and nav link clicks flow through the dataflow into the router.
const shell = createTodosShell();
const shellContainer = document.createElement('div');
const shellLifetime = mount(shell.view, shellContainer);
shellLifetime.add(shell.navigation$.subscribe());

await firstValueFrom(shell.router.state$.pipe(filter((state) => state.status === 'success')));
assertEqual(
  shellContainer.querySelector('h1')?.textContent,
  'RxJS Fullstack',
  'Navigation: the shell should render the home route from the initial location.',
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
  'Navigation: clicking a nav link should swap the routed view client-side.',
);
assertEqual(document.title, 'RxJS Fullstack About', 'Navigation: the page title should follow the route.');

shellLifetime.unsubscribe();
assertEqual(shellContainer.innerHTML, '', 'Navigation: unmounting the shell must clear its DOM.');

console.log('M02 DOM renderer verification passed.');
