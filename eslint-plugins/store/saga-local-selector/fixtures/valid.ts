import { selectReady, selectDone } from "../todos-selectors";

export function* todosSaga() {
  const ready = yield* selectReady.effect();
  const done = yield* selectDone.effect();
  return { ready, done };
}
