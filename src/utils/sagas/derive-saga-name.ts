import type { Saga } from 'redux-saga';

const ANONYMOUS_SAGA_PREFIX = 'anonymousSaga';
const MAX_SNIPPET_LINES = 3;
const MAX_SNIPPET_LENGTH = 72;

const hashSource = (source: string): string => {
  let hash = 2166136261;

  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `${(hash >>> 0).toString(36)}-${source.length.toString(36)}`;
};

const sourceSnippet = (source: string): string => {
  const condensed = source
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .slice(0, MAX_SNIPPET_LINES)
    .join('|')
    .replace(/[^A-Za-z0-9_$]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SNIPPET_LENGTH)
    .replace(/-+$/g, '');

  return condensed || 'source';
};

export const deriveSagaName = (saga: Saga): string => {
  const explicitName = saga.name.trim();

  if (explicitName && explicitName !== 'anonymous') {
    return explicitName;
  }

  const source = saga.toString();

  return `${ANONYMOUS_SAGA_PREFIX}:${sourceSnippet(source)}:${hashSource(source)}`;
};