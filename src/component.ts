import type { JsxComponent } from './jsx/runtime';

/**
 * One-way message boundary exposed to application components. Components may
 * emit messages but do not own RxJS subscription, error, or completion policy.
 * An RxJS Subject is structurally compatible with this interface.
 */
export interface MessageSink<Message> {
  next(message: Message): void;
}

export interface ComponentProps<Model, Message> {
  readonly model: Model;
  readonly messages: MessageSink<Message>;
}

/**
 * Canonical rxjs-fullstack application component.
 *
 * A Component receives the current model, may emit application messages, and
 * returns the same ViewChild representation understood by the existing JSX,
 * DOM, SSR, and streaming renderers.
 */
export type Component<Model, Message> = JsxComponent<ComponentProps<Model, Message>>;

/** Lift a component that reads an inner model so it can read a larger model. */
export const mapModel =
  <OuterModel, InnerModel>(select: (model: OuterModel) => InnerModel) =>
  <Message>(
    component: Component<InnerModel, Message>,
  ): Component<OuterModel, Message> =>
  ({ model, messages }) =>
    component({
      model: select(model),
      messages,
    });

/** Lift a component's local message vocabulary into a larger vocabulary. */
export const mapMessage =
  <InnerMessage, OuterMessage>(project: (message: InnerMessage) => OuterMessage) =>
  <Model>(component: Component<Model, InnerMessage>): Component<Model, OuterMessage> =>
  ({ model, messages }) =>
    component({
      model,
      messages: {
        next: (message) => messages.next(project(message)),
      },
    });

/**
 * Message mapping variant for cases where the emitted message needs the
 * component's current model, for example lifting an item-local action with an
 * item's identity into an application message.
 */
export const mapMessageWithModel =
  <Model, InnerMessage, OuterMessage>(
    project: (message: InnerMessage, model: Model) => OuterMessage,
  ) =>
  (component: Component<Model, InnerMessage>): Component<Model, OuterMessage> =>
  ({ model, messages }) =>
    component({
      model,
      messages: {
        next: (message) => messages.next(project(message, model)),
      },
    });

/**
 * Lift one item component into a component over a readonly collection. The
 * component algebra only composes view structure; ordering and collection
 * semantics remain ordinary domain data.
 */
export const list =
  <Model, Message>(
    component: Component<Model, Message>,
  ): Component<readonly Model[], Message> =>
  ({ model, messages }) =>
    model.map((item) =>
      component({
        model: item,
        messages,
      }),
    );
