import { createAsyncAction, createAction } from "@augmentcode/themis/utils/store/create-action";
import { createAsyncAction as unrelatedFactory } from "other-library";
import { loadExternal } from "./external-actions";
import type { createAsyncAction as typeOnlyFactory } from "@augmentcode/themis/utils/store/create-action";
import { type createAsyncAction as inlineTypeFactory } from "@augmentcode/themis/utils/store/create-action";

const loadTodos = createAsyncAction("todos/load", "todos/loadStage");
const action = loadTodos();
store.dispatch(action);
await store.dispatch(loadTodos());
await action.promise;
action.promise.then(transform).catch(reportError);
Promise.resolve().catch(reportError);
fetch("/todos").catch(reportError);
const object = { promise: Promise.resolve() };
object.promise.catch(reportError);
unrelatedFactory("load")().promise.catch(reportError);
loadExternal().promise.catch(reportError);
typeOnlyFactory("load")().promise.catch(reportError);
inlineTypeFactory("load")().promise.catch(reportError);
createAction("todos/ordinary")().promise.catch(reportError);

function shadowFactory(createAsyncAction) {
  const load = createAsyncAction("todos/load", "todos/stage");
  load().promise.catch(reportError);
}
function shadowCreator(loadTodos) {
  loadTodos().promise.catch(reportError);
}
function shadowAction(action) {
  action.promise.catch(reportError);
}
const promise = action.promise;
function shadowPromise(promise) {
  promise.catch(reportError);
}
let replacedAction = loadTodos();
replacedAction = object;
replacedAction.promise.catch(reportError);
let replacedCreator = loadTodos;
replacedCreator = unrelatedFactory("load");
replacedCreator().promise.catch(reportError);
const changedPromise = loadTodos();
changedPromise.promise = Promise.resolve();
changedPromise.promise.catch(reportError);
const promiseKey = "unrelated";
action[promiseKey].catch(reportError);
const catchKey = "then";
action.promise[catchKey](transform);