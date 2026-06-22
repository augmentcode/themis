import { describe, expect, it } from 'vitest';
import { deriveSagaName } from './derive-saga-name';

describe('deriveSagaName', () => {
  it('uses the saga function name when available', () => {
    function* namedSaga() {}

    expect(deriveSagaName(namedSaga)).toBe('namedSaga');
  });

  it('generates a deterministic recognizable name from anonymous saga source', () => {
    const sagaA = function* () {
      yield 'fetchTodos';
      yield 'putDone';
      yield 'ignoredAfterSnippetLimit';
    };
    const sagaB = function* () {
      yield 'fetchTodos';
      yield 'putDone';
      yield 'ignoredAfterSnippetLimit';
    };
    Object.defineProperty(sagaA, 'name', { value: '' });
    Object.defineProperty(sagaB, 'name', { value: '' });

    const derivedName = deriveSagaName(sagaA);

    expect(derivedName).toBe(deriveSagaName(sagaB));
    expect(derivedName).toContain('fetchTodos');
    expect(derivedName).toContain('putDone');
    expect(derivedName).toMatch(/^anonymousSaga:[A-Za-z0-9_$-]+:[a-z0-9]+-[a-z0-9]+$/);
    expect(derivedName.length).toBeLessThanOrEqual(110);
  });
});