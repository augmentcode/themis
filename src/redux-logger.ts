import type { StoreMiddleware } from './types';

function isPrimitive(
  value: unknown
): value is string | number | bigint | boolean | symbol | null | undefined {
  return value === null || (typeof value !== 'object' && typeof value !== 'function');
}

function getInlinePayloadSuffix(action: unknown): string {
  const hasPayload = typeof action === 'object' && action !== null && 'payload' in action;
  if (!hasPayload) return '';

  const payload = (action as { payload: unknown }).payload;
  if (Array.isArray(payload) && payload.length === 1 && isPrimitive(payload[0])) {
    return ` ${String(payload[0])}`;
  }
  return isPrimitive(payload) ? ` ${String(payload)}` : '';
}

function getActionTitle(action: unknown): string {
  const actionType =
    typeof action === 'object' && action !== null && 'type' in action
      ? (action as { type: unknown }).type
      : action;
  return `${String(actionType)}${getInlinePayloadSuffix(action)}`;
}

function getActionTitleStyle(stateChanged: boolean): string {
  return stateChanged
    ? 'color: inherit; font-weight: 600'
    : 'color: #9E9E9E; font-weight: 300';
}

type StateDiff = Record<string, { prev: unknown; next: unknown }>;

class ChangesPayload {
  readonly #prevState: unknown;
  readonly #nextState: unknown;

  constructor(prevState: unknown, nextState: unknown) {
    this.#prevState = prevState;
    this.#nextState = nextState;
  }

  get changes(): StateDiff {
    return createStateDiff(this.#prevState, this.#nextState);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function addStateDiff(
  changes: StateDiff,
  prevValue: unknown,
  nextValue: unknown,
  path: string
): void {
  if (Object.is(prevValue, nextValue)) return;

  if (prevValue === undefined) {
    changes[path || '<root>'] = { prev: undefined, next: nextValue };
    return;
  }

  if ((Array.isArray(prevValue) || prevValue === undefined) &&
      (Array.isArray(nextValue) || nextValue === undefined)) {
    const prevArray = Array.isArray(prevValue) ? prevValue : [];
    const nextArray = Array.isArray(nextValue) ? nextValue : [];
    const length = Math.max(prevArray.length, nextArray.length);
    if (length > 0) {
      for (let index = 0; index < length; index += 1) {
        addStateDiff(changes, prevArray[index], nextArray[index], path ? `${path}[${index}]` : `[${index}]`);
      }
      return;
    }
  }

  if ((isPlainRecord(prevValue) || prevValue === undefined) &&
      (isPlainRecord(nextValue) || nextValue === undefined)) {
    const prevRecord = isPlainRecord(prevValue) ? prevValue : {};
    const nextRecord = isPlainRecord(nextValue) ? nextValue : {};
    const keys = new Set([...Object.keys(prevRecord), ...Object.keys(nextRecord)]);
    if (keys.size > 0) {
      for (const key of keys) {
        addStateDiff(changes, prevRecord[key], nextRecord[key], path ? `${path}.${key}` : key);
      }
      return;
    }
  }

  changes[path || '<root>'] = { prev: prevValue, next: nextValue };
}

function createStateDiff(prevState: unknown, nextState: unknown): StateDiff {
  const changes: StateDiff = {};
  addStateDiff(changes, prevState, nextState, '');
  return changes;
}

function getLogLabelStyle(
  label: 'prev state' | 'action' | 'next state' | 'state' | 'state (no changes)'
): string {
  switch (label) {
    case 'prev state':
      return 'color: #9E9E9E; font-weight: bold';
    case 'action':
      return 'color: #03A9F4; font-weight: bold';
    case 'next state':
    case 'state':
      return 'color: #4CAF50; font-weight: bold';
    case 'state (no changes)':
      return 'color: #9E9E9E; font-weight: lighter';
  }
}

let hasLoggedWelcomeMessage = false;

function logWelcomeMessage(): void {
  if (hasLoggedWelcomeMessage) return;
  hasLoggedWelcomeMessage = true;
  console.log(
    `%c🔧 Redux Logger Active%c\n\n%cLegend:%c\n  %c■%c State changed (bold title)\n  %c■%c No state change (gray title)\n\n%cLog labels:%c\n  %cprev state%c  — state before action\n  %caction%c      — dispatched action\n  %cnext state%c  — state after action\n  %cstate%c       — lazy state/diff payload (expanded by default)\n  %cstate (no changes)%c — state unchanged`,
    'color: #03A9F4; font-weight: bold; font-size: 14px', '',
    'color: #888; font-weight: bold', '', 'color: inherit; font-weight: 600', '',
    'color: #9E9E9E; font-weight: 300', '', 'color: #888; font-weight: bold', '',
    'color: #9E9E9E; font-weight: bold', '', 'color: #03A9F4; font-weight: bold', '',
    'color: #4CAF50; font-weight: bold', '', 'color: #4CAF50; font-weight: bold', '',
    'color: #9E9E9E; font-weight: lighter', ''
  );
}

export function createLoggerMiddleware(): StoreMiddleware {
  logWelcomeMessage();
  return (storeApi) => (next) => (action) => {
    const prevState = storeApi.getState();
    const result = next(action);
    const nextState = storeApi.getState();
    const stateChanged = prevState !== nextState;

    console.groupCollapsed(`%c${getActionTitle(action)}`, getActionTitleStyle(stateChanged));
    console.log('%c action    ', getLogLabelStyle('action'), action);
    if (stateChanged) {
      console.log('%c state    ', getLogLabelStyle('state'), new ChangesPayload(prevState, nextState));
    } else {
      console.log('%c state (no changes)', getLogLabelStyle('state (no changes)'), { state: nextState });
    }
    console.groupEnd();
    return result;
  };
}