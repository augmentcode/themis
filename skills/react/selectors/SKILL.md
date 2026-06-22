---
name: react/selectors
description: >-
  Author ReactStore selectors whose direct calls return Preact React
  ReadonlySignal values and are the preferred React consumer integration path.
  Covers signal selector arguments, Store-bound creation, .useValue(...args) as a
  fallback for hook/plain-value boundaries, .withStore(signalSource), pure
  .select(state) composition/testing, and saga-only .effect() usage without
  importing React selector internals.
type: sub-skill
requires:
  - react
  - core/state-integrity
sources:
  - "@augmentcode/themis/react-store"
  - augmentcode/themis:docs/SELECTORS.md
triggers:
  - React selector
  - selector .useValue
  - signal selector
  - ReadonlySignal selector
  - ReactStore selector
---
# React selectors — signal-first call model

Use this skill when `store.createSelector(...)` belongs to a `ReactStore` and
direct selector calls should produce Preact React `ReadonlySignal<R>` results.
Direct selector calls are the preferred React consumer integration path when
callers can pass, read, or render signals through the Preact React signal
integration. Use `.useValue(...args)` only when a hook/plain value is required and
adapting the consumer to accept a signal is impractical.

## Authoring rules

- Create selectors through the configured `ReactStore` instance.
- Keep selector callbacks pure and derived-only; reducers must not store selectoroutputs.
- Compose selectors with `.select(state, ...args)` inside another selector.
- Do not import from `themis` React selector internal deep paths.

```tsx
import { ReactStore } from "@augmentcode/themis/react-store";
import type { ReadonlySignal } from "@preact/signals-react";

export const reactStore = new ReactStore({ todos: todosReducer });
export const selectTodo = reactStore.createSelector((state, id: string) => {
  return state.todos.collection.map[id];
});

type Todo = { title: string } | undefined;

function TodoTitle({ todo }: { todo: ReadonlySignal<Todo> }) {
  return <span>{todo.value?.title}</span>;
}

function TodoRow({ id }: { id: string }) {
  const todo = selectTodo(id);
  return <TodoTitle todo={todo} />;
}
```

## Call forms

| Context | Use | Result |
| --- | --- | --- |
| Preferred React/signal-aware consumer | selectFoo(...argsOrSignals) | ReadonlySignal<R> |
| Hook/plain-value fallback | selectFoo.useValue(...argsOrSignals) | Plain value R |
| Alternate signal state | selectFoo.withStore(signalSource)(...args) | ReadonlySignal<R> |
| Tests/handlers/composition | selectFoo.select(state, ...args) | Plain value R |
| Sagas | yield* selectFoo.effect(...args) | typed-redux-saga select effect |

Selector arguments may be plain values or Preact React signals. Prefer direct
signal outputs for React consumers that can accept signals; they and
`.useValue(...args)` are throttled by the owning `ReactStore`'s
`throttledSelectorFrequency` option, defaulting to `64` FPS. `.useValue(...args)`
remains valid only for third-party APIs, legacy component boundaries, or custom
hooks that must return a plain value. Selector trace output is disabled by
default; pass `{ traceSelectors: true }` in the final Store options object only
for temporary diagnostics. `.effect(...args)` is saga-only; it is not a React
hook, signal subscription, or throttled render path.

Selector-channel helpers that consume `.effect(...)`-compatible selectors run insagas and subscribe through the Redux store object's `getState()` / `subscribe()`context path, not through React signals or a Svelte readable wrapper.

## Don't

- Do not call `.useValue(...args)` outside React components or custom hooks.
- Do not choose `.useValue(...args)` as the default React render path when a component
  or helper can be adapted to accept a `ReadonlySignal<R>`.
- Do not use Svelte `$selector` syntax, Svelte readable lifecycle rules, or Kefir
  observable selector arguments in the same React app.
- Do not call another selector's direct signal form inside a selector callback; use
  `.select(state)` to keep composition pure and synchronous.
- Do not use standalone React selector utilities as public package imports.

## Verification cues

- React component examples prefer direct selector calls and pass/read
  `ReadonlySignal` values when signal integration supports it.
- `.useValue(...args)` examples are framed as hook/plain-value fallback reads, not the
  default consumer path.
- Unit tests for pure selector logic use `.select(mockState, ...args)`.

## See also

- `react/store/SKILL.md` — Store class and import choice.
- `docs/SELECTORS.md` — human reference and examples for all call forms.
- `core/state-integrity/SKILL.md` — canonical derived-value ownership.