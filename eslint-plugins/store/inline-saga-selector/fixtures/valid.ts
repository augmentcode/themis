import { selectReady } from "../todos-selectors";

export function* todosSaga() {
  const ready = yield* selectReady.effect();
  return ready;
}