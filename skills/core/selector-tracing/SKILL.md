---
name: core/selector-tracing
description: >-
  Diagnose Store-created selector performance from opt-in trace events and
  privacy-safe aggregate summaries. Covers the flat traceSelectors contract,
  execution, cache, invalidation, argument, result, and cadence records,
  bounded p95 interpretation, lifecycle, and production safety across all Store
  families.
type: sub-skill
requires:
  - core
triggers:
  - selector tracing
  - selector performance diagnosis
  - selector trace summary
  - selector cache hit
  - selector invalidation
  - selector cadence
---
# Selector tracing — evidence-oriented performance diagnosis

Use this skill when an agent must explain selector recomputation, output-cache
reuse, invalidation, scheduling, or selector duration. The authoritative public
reference is `@augmentcode/themis/docs/SELECTORS.md`; selector tracing types and
runtime behavior are implementation evidence, not a second public API.

## 1. Scope and safety rules

- Tracing is an opt-in diagnostic and is disabled by default in every build. Enable it only
  for a focused reproduction, then remove it or set it back to `false`.
- Tracing never provides selector argument values, selector result values, or
  Redux state values. Do not ask a user to capture them from logs, infer them
  from path names, or paste them into a report.
- Treat `selectorSource` as callback identity only. It is limited to the first
  five source lines and 500 characters; it is not a state snapshot.
- Trace counts describe the observed Store instance and selector identity. Do
  not compare counts from unrelated runs or Store instances without recording
  that boundary.
- Prefer the smallest event-category set that answers the question. A broad
  `true` preset is useful for a short reproduction, not a permanent setting.

## 2. Configure the Store

Tracing is configured as the third constructor argument of `Store`,
`ReactStore`, or `StreamingStore`; pass `undefined` for middleware when there is
no middleware configuration.

```ts
const store = new Store(reducers, undefined, {
  traceSelectors: {
    traceExecution: true,
    traceInvalidation: true,
    traceResults: true,
    minDurationMs: 2,
    summaryEnabled: true,
  },
});
```

The public contract is flat and accepts only `undefined`, `false`, `true`, or a
single object. The object is not nested; arrays and unknown properties are
rejected. Its nine fields are:

| Field | Default | Meaning |
| --- | ---: | --- |
| `traceExecution` | `false` | Execution duration, accessed paths, path count, and recomputation count. |
| `traceCache` | `false` | Direct readable/signal/observable output-cache records. |
| `traceInvalidation` | `false` | Recompute reason and changed accessed paths. |
| `traceArguments` | `false` | Argument identity-change indicator and type-only change metadata. |
| `traceResults` | `false` | Result identity outcome labels for recomputations. |
| `traceCadence` | `false` | Store selector-cadence subscription and tick messages. |
| `minDurationMs` | `0` | Inclusive threshold for execution console records only. |
| `summaryEnabled` | `false` | In-memory aggregate collection and periodic summaries. |
| `summaryIntervalMs` | `1000` | Periodic-summary interval in milliseconds. |

`traceSelectors: true` enables all six event categories with a zero duration
threshold but does not enable summaries. `undefined` and `false` disable every
category. Object fields are independent: enabling invalidation does not enable
execution, arguments, results, cache, or cadence. Both numeric fields must be
finite and non-negative; category and `summaryEnabled` fields must be boolean.

The legacy `store.traceSelectors()` compatibility method can activate the same
event preset in any build when construction used omitted or `false` tracing
options. A configured object remains authoritative; do not use the method to
override it.

## 3. Read console records as evidence

Enabled records use `console.info` and the `[themis] selector trace` prefix.
Fields are emitted only when their category is enabled, except that a summary
collector can observe metadata without printing every corresponding category.

### Execution records

Execution records identify the callback with `selectorSource` and report:

- `recomputationCount`: cumulative recomputation number; memoized reads do not
  increment it.
- `accessedPathCount`: number of observed state paths.
- `accessedPaths`: sorted rendered paths; dynamic argument-derived keys use the
  stable `<selector-argument>` marker.
- `executionDurationMs`: callback duration in milliseconds, emitted when it is
  at least `minDurationMs`.

Use duration and recomputation count together. A slow callback with few
recomputations suggests expensive selector work; a fast callback with an
unexpectedly high count suggests broad reads, unstable arguments, or an overly
active update path. A duration threshold filters only console execution
records; it does not suppress invalidation, argument, or result records, and it
does not remove valid durations from summaries.

### Invalidation records

`invalidationReason` is one of:

- `first-execution` — no prior computation exists.
- `selector-arguments-changed` — shallow argument identity changed.
- `accessed-state-paths-changed` — a previously accessed path changed.
- `previous-result-unavailable` — recomputation was needed without a usable
  previous result.

`changedAccessedPaths` is the sorted set of changed accessed paths. The first
execution has an empty list. Interpret this as dependency evidence, not as a
state diff: values are intentionally absent.

### Argument records

`argumentsChanged` reports whether argument identity changed for the
computation. `changedArguments` contains only `position`, `previousType`, and
`currentType`; it never contains argument values. Repeated fresh object, array,
or function arguments therefore show identity churn without exposing their
contents. Prefer stable scalar arguments where possible; stable intentional
references remain valid.

### Result records

`resultOutcome` is one of `initial`, `changed`, or `retained-reference`. These
labels describe reference/change behavior only. They do not log or imply the
result value. A `retained-reference` recomputation means work occurred while
the selector returned the previous reference; investigate why it recomputed
before adding memoization or schedulers.

### Output-cache records

Cache records describe direct Svelte readable, React signal, or StreamingStore
Kefir observable output reuse and contain:

- `selectorSource`;
- `observableCacheRequestCount` and `observableCacheCachedCount`;
- `outputCacheStatus`: `hit` or `miss`;
- cumulative `outputCacheRequestCount`, `outputCacheHitCount`, and
  `outputCacheMissCount`.

`hit` means an existing direct output was reused; `miss` means a new output was
created. These are output-cache requests, not selector callback recomputations.
Cache counters are scoped by Store state source plus selector identity.

### Cadence records

Cadence diagnostics are separate scheduling messages, not selector payloads:

- `SUBSCRIBE SELECTOR CADENCE` reports the current subscriber count.
- `SELECTOR CADENCE TICK` reports the tick timestamp and listener count.

Use them to distinguish Store scheduling pressure from selector computation.
They do not expose state or selector values.

## 4. Aggregate summaries

Set `summaryEnabled: true` for privacy-preserving per-selector aggregation, then
read a non-resetting snapshot with:

```ts
const summaries = store.getSelectorTraceSummary();
```

The snapshot is deep-frozen. With tracing disabled or before any summary data
exists, it is an empty array. Each selector entry contains:

| Group | Fields and interpretation |
| --- | --- |
| Identity | `selectorSource` safe callback snippet. |
| Work | `executionCount`, `recomputationCount`. |
| Invalidation | Counts for all four invalidation reasons. |
| Results | Counts for `initial`, `changed`, and `retained-reference`. |
| Duration | `count`, `totalMs`, `averageMs`, `maximumMs`, `p95Ms`. |
| Cache | `requestCount`, `hitCount`, `missCount`, `hitRatio`; ratio is `null` with no requests. |

Duration totals, averages, maxima, and counts are lifetime aggregates. `p95Ms`
is calculated from a bounded ring buffer retaining at most 64 duration samples;
it is a bounded-window percentile, not a percentile over every lifetime event.
Do not treat it as an exact long-term tail latency. Cache, invalidation, and
result summaries retain metadata only, never argument, result, or state values.

After `init()`, summary collection starts one interval using
`summaryIntervalMs`. Repeated `init()` calls do not create duplicate intervals.
Periodic records use the `[themis] selector trace summary` prefix and the same
snapshot shape. The initializer disposer and `store.dispose()` stop the
interval and normal selector cadence resources.

## 5. Store-family symmetry and lifecycle

The tracing options, events, summary shape, privacy behavior, and
default-off/explicit-activation semantics are shared by all three Store
families:

| Family | Public direct selector output |
| --- | --- |
| `Store` from `@augmentcode/themis/svelte-store` | Svelte `Readable` |
| `ReactStore` from `@augmentcode/themis/react-store` | Preact `ReadonlySignal` |
| `StreamingStore` from `@augmentcode/themis/streaming-store` | Kefir `Observable` |

Tracing observes shared selector computation and output-cache behavior behind
these adapters. Do not mix family-specific lifecycle patterns in one app.

Initialize before direct reactive selector calls and retain the returned
disposer until the Store is no longer used:

```ts
const dispose = store.init();
// Reproduce the interaction through the normal selector call path.
dispose();
```

`store.dispose()` is the equivalent explicit cleanup. It evicts direct selector
outputs, stops summary intervals, disposes cadence resources, and stops running
sagas. Do not infer a tracing failure from the absence of records before
`init()` or after disposal.

## 6. Default-off production behavior and privacy

Tracing remains disabled by default in production as well as development. When
explicitly enabled, production constructor options, the legacy activation
method, reporters, summary collectors, summary timers, console output, and
category-specific tracing work are active. Default and `false` configurations
are silent and should not allocate diagnostic work. Keep tracing omitted or
`false` in normal builds and remove temporary diagnostic configuration after the
investigation.

Path metadata is redacted before it is reported. Dynamic property keys derived
from selector arguments—including identifier-like keys—are rendered as
`<selector-argument>` in accessed and changed paths. Never attempt to reverse
that marker by correlating it with application data.

## 7. Common mistakes

- **Expecting `true` to enable summaries:** `true` enables six event categories;
  explicitly set `summaryEnabled: true` for collection.
- **Using nested or array configuration:** the contract is one flat object;
  unknown properties, arrays, and invalid numeric values are rejected.
- **Reading `minDurationMs` as a global filter:** it filters execution console
  records only; summaries and other categories follow their own rules.
- **Treating a cache hit as a callback hit:** output-cache hits concern direct
  adapter reuse, while recomputation counts concern selector callback work.
- **Treating p95 as exact lifetime latency:** only the latest bounded sample
  window contributes to p95; lifetime count and totals remain separate.
- **Calling readable/signal/observable selectors before init or after dispose:**
  initialize first and use `.select(...)` for explicit state reads where the
  family lifecycle requires it.
- **Adding manual memoization, debounce, or throttle layers:** Store-owned
  selector caching and cadence already exist; diagnose first with traces.
- **Logging values to enrich a trace:** this violates the privacy contract. Use
  source identity, paths, types, counts, durations, and labels only.

## 8. Concise troubleshooting workflow

1. Confirm the Store family and the exact Store instance. Add the smallest flat
   object configuration needed, call `init()`, and reproduce through the real
   selector path.
2. Filter for `[themis] selector trace`. Start with execution duration,
   `recomputationCount`, and `accessedPaths`; check whether the dependency set
   is broader than intended.
3. If recomputations are unexpected, enable invalidation and arguments. Separate
   changed accessed paths from `selector-arguments-changed`; use only the
   type/position metadata to identify unstable argument identity.
4. Enable results to distinguish changed output references from
   `retained-reference`. Do not inspect or request the underlying result.
5. Enable cache and compare output-cache status and counters. A miss may be
   expected for a new Store/source or unstable direct-call identity; verify
   Store/source boundaries before comparing counts.
6. Enable cadence only when scheduling is suspected. Compare subscription and
   tick messages with selector records; cadence messages contain no payload.
7. For a repeatable comparison, enable summaries, capture frozen snapshots
   before and after the change, compare counts, invalidation labels, cache
   ratios, and bounded p95, then dispose and turn tracing off.

## 9. Evidence-oriented handoff

Report the exact Store family, option fields enabled, initialization/disposal
sequence, reproduction boundary, and relevant field names. Include redacted
trace metadata or aggregate counts only—never selector arguments, result/state
values, or guessed values hidden behind path markers. Record validation such as
`git diff --check` for documentation changes and focused tests or build checks
when the task also changed runtime code.

## See also

- `@augmentcode/themis/docs/SELECTORS.md` — complete selector and tracing
  reference.
- `../debugging/SKILL.md` — Store lifecycle and runtime inspection boundaries.
- `../testing/SKILL.md` — focused selector and Store verification guidance.
- The selected Store-family selector skill — family-specific call modes; keep
  one concrete Store family per app/code path.