import { take } from "typed-redux-saga";
import { createChannelFromSelector } from "@augmentcode/themis/saga";
import { selectReady } from "../todos-selectors";

export function* todosSaga() {
  const channel = yield* createChannelFromSelector(selectReady);
  while (true) {
    yield* take(channel);
  }
}