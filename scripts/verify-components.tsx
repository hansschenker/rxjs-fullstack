import {
  list,
  mapMessage,
  mapModel,
  type Component,
  type MessageSink,
} from '../src/component';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

interface OuterModel {
  readonly label: string;
}

const LengthReportingView: Component<string, number> = ({ model, messages }) => {
  messages.next(model.length);
  return model;
};

const toLengthMessage = (length: number): string => `length:${length}`;
const selectLabel = (model: OuterModel): string => model.label;

const LiftedView: Component<OuterModel, string> = mapModel(selectLabel)(
  mapMessage(toLengthMessage)(LengthReportingView),
);

const messages: string[] = [];
const rendered = LiftedView({
  model: { label: 'RxJS' },
  messages: {
    next: (message) => messages.push(message),
  },
});

assert(rendered === 'RxJS', 'mapModel must project the outer model into the inner component.');
assert(
  messages.length === 1 && messages[0] === 'length:4',
  'mapMessage must lift the component message into the outer message vocabulary.',
);

const NumberView: Component<number, never> = ({ model }) => model;
const NumberList = list(NumberView);
const noMessages: MessageSink<never> = { next: () => undefined };
const renderedList = NumberList({ model: [1, 2, 3], messages: noMessages });

assert(Array.isArray(renderedList), 'list must return a JSX-compatible child collection.');
assert(renderedList.length === 3, 'list must render one child for every model item.');
assert(
  renderedList[0] === 1 && renderedList[1] === 2 && renderedList[2] === 3,
  'list must preserve collection order.',
);

console.log('M14 functional component algebra verification passed.');
