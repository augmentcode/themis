import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { buffers, END, eventChannel, runSaga, stdChannel } from 'redux-saga';
import * as typed from 'typed-redux-saga';
import * as effects from 'redux-saga/effects';
import * as actions from '../src/utils/store/create-action';
import { wrapStreamingGenerator } from '../src/utils/sagas/wrap-async-generator';
import { StreamingStore } from '../src/streaming-store';
import { createReducer } from '../src/utils/store/create-reducer';

const require = createRequire(import.meta.url);
const skill = (name) => `skills/core/${name}/SKILL.md`;
const snippet = (path, heading) => {
  const source = readFileSync(resolve(path), 'utf8');
  const start = source.indexOf(heading);
  if (start < 0) throw new Error(`Missing example heading: ${path}: ${heading}`);
  const match = /```(?:ts|typescript)\n([\s\S]*?)\n```/.exec(source.slice(start));
  if (!match) throw new Error(`Missing example fence: ${path}: ${heading}`);
  return match[1];
};

// Execute the actual Markdown, supplying only the app-owned collaborators it names.
function evaluate(source, tail = '', bindings = {}, modules = {}) {
  const imports = {
    'typed-redux-saga': typed,
    'redux-saga/effects': effects,
    '@augmentcode/themis/utils/store/create-action': actions,
    '@augmentcode/themis/saga': { wrapStreamingGenerator },
    vitest: { vi, describe, it, expect },
    ...modules,
  };
  const output = ts.transpileModule(`${source}\n${tail}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function('require', 'exports', ...Object.keys(bindings), output)(
    (id) => { if (!(id in imports)) throw new Error(`Unexpected snippet import: ${id}`); return imports[id]; },
    {}, ...Object.values(bindings),
  );
}

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

function channelOwner(heading, bindings) {
  return evaluate(
    snippet(skill('channel-effects'), '## Imports') + '\nfunction* owner() {\n' +
      snippet(skill('channel-effects'), heading) + '\n}',
    'return owner;', bindings,
  );
}

function exampleTests(source, modules) {
  const checks = [];
  evaluate(source, '', {}, {
    ...modules,
    vitest: { describe: (_name, body) => body(), it: (_name, body) => checks.push(body), expect },
  });
  return checks;
}

afterEach(() => {
  vi.doUnmock('typed-redux-saga');
  vi.useRealTimers();
});

describe('documented channel owners (Core F1)', () => {
  for (const [heading, mode] of [
    ['### 1. Fork a new worker for every event', 'every'],
    ['### 2. Cancel the previous worker for each new event', 'latest'],
  ]) {
    it(`${mode}: accepts later events, preserves worker policy and closes on cancellation`, async () => {
      let emit;
      const unsubscribe = vi.fn();
      const channel = eventChannel((next) => { emit = next; return unsubscribe; });
      const started = [], completed = [], cancelled = [], pending = new Map();
      function* operation(value) {
        started.push(value);
        const work = deferred();
        pending.set(value, work);
        try { yield* typed.call(() => work.promise); completed.push(value); }
        finally { if (yield* typed.cancelled()) cancelled.push(value); }
      }
      const owner = channelOwner(heading, { createAppEventChannel: () => channel, handleEvent: operation, expensiveOperation: operation });
      const errors = [];
      const task = runSaga({ onError: (e) => errors.push(e), dispatch: (a) => completed.push(a) }, owner);
      try {
        expect(errors).toEqual([]);
        expect(unsubscribe).not.toHaveBeenCalled();
        emit('first'); emit('second');
        expect(started).toEqual(['first', 'second']);
        expect(cancelled).toEqual(mode === 'latest' ? ['first'] : []);
        pending.get('first').resolve('first'); pending.get('second').resolve('second');
        await Promise.resolve();
        expect(completed).toEqual(mode === 'latest' ? ['second'] : ['first', 'second']);
        expect(task.isRunning()).toBe(true);
        emit('third');
      } finally {
        task.cancel();
        await task.toPromise().catch(() => {});
      }
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(cancelled).toEqual(mode === 'latest' ? ['first', 'third'] : ['third']);
      pending.get('third').resolve('too late');
      await Promise.resolve();
      expect(completed).not.toContain('third');
    });

    it(`${mode}: END waits for attached work and unsubscribes only once`, async () => {
      let emit;
      const unsubscribe = vi.fn(), work = deferred();
      const channel = eventChannel((next) => { emit = next; return unsubscribe; });
      const owner = channelOwner(heading, { createAppEventChannel: () => channel, handleEvent: () => work.promise, expensiveOperation: () => work.promise });
      const task = runSaga({}, owner);
      emit('one'); emit(END);
      expect(task.isRunning()).toBe(true);
      work.resolve();
      await task.toPromise();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it(`${mode}: a worker error ends the owner and releases its subscription`, async () => {
      let emit;
      const unsubscribe = vi.fn(), error = new Error('worker failed');
      const channel = eventChannel((next) => { emit = next; return unsubscribe; });
      const fail = () => { throw error; };
      const owner = channelOwner(heading, { createAppEventChannel: () => channel, handleEvent: fail, expensiveOperation: fail });
      const task = runSaga({ onError: () => {} }, owner);
      emit('one');
      await expect(task.toPromise()).rejects.toBe(error);
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
  }

  it.each([true, false])('serial loop is ordered; buffering=%s controls later queued events', async (buffered) => {
    let emit;
    const unsubscribe = vi.fn(), work = deferred(), started = [];
    const channel = eventChannel((next) => { emit = next; return unsubscribe; }, buffered ? buffers.fixed(2) : buffers.none());
    const owner = channelOwner('### 3. Keep a serial', {
      createAppEventChannel: () => channel,
      handleEvent: (value) => { started.push(value); return value === 'first' ? work.promise : undefined; },
    });
    const task = runSaga({}, owner);
    emit('first'); emit('second'); emit('third');
    expect(started).toEqual(['first']);
    work.resolve();
    await Promise.resolve();
    expect(started).toEqual(buffered ? ['first', 'second', 'third'] : ['first']);
    task.cancel();
    await task.toPromise();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('documented typed test effects (Core F2)', () => {
  it('the actual Vitest mock supports yield* and context-method tuples', async () => {
    evaluate(snippet(skill('testing'), '### 1. Mock'));
    const mocked = await import('typed-redux-saga');
    const receiver = { prefix: 'ok:', method(value) { return this.prefix + value; } };
    const stateSelector = (state) => state.value;
    const received = [];
    function* worker() {
      const value = yield* mocked.select(stateSelector);
      const result = yield* mocked.call([receiver, receiver.method], value);
      yield* mocked.put({ type: 'test/result', payload: result });
      const plain = yield* mocked.call((v) => v.toUpperCase(), value);
      const named = yield* mocked.call([receiver, 'method'], plain);
      yield* mocked.put({ type: 'test/named', payload: named });
    }
    await runSaga({ getState: () => ({ value: 'tuple' }), dispatch: (action) => received.push(action) }, worker).toPromise();
    expect(received).toEqual([{ type: 'test/result', payload: 'ok:tuple' }, { type: 'test/named', payload: 'ok:TUPLE' }]);
    const watcher = (function* () { yield* mocked.takeLatest('test/request', worker); })();
    expect(watcher.next().value).toEqual(effects.takeLatest('test/request', worker));
    watcher.return();
  });

  let testPlan;
  try { testPlan = require('redux-saga-test-plan'); } catch { /* Optional in consumers. */ }
  it.skipIf(!testPlan)('executes the documented expectSaga provider and checks real instance settlement', async () => {
    const store = new StreamingStore({});
    const selectCurrentUserId = store.createSelector((state) => state.userId);
    const loadTodos = actions.createAsyncAction('todos/loadAsync', 'todos/load', (query) => ({ query }));
    const fetchTodos = vi.fn(() => { throw new Error('Provider should replace API call'); });
    function* loadTodosWorker(action) {
      const userId = yield* selectCurrentUserId.effect();
      const todos = yield* typed.call(fetchTodos, userId, action.payload.query);
      yield* typed.put(action.success(todos));
    }
    const checks = exampleTests(snippet(skill('testing'), '### 4. Use'), {
      'redux-saga-test-plan': testPlan,
      'redux-saga-test-plan/matchers': require('redux-saga-test-plan/matchers'),
      './todos-api': { fetchTodos }, './todos-slice': { loadTodos }, './todos-saga': { loadTodosWorker },
      './todos-selectors': { selectCurrentUserId },
    });
    expect(checks).toHaveLength(1);
    for (const check of checks) await check();
    expect(fetchTodos).not.toHaveBeenCalled();
  });

  it('executes the manual generator assertions with raw descriptors', async () => {
    const fetchItems = actions.createAction('items/fetch');
    const setItems = actions.createAction('items/set');
    const fetchFailed = actions.createAction('items/failed');
    const api = { fetchItems: vi.fn() };
    function* handleFetch(action) {
      try { yield* typed.put(setItems(yield* typed.call(api.fetchItems, action.payload[0]))); }
      catch (error) { yield* typed.put(fetchFailed(error.message)); }
    }
    const checks = exampleTests(snippet('docs/TESTING.md', '### Manual Generator Stepping'), {
      './my-saga': { handleFetch }, './my-slice': { fetchItems, setItems, fetchFailed }, '../api': api,
    });
    expect(checks).toHaveLength(2);
    for (const check of checks) await check();
  });

  it.each([false, true])('framework-neutral Store example dispatches and disposes even if an assertion fails (%s)', (fails) => {
    const addTodo = actions.createAction('todos/add');
    const todosReducer = createReducer({ items: [] }).with(addTodo, (state, { payload: [todo] }) => ({ items: [...state.items, todo] }));
    const selectorOwner = new StreamingStore({ todos: todosReducer });
    const selectTodoById = selectorOwner.createSelector((state, id) => fails ? undefined : state.todos.items.find((todo) => todo.id === id));
    const initialized = vi.spyOn(StreamingStore.prototype, 'init');
    try {
      const checks = exampleTests(snippet('docs/TESTING.md', '## Mock Store Setup'), {
        '@augmentcode/themis/streaming-store': { StreamingStore },
        './todos-slice': { todosReducer, addTodo }, './todos-selectors': { selectTodoById },
      });
      expect(checks).toHaveLength(1);
      if (fails) expect(() => checks[0]()).toThrow();
      else checks[0]();
      expect(initialized).toHaveBeenCalledTimes(1);
      const store = initialized.mock.contexts[0];
      expect(() => store.state).toThrow('before Store.init()');
      expect(() => store.dispatch).toThrow('before Store.init()');
    } finally {
      initialized.mockRestore();
      selectorOwner.dispose();
    }
  });
});

describe('documented async request policy (Core F5)', () => {
  function example(fetchTodo) {
    const { watchTodos, loadTodo } = evaluate(snippet(skill('actions'), '### Watch request creators'),
      'return { watchTodos, loadTodo };', {}, { './todos-api': { fetchTodo } });
    const input = stdChannel(), dispatched = [];
    const task = runSaga({ channel: input, dispatch: (action) => dispatched.push(action) }, watchTodos);
    return { loadTodo, input, dispatched, task };
  }

  it('rejects superseded and teardown requests, without settling from static stages', async () => {
    const state = example(() => new Promise(() => {}));
    const first = state.loadTodo('first'), second = state.loadTodo('second');
    const firstSettled = vi.fn();
    first.promise.then(firstSettled, firstSettled);
    state.loadTodo.success({ id: 'static', title: 'not a response' });
    await Promise.resolve();
    expect(firstSettled).not.toHaveBeenCalled();
    state.input.put(first); state.input.put(second);
    await expect(first.promise).rejects.toThrow('Todo request cancelled');
    state.task.cancel();
    await state.task.toPromise();
    await expect(second.promise).rejects.toThrow('Todo request cancelled');
    expect(state.dispatched.map((action) => action.payload.request.id)).toEqual(['first', 'second']);
  });

  it.each([false, true])('settles the instance on normal success/error (error=%s)', async (fails) => {
    const todo = { id: 'one', title: 'Done' };
    const state = example(() => { if (fails) throw 'network'; return todo; });
    const request = state.loadTodo('one');
    state.input.put(request);
    if (fails) await expect(request.promise).rejects.toThrow('network');
    else await expect(request.promise).resolves.toEqual(todo);
    state.task.cancel();
    await state.task.toPromise();
    expect(state.dispatched).toHaveLength(1);
    expect(state.dispatched[0].payload.request).toEqual({ id: 'one' });
  });

  it('leading/windowed example deliberately ignores ordinary events without dangling request promises', async () => {
    vi.useFakeTimers();
    const refreshRequested = actions.createAction('todos/refreshRequested');
    const input = stdChannel(), work = deferred(), api = { refresh: vi.fn(() => work.promise) };
    const owner = evaluate(snippet(skill('sagas'), '### 3. Debounce'), 'return watchRefreshRequests;', { refreshRequested, api });
    const task = runSaga({ channel: input }, owner);
    const first = refreshRequested('first'), ignored = refreshRequested('ignored');
    expect(first).not.toHaveProperty('promise'); expect(ignored).not.toHaveProperty('promise');
    input.put(first); input.put(ignored);
    expect(api.refresh.mock.calls).toEqual([['first']]);
    work.resolve(); await vi.advanceTimersByTimeAsync(250);
    input.put(refreshRequested('later'));
    expect(api.refresh.mock.calls).toEqual([['first'], ['later']]);
    task.cancel(); await vi.runAllTimersAsync(); await task.toPromise();
  });

  it('an ignored promise-bearing leading request still needs explicit settlement', async () => {
    const load = actions.createAsyncAction('test/loadAsync', 'test/load');
    const input = stdChannel(), work = deferred(), settled = vi.fn();
    const first = load('first'), ignored = load('ignored');
    ignored.promise.then(settled, settled);
    const task = runSaga({ channel: input, dispatch: () => {} }, function* () {
      yield* typed.takeLeading(load, function* (action) {
        const response = yield* typed.call(() => work.promise);
        yield* typed.put(action.success(response));
      });
    });
    input.put(first); input.put(ignored);
    work.resolve('done'); await first.promise;
    task.cancel(); await task.toPromise();
    expect(settled).not.toHaveBeenCalled();
    ignored.failure(new Error('Ignored by admission policy'));
    await expect(ignored.promise).rejects.toThrow('Ignored by admission policy');
  });
});

describe('documented action payload contract (Core F3)', () => {
  it('executes no-argument sync/async and explicit tuple/undefined examples', () => {
    const values = evaluate(snippet(skill('actions'), '### No-payload action'),
      'return { resetAction, refreshAction, resetTuple, resetUndefined };');
    expect(values.resetAction.payload).toEqual([]);
    expect(values.refreshAction.payload).toEqual([]);
    expect(values.resetTuple.payload).toEqual([]);
    expect(values.resetUndefined.payload).toBeUndefined();
    values.refreshAction.success();
  });
});

it('type-checks the actual corrected snippets, including the unchanged undefined overloads', () => {
  const typeAssertions = `
    type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
    type Assert<T extends true> = T;
    type SyncPayload = Assert<Same<typeof resetAction.payload, undefined>>;
    type AsyncPayload = Assert<Same<typeof refreshAction.payload, undefined>>;
    type TuplePayload = Assert<Same<typeof resetTuple.payload, []>>;
    type ModifiedPayload = Assert<Same<typeof resetUndefined.payload, undefined>>;
    const inferredAsync = createAsyncAction('todos/inferredAsync', 'todos/inferred')();
    type InferredAsyncPayload = Assert<Same<typeof inferredAsync.payload, any[]>>;
    // @ts-expect-error no-argument creator does not accept an arbitrary payload
    resetTodos('unexpected');
  `;
  const sources = {
    'actions': snippet(skill('actions'), '### No-payload action') + typeAssertions,
    'mocks': snippet(skill('testing'), '### 1. Mock'),
    'stream-skill': snippet(skill('sagas'), '### 5. Consume'),
    'stream-guide': snippet('docs/SAGAS.md', '## Async Generator Streams'),
  };
  const streamTypes = `
    type MessageChunk = string;
    declare function messageChunkReceived(chunk: MessageChunk): { type: string; payload: MessageChunk };
    declare function reportStreamError(error: unknown): void;
  `;
  sources['stream-skill'] += streamTypes;
  sources['stream-guide'] += streamTypes;
  for (const [name, heading] of [['every', '### 1. Fork'], ['latest', '### 2. Cancel'], ['serial', '### 3. Keep']]) {
    sources[name] = snippet(skill('channel-effects'), '## Imports') + `
      type MyEvent = { id: string };
      declare function createAppEventChannel<T extends object>(name: string): EventChannel<T>;
      declare function handleEvent(event: MyEvent): Promise<void>;
      declare function expensiveOperation(event: MyEvent): Promise<void>;
      function* owner() { ${snippet(skill('channel-effects'), heading)} }
    `;
  }
  const files = new Map(Object.entries(sources).map(([name, source]) => [resolve(`scripts/saga-guidance-${name}.ts`), source]));
  const options = {
    noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: resolve('.'), paths: { '@augmentcode/themis/*': ['src/*'] },
  };
  const host = ts.createCompilerHost(options), getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (path, version, ...rest) => files.has(path)
    ? ts.createSourceFile(path, files.get(path), version, true) : getSourceFile(path, version, ...rest);
  const program = ts.createProgram([...files.keys()], options, host);
  // Check these examples against real public signatures, not unrelated project diagnostics.
  const diagnostics = [...files.keys()].flatMap((path) => {
    const source = program.getSourceFile(path);
    return [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)];
  });
  expect(diagnostics.map((entry) => `${entry.file?.fileName}: ${ts.flattenDiagnosticMessageText(entry.messageText, '\n')}`)).toEqual([]);
});

describe('documented stream owner (Core F6)', () => {
  for (const [path, heading, name] of [
    [skill('sagas'), '### 5. Consume', 'streamMessages'],
    ['docs/SAGAS.md', '## Async Generator Streams', 'consumeStream'],
  ]) {
    for (const ending of ['cancel', 'timeout', 'normal', 'error']) {
      it(`${path}: aborts then finalizes on ${ending}, including pending next()`, async () => {
        vi.useFakeTimers();
        const order = [], dispatched = [], reported = [], finalized = deferred();
        let signal, iterator;
        const sourceError = new Error('read failed');
        function openStream(inputSignal) {
          signal = inputSignal;
          iterator = (async function* () {
            try {
              if (ending === 'error') throw sourceError;
              if (ending === 'normal') { yield 'chunk'; return 'final'; }
              await new Promise((done) => signal.addEventListener('abort', () => { order.push('abort'); done(); }, { once: true }));
              return null;
            } finally { order.push('finalized'); finalized.resolve(); }
          })();
          const originalReturn = iterator.return.bind(iterator);
          iterator.return = vi.fn((value) => { order.push('return'); return originalReturn(value); });
          return iterator;
        }
        const owner = evaluate(snippet(path, heading), `return ${name};`, {
          messageChunkReceived: (payload) => ({ type: 'stream/chunk', payload }), reportStreamError: (error) => reported.push(error),
        });
        const task = runSaga({ dispatch: (action) => dispatched.push(action), onError: () => {} }, owner, openStream);
        const result = task.toPromise().then(() => undefined, (error) => error);
        if (ending === 'cancel') task.cancel();
        if (ending === 'timeout') await vi.advanceTimersByTimeAsync(30_000);
        const error = await result;
        await finalized.promise;
        await vi.runAllTimersAsync();
        expect(signal.aborted).toBe(true);
        expect(iterator.return).toHaveBeenCalledTimes(1);
        expect(order.filter((entry) => entry === 'finalized')).toHaveLength(1);
        if (ending === 'cancel' || ending === 'timeout') {
          expect(order.indexOf('abort')).toBeLessThan(order.indexOf('return'));
          expect(dispatched).toEqual([]);
        }
        if (ending === 'normal') expect(dispatched.map((action) => action.payload)).toEqual(['chunk', 'final']);
        if (ending === 'error') { expect(error).toBe(sourceError); expect(reported).toEqual([sourceError]); }
        if (ending === 'timeout') { expect(error.name).toBe('StreamTimeoutError'); expect(reported).toEqual([error]); }
        if (ending === 'cancel') expect(reported).toEqual([]);
      });
    }
  }

  it('return alone queues behind a pending next; source abort is needed to unblock it', async () => {
    const controller = new AbortController(), released = vi.fn();
    async function* source() {
      try { await new Promise((done) => controller.signal.addEventListener('abort', done, { once: true })); }
      finally { released(); }
    }
    const iterator = source(), read = iterator.next();
    let returned = false;
    const close = iterator.return().then(() => { returned = true; });
    await Promise.resolve();
    expect(returned).toBe(false); expect(released).not.toHaveBeenCalled();
    controller.abort();
    await Promise.all([read, close]);
    expect(returned).toBe(true); expect(released).toHaveBeenCalledTimes(1);
  });
});