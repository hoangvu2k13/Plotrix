# FIXES.md — Plotrix Source Audit

---

## PERFORMANCE

### P1 — Analysis Worker Re-Created on Every Error

File: `lib/state/graph.svelte.ts`, lines ~1180-1200 (`resetAnalysisWorker`)
Problem: When the analysis worker throws any error, `resetAnalysisWorker()` is called, which terminates the worker and sets it to null. The next call to `ensureAnalysisWorker()` spawns a brand-new Worker, paying the full module-parse + initialization cost all over again. In a loop of bad equations (e.g., rapid typing), this kills performance repeatedly.
Fix:

```ts
// Replace resetAnalysisWorker with a restart-with-backoff strategy
let workerRestartAttempts = 0;
const MAX_WORKER_RESTARTS = 5;
function resetAnalysisWorker(): void {
	pendingAnalysisRequests.clear();
	pendingIntersectionRequests.clear();
	pendingFitRequests.clear();
	analysisWorker?.terminate();
	analysisWorker = null;
	workerRestartAttempts += 1;
	if (workerRestartAttempts <= MAX_WORKER_RESTARTS) {
		// Exponential backoff before re-creating
		setTimeout(
			() => {
				ensureAnalysisWorker();
				requestRender();
			},
			Math.min(100 * 2 ** workerRestartAttempts, 3000)
		);
	}
	requestRender();
}
```

### P2 — `variableScope()` Uses Expensive Snapshot Comparison on Every Call

File: `lib/state/graph.svelte.ts`, lines ~1085-1110 (`variableScope`)
Problem: Every call to `variableScope()` allocates a new array (`nextSnapshot`) with `.map()`, then iterates it to compare with `lastVariableSnapshot`. This is called from the render loop, from every equation evaluation, and from the canvas paint path — potentially dozens of times per frame. The allocation pressure alone causes GC pauses.
Fix:

```ts
// Use a hash-only fast path — compute a cheap string key upfront
let lastVariablesKey = '';
function variableScope(): Record<string, number> {
	const vars = graph.variables;
	// Build key without allocating an array object
	let key = '';
	for (let i = 0; i < vars.length; i++) {
		key += vars[i]!.name + ':' + vars[i]!.value + '|';
	}
	if (key === lastVariablesKey) return memoizedVariableScope;
	lastVariablesKey = key;
	graph.variablesHash = key;
	const scope: Record<string, number> = Object.create(null);
	for (let i = 0; i < vars.length; i++) {
		scope[vars[i]!.name] = vars[i]!.value;
	}
	memoizedVariableScope = scope;
	return scope;
}
```

### P3 — `MemoryBoundCanvasCache` Eviction Runs via `queueMicrotask` but `set()` Synchronously Allocates

File: `lib/renderer/canvas.ts`, lines ~168-240 (`MemoryBoundCanvasCache`)
Problem: Every `cache.set()` call synchronously copies bytes counts and pushes entries. The eviction path is deferred with `queueMicrotask`, but callers still block the main thread during all the bookkeeping. During rapid panning, `setCanvasCacheEntry` is called for polar curves, shading, and scatter data on nearly every frame, causing hundreds of micro-allocations per second.
Fix: Pool the cache layers more aggressively AND make eviction synchronous for the over-limit case to avoid memory bloat:

```ts
set(key: string, layer: CacheLayer): CacheLayer[] {
  const bytes = layer.width * layer.height * 4;
  const existing = this.entries.get(key);
  const evicted: CacheLayer[] = [];
  if (existing) {
    this.totalBytes -= existing.bytes;
    this.entries.delete(key);
    evicted.push(existing.layer);
  }
  this.entries.set(key, { layer, bytes });
  this.totalBytes += bytes;
  // Evict synchronously when critically over budget to prevent OOM
  if (this.totalBytes > CACHE_MEMORY_LIMIT * 1.5) {
    while (this.totalBytes > CACHE_MEMORY_LIMIT && this.entries.size > 1) {
      const oldest = this.entries.keys().next().value;
      if (!oldest) break;
      const entry = this.entries.get(oldest)!;
      this.totalBytes -= entry.bytes;
      evicted.push(entry.layer);
      this.entries.delete(oldest);
    }
  }
  return evicted;
}
```

### P4 — `drawEquations` Calls `sampleEquation` Every Frame for Cartesian Curves

File: `lib/renderer/canvas.ts`, lines ~1750-1800 (`drawCurve`)
Problem: The `curveGeometryCache` key includes `viewportKey` which buckets pan/zoom changes into coarse buckets. However, ANY change to `graph.variablesHash` (slider drag) invalidates ALL cached curve geometry for ALL equations, not just the one that uses that variable. During slider animation at 60 fps, every equation re-samples on every frame.
Fix: Key the geometry cache per-equation and per-variable-subset, not the full variables hash:

```ts
// In drawCurve, build a targeted variables key
function buildEquationVariableKey(equation: PlotEquation, scope: Record<string, number>): string {
	if (!equation.freeVariables.length) return '';
	return equation.freeVariables.map((v) => `${v}:${scope[v] ?? 0}`).join('|');
}
// Then use in geometryCacheKey:
const equationVarKey = buildEquationVariableKey(equation, scope);
const geometryCacheKey = [
	equation.id,
	equation.raw,
	viewportKey,
	equationVarKey, // only variables THIS equation actually uses
	budget.baseSamples,
	budget.maxSamples
].join(':');
```

### P5 — `TEXT_MEASURE_CACHE` in Canvas Renderer Uses `ctx.font` as Key But Font Resets on Every `ctx.save()/restore()`

File: `lib/renderer/canvas.ts`, lines ~280-295 (`measureTextWidth`)
Problem: `ctx.font` is read from the canvas context on every `measureTextWidth` call. The canvas `save/restore` pattern in `drawCriticalPoints` resets font state, meaning `ctx.font` returns different strings at different call sites. The LRU cache has a 200-entry limit and constantly thrashes because the same label text gets multiple cache entries for subtle font string differences. This forces expensive `measureText` calls on the hot label-placement path.
Fix: Set font once per paint cycle and pass it explicitly:

```ts
// Add a per-frame font constant at top of paint()
const LABEL_FONT = `600 10px ${tokens.fontSans}`;
const CHIP_FONT = `600 12px ${tokens.fontSans}`;
// Replace measureTextWidth signature:
function measureTextWidth(
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
	label: string,
	font: string // explicit, never read from ctx
): number {
	const cacheKey = `${font}:${label}`;
	const cached = TEXT_MEASURE_CACHE.get(cacheKey);
	if (cached !== undefined) return cached;
	const prev = ctx.font;
	ctx.font = font;
	const measured = ctx.measureText(label).width;
	ctx.font = prev;
	TEXT_MEASURE_CACHE.set(cacheKey, measured);
	return measured;
}
```

### P6 — Implicit Curve and Inequality Rendering Re-Samples Scalar Field Every Frame

File: `lib/renderer/canvas.ts`, lines ~1665-1720 (`drawImplicitCurve`, `drawInequalityShading`)
Problem: Implicit curves call `this.sampleScalarField()` on every single frame with no caching. For a 400-column × 300-row grid, that's 120,000 evaluations of `evaluateImplicitAt` per frame, each crossing the JS–WASM boundary via mathjs. During panning at 60 fps this completely saturates the main thread.
Fix: Add a viewport-keyed cache for implicit scalar fields:

```ts
private implicitFieldCache = new LruMap<string, ScalarField>(12);
private getCachedScalarField(
  equation: PlotEquation,
  cols: number,
  rows: number,
  surface: SurfaceContext,
  viewportKey: string,
  scope: Record<string, number>
): ScalarField {
  const key = `${equation.id}:${equation.raw}:${viewportKey}:${cols}x${rows}`;
  const cached = this.implicitFieldCache.get(key);
  if (cached) return cached;
  const field = this.sampleScalarField(surface, cols, rows, (x, y) =>
    evaluateImplicitAt(equation.compiledExpression ?? equation.compiled, x, y, scope)
  );
  this.implicitFieldCache.set(key, field);
  return field;
}
```

### P7 — `sampleRangeBuffers` in `equationAnalysis.ts` Allocates Two `Float64Array`s on Every Analysis Call

File: `lib/analysis/equationAnalysis.ts`, lines ~50-65 (`sampleRangeBuffers`)
Problem: `sampleRangeBuffers` allocates fresh `Float64Array(count)` on every call. It's called from `inferRange` (512 samples), `detectPeriod` (360 samples), and `detectVerticalAsymptotes` (320 samples) — totalling ~1200 Float64 allocations per full analysis. Analysis runs in a Worker, but this still contributes to GC pressure in the worker thread.
Fix: Pre-allocate reusable typed buffers at module level:

```ts
const MAX_SAMPLE_BUFFER = 2048;
const _xBuf = new Float64Array(MAX_SAMPLE_BUFFER);
const _yBuf = new Float64Array(MAX_SAMPLE_BUFFER);
function sampleRangeBuffers(
	evaluate: (x: number) => number | null,
	xMin: number,
	xMax: number,
	count: number
) {
	const n = Math.min(count, MAX_SAMPLE_BUFFER);
	const step = n > 1 ? (xMax - xMin) / (n - 1) : 0;
	for (let i = 0; i < n; i++) {
		const x = xMin + step * i;
		_xBuf[i] = x;
		_yBuf[i] = evaluate(x) ?? NaN;
	}
	// Return views, not copies
	return { xBuf: _xBuf.subarray(0, n), yBuf: _yBuf.subarray(0, n) };
}
```

### P8 — `drawCriticalPoints` Label Placement Loop is O(n²)

File: `lib/renderer/canvas.ts`, lines ~2050-2120 (`drawCriticalPoints`)
Problem: The label deduplication loop runs `occupied.some(rect => ...)` inside a `while` loop for every label. With 50 critical points this is O(n²) rectangle intersection tests on the hot render path. For dense function graphs this visibly drops frames.
Fix: Use a grid-based spatial index for occupied rects:

```ts
// Replace the occupied array with a simple row-bucket map
const ROW_HEIGHT = 16;
const occupiedByRow = new Map<number, Array<{ left: number; right: number }>>();
function rowsFor(top: number, bottom: number): number[] {
	const rows: number[] = [];
	for (let r = Math.floor(top / ROW_HEIGHT); r <= Math.floor(bottom / ROW_HEIGHT); r++)
		rows.push(r);
	return rows;
}
function isOccupied(left: number, top: number, right: number, bottom: number): boolean {
	for (const row of rowsFor(top, bottom)) {
		for (const slot of occupiedByRow.get(row) ?? []) {
			if (left < slot.right && right > slot.left) return true;
		}
	}
	return false;
}
function markOccupied(left: number, top: number, right: number, bottom: number): void {
	for (const row of rowsFor(top, bottom)) {
		const slots = occupiedByRow.get(row) ?? [];
		slots.push({ left, right });
		occupiedByRow.set(row, slots);
	}
}
// Then replace occupied.some / occupied.push with isOccupied / markOccupied
```

### P9 — Intersection Detection Worker Message Contains Full Raw Equations Strings on Every Pan

File: `lib/state/graph.svelte.ts`, lines ~1405-1440 (`getIntersections`)
Problem: On every call to `getIntersections()`, the viewport range key is computed and compared, but on ANY pan/zoom the key changes and a new worker message is posted containing all visible equation `raw` strings. These strings can be 200+ chars each, and the message is structured-cloned on the main thread before being posted to the worker. At 60 fps during pan, this clones the same data 60 times per second.
Fix: Add a stable fingerprint and debounce the worker message:

```ts
let lastIntersectionPostTime = 0;
const INTERSECTION_DEBOUNCE_MS = 80; // 12.5 fps is plenty for intersections
function getIntersections(): IntersectionPoint[] {
	// ... existing cache check ...
	const now = performance.now();
	if (
		worker &&
		!pendingIntersectionRequests.has(key) &&
		now - lastIntersectionPostTime > INTERSECTION_DEBOUNCE_MS
	) {
		lastIntersectionPostTime = now;
		pendingIntersectionRequests.add(key);
		worker.postMessage({
			/* ... */
		});
	}
	return cached ?? [];
}
```

### P10 — `nativeCompileCache` in `engine.ts` is an LRU of `EvalFunction` Objects — Unbounded Recompilation

File: `lib/math/engine.ts`, lines ~165-180 (`compileNativeExpression`)
Problem: `nativeCompileCache` has a limit of 200. When a user has 201+ unique expression strings (e.g., after editing many equations), the oldest compiled expression is evicted. The next time that expression is needed (e.g., after undo), it recompiles from scratch via `math.parse()` + `node.compile()`, which is one of the slowest operations in the codebase. Cache limit should be 1000 for a math graphing app.
Fix:

```ts
const nativeCompileCache = new LruMap<string, EvalFunction>(1000); // was 200
```

### P11 — `GraphCanvas` Effect Triggers Full Re-Render on Every Single View Property Change

File: `lib/components/GraphCanvas.svelte`, lines ~150-170 (the `$effect` that reads `graph.view.*`)
Problem: The effect reads six separate reactive properties (`originX, originY, scaleX, scaleY, width, height`) all in one block. In Svelte 5, each property access creates a separate subscription. But they all trigger the same re-render. During a pinch-zoom event, `scaleX`, `scaleY`, `originX`, and `originY` can all change in the same tick, causing 4 separate effect runs.
Fix: Consolidate into a single derived value and gate on actual change:

```ts
// Create a single viewport signature
const viewSignature = $derived(
	`${graph.view.originX},${graph.view.originY},${graph.view.scaleX},${graph.view.scaleY},${graph.viewport.width},${graph.viewport.height}`
);
$effect(() => {
	void viewSignature; // single subscription
	if (editingBounds) return;
	const range = visibleRange();
	rangeInputs = {
		xMin: range.xMin.toFixed(2),
		xMax: range.xMax.toFixed(2),
		yMin: range.yMin.toFixed(2),
		yMax: range.yMax.toFixed(2)
	};
});
```

### P12 — `WorkspaceShell` Computes `sidebarItems` as a Derived That Iterates All Equations on Every Keystroke

File: `lib/components/WorkspaceShell.svelte`, lines ~400-450 (`sidebarItems`)
Problem: `sidebarItems` is a `$derived.by` that runs on every change to `graph.equations`, `graph.folders`, or `equationQuery`. It iterates all equations for every folder check (`assignedEquationIds`, `folder.equationIds.includes(...)`) making it O(equations × folders). With 30 equations and 10 folders this is 300 iterations on every single keystroke in the search box.
Fix: Pre-compute a Set and Map for O(1) lookups:

```ts
const sidebarItems = $derived.by<SidebarListItem[]>(() => {
	const needle = equationQuery.trim().toLowerCase();
	const indexed = graph.equations.map((equation, index) => ({ equation, index }));
	// O(1) lookup maps
	const equationToFolder = new Map<string, string>();
	for (const folder of graph.folders) {
		for (const id of folder.equationIds) equationToFolder.set(id, folder.id);
	}
	const items: SidebarListItem[] = [];
	// ... rest of logic using equationToFolder.get() instead of .includes()
});
```

### P13 — `AnalysisPanel` Has an Effect That Runs `graph.getEquationAnalysis()` Twice

File: `lib/components/AnalysisPanel.svelte`, lines ~90-115 and ~120-135
Problem: Two separate `$effect` blocks both call `graph.getEquationAnalysis(equation.id)`. The first runs on `ui.activeAnalysisEquationId` change, the second runs as a polling update. This means on activation, `getEquationAnalysis` is called twice, potentially triggering two worker messages for the same key.
Fix: Merge into a single effect with proper guard:

```ts
$effect(() => {
	const target = equation;
	if (!target) {
		report = null;
		loading = false;
		errorMessage = null;
		return;
	}
	const next = graph.getEquationAnalysis(target.id);
	const failed = graph.hasEquationAnalysisFailure(target.id);
	if (next) {
		report = next;
		loading = false;
		errorMessage = null;
	} else if (failed) {
		loading = false;
		errorMessage = 'Plotrix could not build an analysis report for this equation.';
	} else {
		loading = true;
		errorMessage = null;
		report = null;
	}
});
```

### P14 — `fitAll` Calls `evaluateCartesianAt` in a Tight Loop on the Main Thread

File: `lib/state/graph.svelte.ts`, lines ~1315-1380 (`fitAll`)
Problem: `fitAll()` samples 160 points per cartesian equation synchronously on the main thread before posting to the worker. If there are 20 equations each with 160 samples = 3200 `evaluateCartesianAt` calls, each going through `compileNode` → `safeEvaluateCompiled` → mathjs evaluate. This freezes the UI for 50-200ms on complex expressions.
Fix: Move all sampling to the worker and don't block the main thread at all:

```ts
function fitAll(recordHistory = true): void {
	const visibleEquations = graph.equations.filter(
		(eq) =>
			eq.visible &&
			!eq.errorMessage &&
			eq.kind !== 'inequality' &&
			eq.kind !== 'slopefield' &&
			eq.kind !== 'vectorfield'
	);
	if (!visibleEquations.length) {
		resetView(recordHistory);
		return;
	}
	// Let worker do ALL sampling — no main-thread sampling at all
	const scope = variableScope();
	const fitKey = `fit:${visibleEquations.map((e) => e.id).join(',')}:${graph.variablesHash}`;
	const worker = ensureAnalysisWorker();
	if (worker && !pendingFitRequests.has(fitKey)) {
		pendingFitRequests.set(fitKey, { recordHistory, dataBounds: computeDataBounds() });
		worker.postMessage({
			type: 'fitBounds',
			key: fitKey,
			equations: visibleEquations.map((eq) => ({
				id: eq.id,
				kind: eq.kind,
				raw: eq.raw,
				color: eq.color,
				paramRange: [...eq.paramRange] as [number, number]
			})),
			variables: scope,
			viewport: {
				/* ... */
			}
		});
	}
}
function computeDataBounds(): { minX: number; maxX: number; minY: number; maxY: number } | null {
	// Only the O(rows) data scan — no equation evaluation
	let minX = Infinity,
		maxX = -Infinity,
		minY = Infinity,
		maxY = -Infinity;
	for (const series of graph.dataSeries.filter((s) => s.plotted && s.visible)) {
		for (const row of series.rows) {
			const x = Number(row[0]),
				y = Number(row[1]);
			if (isFinite(x) && isFinite(y)) {
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
		}
	}
	return isFinite(minX) ? { minX, maxX, minY, maxY } : null;
}
```

### P15 — `detectPeriod` in `equationAnalysis.ts` Uses Two `Math.max(...array)` Spread Calls

File: `lib/analysis/equationAnalysis.ts`, lines ~135-145 (`inferRange`)
Problem: `const min = Math.min(...samples)` and `const max = Math.max(...samples)` use the spread operator on up to 512-element arrays. The spread converts the array into function arguments, which blows the JS stack for large arrays and is significantly slower than a manual loop. This runs in the Worker but is still a waste of cycles.
Fix:

```ts
let min = Infinity,
	max = -Infinity;
for (let i = 0; i < samples.length; i++) {
	const v = samples[i]!;
	if (v < min) min = v;
	if (v > max) max = v;
}
```

### P16 — `toSVGString()` Creates Segments With `.map()` and `.filter()` Chained — No Path Batching

File: `lib/renderer/canvas.ts`, lines ~540-590 (`toSVGString`)
Problem: SVG export samples 240 points per equation (fine), but then calls `.map()` → `.filter()` → `.join()` on every segment separately, creating intermediate string arrays before joining. For 20 equations with 10 segments each, this allocates 400+ intermediate arrays. SVG paths should be built with a `StringBuilder` pattern.
Fix:

```ts
const pathParts: string[] = [];
for (const segment of segments) {
	if (segment.length < 4) continue;
	const [x0, y0] = this.mathToCanvas(segment[0]!, segment[1]!);
	pathParts.push(`M ${x0.toFixed(2)} ${y0.toFixed(2)}`);
	for (let i = 2; i < segment.length; i += 2) {
		const [cx, cy] = this.mathToCanvas(segment[i]!, segment[i + 1]!);
		pathParts.push(`L ${cx.toFixed(2)} ${cy.toFixed(2)}`);
	}
}
const d = pathParts.join(' ');
```

### P17 — `EquationCard` KaTeX Render Effect Runs for Every Character Typed

File: `lib/components/EquationCard.svelte`, lines ~95-115 (KaTeX preview effect)
Problem: The `$effect` tracking `equation.raw` fires on every single keypress, invoking `renderKatex` with no debounce. `renderKatex` posts to the KaTeX Worker immediately. With 10 equations and a user typing fast, this floods the Worker queue with stale render requests. The LRU cache helps for cached values, but novel expressions always bypass cache.
Fix: Debounce KaTeX renders by 200ms:

```ts
let katexDebounceTimer: ReturnType<typeof setTimeout> | null = null;
$effect(() => {
	const source = equation.raw.trim() || 'y=x';
	const latex = toLatex(source, equation.kind);
	const cacheKey = `${equation.kind}:${latex}:inline`;
	const cached = getCachedKatex(cacheKey);
	const token = ++previewRenderToken;
	// Show cached result immediately
	previewHtml = cached ?? source;
	if (cached) return;
	// Debounce uncached renders
	if (katexDebounceTimer) clearTimeout(katexDebounceTimer);
	katexDebounceTimer = setTimeout(() => {
		renderKatex(cacheKey, latex, false, source).then((html) => {
			if (token === previewRenderToken) previewHtml = html;
		});
	}, 200);
});
```

### P18 — `InteractionManager.handlePointerMove` Calls `updateTrace` on Every Mouse Move Event Even When Trace Mode is Off

File: `lib/input/interactions.ts`, lines ~290-310
Problem: `updateTrace(point.x, point.y)` is called on every `pointermove` event (up to 240/sec on high-frequency mice), even though the first thing `updateTrace` does is check `if (!this.graph.settings.traceMode) { return; }`. But before that early return, the call stack still pays: function call overhead, `this.graph.settings` property lookup, and the check itself — all in the 240 Hz hot path.
Fix: Hoist the check to the caller:

```ts
// In handlePointerMove, replace:
this.updateTrace(point.x, point.y);
// With:
if (this.graph.settings.traceMode) this.updateTrace(point.x, point.y);
```

### P19 — `ExpressionEditor` Recreates Full CodeMirror Extensions Array on Mount Without Memoization

File: `lib/components/ExpressionEditor.svelte`, lines ~100-150 (`onMount`)
Problem: `completionEntries(kind)` creates a new array of completion objects on every editor mount. With 10+ equations, this runs 10+ times on page load, each time allocating ~30 objects with `label` and `type` properties. These could be computed once per `kind` value since `kind` never changes for a mounted editor.
Fix:

```ts
const COMPLETION_CACHE = new Map<string, ReturnType<typeof completionEntries>>();
function completionEntries(kind: EquationKind) {
  if (COMPLETION_CACHE.has(kind)) return COMPLETION_CACHE.get(kind)!;
  const entries = /* ... existing logic ... */;
  COMPLETION_CACHE.set(kind, entries);
  return entries;
}
```

### P20 — `adaptiveSimpsonRecursive` Has No Iteration Limit and Can Stack Overflow

File: `lib/analysis/equationAnalysis.ts`, lines ~285-325 (`adaptiveSimpsonRecursive`)
Problem: `adaptiveSimpsonRecursive` with `depth=10` can recurse to 2^10 = 1024 calls for a single interval. When called from `integrateVisibleFiniteIntervals` with 96 sub-intervals, worst case is 96 × 1024 = 98,304 stack frames. On complex discontinuous functions this hits the JavaScript call stack limit, crashing the Worker silently.
Fix: Convert to iterative using an explicit stack:

```ts
function adaptiveSimpsonIterative(
	evaluate: (x: number) => number | null,
	a: number,
	b: number,
	depth = 10
): number | null {
	interface Task {
		a: number;
		b: number;
		fa: number;
		fm: number;
		fb: number;
		whole: number;
		depth: number;
	}
	const stack: Task[] = [];
	const fa = evaluate(a),
		fm = evaluate((a + b) / 2),
		fb = evaluate(b);
	if (fa === null || fm === null || fb === null || !isFinite(fa) || !isFinite(fm) || !isFinite(fb))
		return null;
	stack.push({ a, b, fa, fm, fb, whole: simpsonEstimate(a, b, fa, fm, fb), depth });
	let total = 0;
	while (stack.length) {
		const { a, b, fa, fm, fb, whole, depth: d } = stack.pop()!;
		const mid = (a + b) / 2;
		const lm = evaluate((a + mid) / 2),
			rm = evaluate((mid + b) / 2);
		if (lm === null || rm === null || !isFinite(lm) || !isFinite(rm)) {
			total += whole;
			continue;
		}
		const left = simpsonEstimate(a, mid, fa, lm, fm);
		const right = simpsonEstimate(mid, b, fm, rm, fb);
		const refined = left + right;
		if (d <= 0 || Math.abs(refined - whole) < 1e-6 * Math.max(1, Math.abs(refined))) {
			total += refined + (refined - whole) / 15;
		} else {
			stack.push({ a, b: mid, fa, fm: lm, fb: fm, whole: left, depth: d - 1 });
			stack.push({ a: mid, b, fa: fm, fm: rm, fb, whole: right, depth: d - 1 });
		}
	}
	return total;
}
```

### P21 — `drawPolyline` Tests Every Segment With `clipLineToRect` Individually Without Early Rejection

File: `lib/renderer/canvas.ts`, lines ~1960-1995 (`drawPolyline`)
Problem: For a cartesian curve with 1200 sample points, `drawPolyline` loops through 599 segment pairs and calls `clipLineToRect` on each. But it never checks whether a point is trivially outside the entire viewport before doing Cohen-Sutherland clipping. For curves that are mostly off-screen (zoomed in), this wastes CPU on 90%+ of segments.
Fix: Add a bounding-box pre-rejection:

```ts
private drawPolyline(...): void {
  if (points.length < 2) return;
  const padX = 24, padY = 24;
  const left = -padX, top = -padY;
  const right = width + padX, bottom = height + padY;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!, curr = points[i]!;
    // Fast reject: both points trivially outside same half-plane
    if ((prev[0] < left && curr[0] < left) ||
        (prev[0] > right && curr[0] > right) ||
        (prev[1] < top && curr[1] < top) ||
        (prev[1] > bottom && curr[1] > bottom)) continue;
    const dy = Math.abs(curr[1] - prev[1]);
    const dx = Math.abs(curr[0] - prev[0]);
    const angle = Math.atan2(dy, Math.max(dx, 1e-6));
    if (dx < 12 && dy > height * 0.9 && angle > 1.48) continue;
    if (!clipLineToRect(prev[0], prev[1], curr[0], curr[1], left, top, right, bottom, this.clipBuffer)) continue;
    ctx.moveTo(this.clipBuffer[0], this.clipBuffer[1]);
    ctx.lineTo(this.clipBuffer[2], this.clipBuffer[3]);
  }
}
```

### P22 — `workspaceSync.svelte.ts` `blobToDataUrl` Called Every Flush Even When PNG Unchanged

File: `lib/firebase/workspace-sync.svelte.ts`, lines ~285-310 (`flushRemoteWrite`)
Problem: Every time `flushRemoteWrite()` runs, it calls `graph.exportPNG(1)` to generate a thumbnail, which re-renders the entire graph to a canvas, converts to PNG Blob, then calls `blobToDataUrl` — all blocking the microtask queue. This runs after EVERY user interaction (panning, typing an equation, slider drag). A thumbnail only needs updating when equations actually change.
Fix: Cache the thumbnail and only regenerate when equation content changes:

```ts
let lastThumbnailEquationHash = '';
let cachedThumbnailDataUrl: string | null = null;
async function getThumbnail(): Promise<string | null> {
	if (graph.backgroundImages.length > 0) return null;
	const equationHash = graph.equations.map((e) => `${e.id}:${e.raw}:${e.color}`).join('|');
	if (equationHash === lastThumbnailEquationHash && cachedThumbnailDataUrl) {
		return cachedThumbnailDataUrl;
	}
	const blob = await graph.exportPNG(1);
	if (!blob || blob.size > THUMBNAIL_DATA_URL_LIMIT) return null;
	const url = await blobToDataUrl(blob).catch(() => null);
	if (url && url.length <= THUMBNAIL_DATA_URL_LIMIT) {
		cachedThumbnailDataUrl = url;
		lastThumbnailEquationHash = equationHash;
	}
	return cachedThumbnailDataUrl;
}
```

### P23 — History Serialization Calls `stringifySnapshot` Twice for the Same Snapshot

File: `lib/state/graph.svelte.ts`, lines ~870-910 (`commitHistory`)
Problem: `commitHistory` calls `createSnapshot(graph)` and then `stringifySnapshot(snapshot)` to get `serialized`, which is used ONLY for the `=== lastHistoryJson` comparison and the `byteSize` calculation. But `JSON.stringify` is called twice for each history commit — once here, and the snapshot object is stored as-is. The snapshot will be re-serialized on `undoHistory/redoHistory` too. On complex graphs (50 equations, large data), this JSON.stringify costs 10-50ms per commit.
Fix: Store the serialized string alongside the snapshot to avoid re-serializing:

```ts
interface HistoryEntry {
	snapshot: GraphSnapshot;
	serialized: string;
	bytes: number;
}
let history: HistoryEntry[] = [];
function commitHistory(kind = 'state', target = 'global', replaceCurrent = false): void {
	clearPendingHistory();
	const snapshot = createSnapshot(graph);
	const serialized = stringifySnapshot(snapshot);
	if (serialized === lastHistoryJson) return;
	const bytes = serialized.length * 2;
	const entry: HistoryEntry = { snapshot, serialized, bytes };
	// ... push entry, trim, etc.
}
// Then in undoHistory/redoHistory:
await restoreSnapshot(history[graph.historyIndex]!.snapshot);
lastHistoryJson = history[graph.historyIndex]!.serialized;
```

### P24 — `validateDataSeries` in `graph.svelte.ts` Runs O(total-cells) Loop Synchronously During Import

File: `lib/state/graph.svelte.ts`, lines ~815-865 (`validateDataSeries`)
Problem: `validateDataSeries` has a `totalCells` guard (`MAX_IMPORT_CELLS = MAX_DATA_SERIES × MAX_DATA_COLUMNS × MAX_DATA_ROWS = 12 × 8 × 1200 = 115,200`), but the loop `value.rows.slice(0, MAX_DATA_ROWS).map(row => Array.from({length: columns.length}, ...))` creates a brand new array for every row, every column. This is 115,200 allocations in the worst case, all synchronously on the main thread during import, freezing the UI.
Fix: Use pre-allocated typed storage and avoid `Array.from` inside the hot loop:

```ts
function validateDataSeries(input: unknown): DataSeries[] {
	// ... same validation setup ...
	const rows: string[][] = [];
	for (let r = 0; r < Math.min(rawRows.length, MAX_DATA_ROWS); r++) {
		const row: string[] = [];
		for (let c = 0; c < columns.length; c++) {
			totalCells++;
			if (totalCells > MAX_IMPORT_CELLS) {
				row.push('');
				continue;
			}
			const cell = Array.isArray(rawRows[r]) ? rawRows[r][c] : '';
			if (typeof cell !== 'string') {
				row.push('');
				continue;
			}
			const n = Number(cell);
			row.push(isFinite(n) ? `${n}`.slice(0, MAX_CELL_CHARS) : '');
		}
		rows.push(row);
	}
	// pad to 20 rows
	while (rows.length < 20) rows.push(new Array(columns.length).fill(''));
	return rows;
}
```

### P25 — `KaTeX Worker` Has No Concurrency Limit — Can Queue Hundreds of Renders

File: `lib/utils/katexRenderer.ts`, lines ~50-90
Problem: `renderKatex` posts a message to the KaTeX Worker for every unique (cacheKey, latex) pair with no backpressure. If a user opens the app with 30 equations and triggers simultaneous analysis panel renders, 30+ messages queue in the Worker. The Worker processes them serially, and stale results arrive after the user has already moved on. There's no cancellation mechanism.
Fix: Add a generation counter to cancel stale renders:

```ts
let renderGeneration = 0;
export function renderKatex(
	cacheKey: string,
	latex: string,
	displayMode: boolean,
	fallback: string
): Promise<string> {
	const cached = getCachedKatex(cacheKey);
	if (cached) return Promise.resolve(cached);
	const myGeneration = ++renderGeneration;
	const nextWorker = ensureWorker();
	if (!nextWorker) {
		setCachedKatex(cacheKey, fallback);
		return Promise.resolve(fallback);
	}
	// Check for existing pending
	const existing = pending.get(cacheKey);
	if (existing) return new Promise((resolve, reject) => existing.push({ resolve, reject }));
	const listeners: PendingRequest[] = [];
	pending.set(cacheKey, listeners);
	nextWorker.postMessage({ type: 'render', id: nanoid(), cacheKey, latex, displayMode });
	return new Promise<string>((resolve, reject) => {
		listeners.push({
			resolve: (html) => {
				// Cancel if a newer generation superseded this
				if (renderGeneration > myGeneration + 50) {
					resolve(fallback);
					return;
				}
				resolve(html);
			},
			reject
		});
	}).catch(() => fallback);
}
```

### P26 — `drawBackgroundImages` Creates New `HTMLImageElement` Objects Every Render If `backgroundImageCache` Miss

File: `lib/renderer/canvas.ts`, lines ~490-525 (`drawBackgroundImages`)
Problem: The check `!element.complete || !element.naturalWidth` means that during the brief window between `new Image()` creation and `onload` firing, every paint call re-enters the `!element` branch due to the `backgroundImageCache.get(image.id)` miss — wait, it's stored in the cache. But `element.onload = () => this.requestRender()` is set on the element stored in cache. If `resize()` is called (which calls `this.render(true)` immediately), it renders before the image loads, which is fine — BUT `resize()` also calls `.clear()` on the scatter/polar/shading caches but NOT `backgroundImageCache`. This means after resize, stale cache entries with wrong dimensions persist.
Fix:

```ts
resize(width: number, height: number): void {
  // ... existing code ...
  this.backgroundImageCache.clear(); // ADD THIS
  this.scatterCache.clear();
  // ... rest ...
}
```

### P27 — `regression.worker.ts` `fitNonlinearLeastSquares` Runs 120 Iterations Synchronously Without Yield

File: `lib/analysis/regression.ts`, lines ~365-420 (`fitNonlinearLeastSquares`)
Problem: The Levenberg-Marquardt loop runs up to 120 iterations, each with a full Jacobian computation (O(n × params) evaluations) and Gaussian elimination. For 1500 data points with 4 parameters, each iteration is ~6000 function evaluations. 120 × 6000 = 720,000 evaluations blocking the Worker thread. This freezes the Worker for 200-500ms, during which NO other worker messages (critical points, intersections) can be processed.
Fix: Move regression fitting to its own dedicated Worker (it already is), but add convergence early-exit and reduce default max iterations for real-time UX:

```ts
const MAX_ITERATIONS = 60; // was 120 — LM converges in <<60 iterations for well-conditioned problems
// Add absolute convergence check:
if (Math.hypot(...delta) < 1e-9 && trial.value < 1e-12) {
	return { params, predicted: trial.predicted };
}
```

### P28 — `WorkspaceSyncState.schedulePersist` Posts to localStorage on Every History Change

File: `lib/firebase/workspace-sync.svelte.ts`, lines ~195-235 (`schedulePersist`)
Problem: The effect in `WorkspaceShell.svelte` calls `sync.schedulePersist()` on every `graph.historyIndex` or `graph.historySize` change. History changes happen after every equation edit. `schedulePersist` with `currentUserUid = null` (guest mode) writes `JSON.stringify` of the full graph to `localStorage` with a 1200ms debounce — but `graph.exportJSON(false)` is called synchronously inside the timeout, which calls `createSnapshot` + `JSON.stringify` on the full graph. On a complex graph this is 50-100ms of synchronous work in a setTimeout.
Fix: Move the `exportJSON` call to the start of `schedulePersist` and cache the result:

```ts
function schedulePersist(delay = 900): void {
	if (!browser || !state.bootstrapped || suppressNextPersist) {
		suppressNextPersist = false;
		return;
	}
	if (handlingRemote) return;
	// Capture snapshot NOW (while state is current) — not inside the timeout
	const snapshotJson = currentUserUid ? null : graph.exportJSON(false);
	clearPendingTimer();
	state.pendingWrite = true;
	if (!currentUserUid) {
		pendingTimer = setTimeout(() => {
			try {
				if (snapshotJson && snapshotJson.length <= LOCAL_SESSION_LIMIT) {
					localStorage.setItem(LOCAL_SESSION_KEY, snapshotJson);
				}
				state.status = 'local';
				state.error = null;
			} catch (e) {
				state.status = 'error';
				state.error = normalizeSyncError(e);
			} finally {
				state.pendingWrite = false;
				pendingTimer = null;
			}
		}, 1200);
		return;
	}
	// ... cloud sync path
}
```

### P29 — `LruMap.evict` Calls `this.keys().next()` Which Creates an Iterator Object Every Time

File: `lib/utils/lru.ts`, lines ~24-32 (`evict`)
Problem: `evict()` is called after every `set()`, and uses `this.keys().next().value` to find the oldest key. `Map.prototype.keys()` creates a new iterator object on every call. With 1000+ cache sets per second (geometry cache, KaTeX cache), this creates thousands of iterator objects per second for GC.
Fix: Track the oldest key explicitly:

```ts
export class LruMap<K, V> extends Map<K, V> {
	constructor(private readonly maxEntries: number) {
		super();
	}
	override get(key: K): V | undefined {
		const value = super.get(key);
		if (value !== undefined) {
			super.delete(key);
			super.set(key, value);
		}
		return value;
	}
	override set(key: K, value: V): this {
		if (super.has(key)) super.delete(key);
		super.set(key, value);
		// Evict oldest without creating iterator
		if (this.size > this.maxEntries) {
			super.delete(super.keys().next().value);
		}
		return this;
	}
}
// Remove the private evict() method entirely
```

### P30 — `toSafeScope` in `engine.ts` Allocates a New `Map` on Every Expression Evaluation

File: `lib/math/engine.ts`, lines ~195-210 (`toSafeScope`)
Problem: `toSafeScope` creates a `new Map<string, number>()` on every single call to `safeEvaluateCompiled`. This function is called for every sample point in every curve (thousands of times per frame during rendering). Each `Map` allocation triggers GC pressure. With 50 equations × 600 samples = 30,000 Map allocations per render frame.
Fix: Reuse a module-level Map and clear it:

```ts
const _scopeMap = new Map<string, number>();
function toSafeScope(scope: Record<string, number>): Map<string, number> {
	_scopeMap.clear();
	for (const key of Object.keys(scope)) {
		if (SAFE_SCOPE_KEY.test(key) && !BLOCKED_SCOPE_KEYS.has(key) && isFinite(scope[key]!)) {
			_scopeMap.set(key, scope[key]!);
		}
	}
	return _scopeMap;
}
```

Note: This is safe because `safeEvaluateCompiled` consumes the map synchronously before returning.

### P31 — `analyzeCriticalPoints` Allocates Four `Float64Array`s of 800+ Elements

File: `lib/analysis/criticalPoints.ts`, lines ~70-85 (`analyzeCriticalPoints`)
Problem: Four `new Float64Array(sampleCount)` allocations where `sampleCount = Math.max(800, Math.round(canvasWidth * 2))`. For a 1440px canvas, that's 2880 elements × 4 arrays = ~90KB allocated per analysis run. Analysis runs in a Worker, so GC pauses affect the Worker thread's responsiveness.
Fix: Pre-allocate once at module level with a generous max size:

```ts
const MAX_CRITICAL_SAMPLES = 3000;
const _xs = new Float64Array(MAX_CRITICAL_SAMPLES);
const _ys = new Float64Array(MAX_CRITICAL_SAMPLES);
const _d1 = new Float64Array(MAX_CRITICAL_SAMPLES);
const _d2 = new Float64Array(MAX_CRITICAL_SAMPLES);
// In analyzeCriticalPoints, replace new Float64Array(sampleCount) with:
const xs = _xs.subarray(0, sampleCount);
const ys = _ys.subarray(0, sampleCount);
const d1 = _d1.subarray(0, sampleCount);
const d2 = _d2.subarray(0, sampleCount);
```

---

## SECURITY VULNERABILITIES

### S1 — KaTeX HTML Injected Directly via `{@html}` Without Sanitization

Files: `lib/components/AnalysisPanel.svelte` line ~180, `lib/components/EquationCard.svelte` line ~190, `lib/components/RegressionPanel.svelte` line ~210
Problem: `{@html equationHtml}` renders raw KaTeX output directly into the DOM. KaTeX itself is generally safe, but the `equationHtml` variable can also be set to `equation.raw` (the fallback when KaTeX hasn't rendered yet). `equation.raw` is user-supplied and goes through `isSafeExpressionInput()`, but that regex only checks for a character whitelist — it does not prevent `</script>` sequences or HTML that could break out of the rendering context if the KaTeX worker fails and raw is used.
Fix:

```ts
import DOMPurify from 'dompurify';
// Wherever equationHtml is set from equation.raw or any non-KaTeX source:
equationHtml = DOMPurify.sanitize(fallbackValue, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
// KaTeX output itself can be trusted but sanitize for defense in depth:
equationHtml = DOMPurify.sanitize(katexOutput, {
	ALLOWED_TAGS: [
		'span',
		'svg',
		'path',
		'line',
		'rect',
		'circle',
		'use',
		'defs',
		'g',
		'annotation',
		'semantics',
		'math',
		'mrow',
		'mn',
		'mi',
		'mo',
		'msup',
		'mfrac'
	],
	ALLOWED_ATTR: [
		'class',
		'style',
		'd',
		'viewBox',
		'xmlns',
		'aria-hidden',
		'focusable',
		'width',
		'height',
		'x',
		'y',
		'x1',
		'y1',
		'x2',
		'y2',
		'href'
	]
});
```

### S2 — `SAFE_REGRESSION_PARAM` Regex Allows Single-Letter Variable Names But `createSafeScope` Uses `Object.create(null)` Bypassed by Prototype Chain on Older Runtimes

File: `lib/analysis/regression.ts`, lines ~305-325 (`createSafeScope`)
Problem: `createSafeScope` creates `Object.create(null)` which is correct, but `fitNonlinearLeastSquares` spreads params with `{ ...params, [name]: value }` — regular object spread, NOT `Object.create(null)`. This means the `names` array iterated from user's custom expression could contain `__proto__` (blocked by `BLOCKED_PARAM_NAMES`) but the regex `SAFE_REGRESSION_PARAM = /^[a-wyz]$/` already prevents this. However `evaluateCompiledWithScope` receives the spread object which goes through `toSafeScope` — but `toSafeScope` is called with the regular object and its keys could include inherited properties in pathological environments. Low risk but worth hardening.
Fix:

```ts
function fitNonlinearLeastSquares(...): ... {
  // Replace: const next = { ...params, [name]: value }
  // With:
  const next = Object.create(null) as Record<string, number>;
  for (const k of names) next[k] = params[k] ?? 0;
  next[names[index]!] = (next[names[index]!] ?? 0) + (delta[index] ?? 0);
}
```

### S3 — `window.prompt` Used in Calibration Flow — Blocks Main Thread and Is Suppressible by Browsers

File: `lib/input/interactions.ts`, lines ~395-415 (`handleCalibrationSelection`)
Problem: `window.prompt()` is a synchronous blocking call. Modern browsers in cross-origin iframes or certain contexts silently suppress `prompt()`, returning `null` as if the user cancelled — making calibration silently fail. It also blocks the main thread completely during display.
Fix: Replace with an async modal using the existing `Modal` component and `ui.openModal` pattern, passing calibration data through the UI state.

### S4 — `base64UrlDecode` Size Check Uses `Math.floor` Approximation That Can Underestimate Actual Decoded Size

File: `lib/state/graph.svelte.ts`, lines ~225-235 (`base64UrlDecode`)
Problem: The check `Math.floor((padded.length * 3) / 4) > MAX_URL_SNAPSHOT_BYTES` estimates decoded size. Base64 padding means actual decoded size can be up to 2 bytes smaller, but the formula never overestimates — so large payloads could pass the check. More critically, the decoded string is then passed to `JSON.parse` which creates the full object tree before `deserializeSnapshot` validates it. A crafted 127KB payload could create hundreds of thousands of nested objects before any validation.
Fix: Add a hard byte limit check AFTER decoding but BEFORE parsing:

```ts
function base64UrlDecode(value: string): string {
	// ... existing ...
	const decoded = new TextDecoder().decode(bytes);
	if (decoded.length > MAX_URL_SNAPSHOT_BYTES) {
		throw new Error('Shared Plotrix URL is too large to decode safely.');
	}
	return decoded;
}
```

### S5 — Firebase Firestore Rules Not Verified Client-Side — `loadPublicWorkspaceRecord` Trusts `isPublic` Flag From Query

File: `lib/firebase/projects.ts`, lines ~480-510 (`loadPublicWorkspaceRecord`)
Problem: `loadPublicWorkspaceRecord` queries with `where('isPublic', '==', true)` but then calls `buildWorkspaceSnapshot` on whatever data comes back. If Firestore security rules are misconfigured (a common deploy mistake), non-public workspaces could be returned. The embed page at `routes/embed/[id]/+page.svelte` checks `!record.isPublic` but this value comes from the returned document, not from independent verification.
Fix: Double-check the `isPublic` field defensively:

```ts
if (!publicMeta || publicMeta.data()?.isPublic !== true) {
	return {
		exists: false,
		flatHash: '',
		hashes: null,
		isPublic: false,
		name: DEFAULT_WORKSPACE_NAME,
		snapshot: null
	};
}
```

---

## UX/UI CRITICAL ISSUES

### U1 — Analysis Drawer Has No Loading State Transition — Content Jumps

File: `lib/components/AnalysisPanel.svelte`, lines ~165-175
Problem: When switching between equations in the analysis panel, `loading` is set to `true` and the skeleton appears, but the old `report` data is cleared simultaneously. This causes a jarring flash: content disappears → skeleton → new content. Users lose context about what changed.
Fix: Keep previous `report` visible while loading and overlay a subtle spinner instead of replacing with skeleton:

```svelte
{#if loading && !report}
	<!-- full skeleton only on first load -->
{:else if report}
	<!-- show report, with optional loading overlay -->
	{#if loading}
		<div class="analysis-updating" aria-label="Updating analysis..."></div>
	{/if}
	<!-- report content -->
{/if}
```

### U2 — Mobile Sidebar Swipe-to-Open Zone is Only 28px Wide, Nearly Impossible to Hit

File: `lib/input/interactions.ts`, lines ~178-182
Problem: `point.x <= 28` defines the swipe zone for opening the sidebar. On a 390px wide phone with typical thumb ergonomics, 28px is a ~1cm target — far below the WCAG 2.5.5 minimum of 44px for touch targets.
Fix: Expand to 52px:

```ts
if (event.pointerType === 'touch' && window.innerWidth < 960 && !this.ui.sidebarOpen && point.x <= 52) {
```

### U3 — Equation Card `delete-revealed` Swipe State Never Resets When Switching Equations

File: `lib/components/EquationCard.svelte`, lines ~180-200 (`finishSummarySwipe`)
Problem: `deleteRevealed` is local component state. When a user swipes to reveal the delete button on equation A, then taps equation B to activate it, equation A's delete button remains revealed. There's no global state that resets it.
Fix: Add an effect that resets `deleteRevealed` when the equation loses active/selected status:

```ts
$effect(() => {
	void active;
	void isSelected;
	if (!active && !isSelected) deleteRevealed = false;
});
```

### U4 — Range Inputs Update on Every Pan Frame, Causing Input Flicker During Scroll

File: `lib/components/GraphCanvas.svelte`, lines ~150-170
Problem: The `$effect` that updates `rangeInputs` fires on every frame during panning because `graph.view.originX/Y` update on every `panBy`. If a user has focus in a range input and simultaneously touches the canvas, the input value flickers as both the user's edit and the pan-driven update fight each other. The `editingBounds` guard helps but only when the input is focused.
Fix: Throttle the range input update to only fire when panning stops:

```ts
$effect(() => {
	void viewSignature;
	if (editingBounds || graph.view.isPanning || graph.view.isAnimating) return;
	const range = visibleRange();
	rangeInputs = {
		/* ... */
	};
});
```

---

## VISUAL HIERARCHY & STYLING

### V1 — Analysis Drawer Accordion Icons Use `class:chevron-rotated` Inverted Logic

File: `lib/components/AnalysisPanel.svelte`, multiple accordion instances
Problem: All accordion buttons use `class={!sections.domain ? 'accordion-icon chevron-rotated' : 'accordion-icon'}` — meaning the chevron rotates (closed state) when the section is CLOSED. But the standard UX convention (and the rest of the app's pattern) is chevron pointing DOWN when open, rotated when closed. The negation (`!sections.domain`) means the chevron points sideways when the section IS open, which is backwards.
Fix: Remove the `!` negation:

```svelte
class={sections.domain ? 'accordion-icon' : 'accordion-icon chevron-rotated'}
```

### V2 — Toast Viewport `bottom: var(--space-6)` Overlaps Range Input Pods on Mobile

File: `lib/styles/app.css`, lines ~2470-2480 (`.toast-viewport`) and ~1390-1405 (`.range-pods`)
Problem: On screens ≤ 820px, range pods are positioned at `bottom: var(--space-3)` (12px) and toasts at `bottom: var(--space-4)` (16px). The toast viewport is 48px+ tall and sits directly over the range pods, making it impossible to read range values when a toast is visible.
Fix: On mobile, position toasts at the TOP:

```css
@media (max-width: 820px) {
	.toast-viewport {
		bottom: auto;
		top: calc(48px + var(--space-3)); /* below topbar */
		right: var(--space-3);
		left: var(--space-3);
		width: auto;
	}
}
```

### V3 — Settings Modal Two-Column Layout Breaks at 1024px But Modal Is 70% Wide (714px)

File: `lib/styles/app.css`, lines ~1760-1775 (`.settings-list`)
Problem: `.settings-list` switches to `grid-template-columns: 1fr` at `max-width: 1024px`. But the modal is `min(70%, 860px)` wide. At 1024px viewport width, the modal is 716px wide — plenty of room for two columns. The breakpoint is too aggressive and causes unnecessary single-column layout on large tablets.
Fix: Use container-based logic with a min-width check on the content:

```css
.settings-list {
	grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
	/* Removes the 1024px media query override */
}
```

### V4 — Equation Card `condition-input-wrap` Has No Width Constraint — Long Condition Strings Overflow Card

File: `lib/styles/app.css` (missing styles) and `lib/components/EquationCard.svelte`, lines ~340-360
Problem: The "Show when" condition input has a wrapper div with class `condition-input-wrap` but no corresponding CSS constrains its width. On narrow sidebars (300px), long condition strings like `a > 0 and b < 1` overflow the card bounds.
Fix:

```css
.condition-input-wrap {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	align-items: center;
	gap: var(--space-2);
	min-width: 0;
}
.condition-input-wrap input {
	min-width: 0;
	width: 100%;
	overflow: hidden;
	text-overflow: ellipsis;
}
```

---

## INCONSISTENCIES

### I1 — `graph.svelte.ts` Exports Both `PlotEquation.compiled` (MathNode) and `PlotEquation.compiledExpression` (EvalFunction) — Inconsistent Usage Throughout

File: Multiple files including `lib/renderer/canvas.ts`, `lib/input/interactions.ts`, `lib/analysis/`
Problem: Equations have both `.compiled` (raw MathNode) and `.compiledExpression` (the faster EvalFunction). The renderer uses `equation.compiledExpression ?? equation.compiled` in some places and only `equation.compiled` in others (e.g., `intersections.ts` uses `parsed.node` not `parsed.compiledExpression`). The intersection worker uses `evaluateCartesianAt(parsed.node, ...)` instead of the compiled EvalFunction, which is 3-5× slower.
Fix: Standardize: always use `compiledExpression` for evaluation, `compiled` (MathNode) only for symbolic operations. Update `analysis.worker.ts`:

```ts
equations.push({
	id: equation.id,
	kind: 'cartesian',
	color: equation.color,
	paramRange: equation.paramRange,
	evaluate: (x: number) =>
		evaluateCartesianAt(parsed.compiledExpression ?? parsed.node, x, request.variables)
});
```

### I2 — `formatSig` and `formatCoordinate` Both Used for Number Display But Have Different Precision

File: `lib/utils/format.ts`, used throughout components
Problem: Critical point labels use `formatSig(x)` (3 significant figures), zero pills use `zero.toPrecision(3)`, intersection labels use `.toPrecision(4)`, table values use `formatCoordinate` (3 decimal places). There's no consistent precision standard. Users see `x = 3.14` in one place and `x = 3.142` in another for the same value.
Fix: Define a single canonical display precision constant and use it everywhere:

```ts
export const DISPLAY_PRECISION = 4; // significant figures for displayed values
export function formatDisplay(value: number): string {
	return formatSig(value, DISPLAY_PRECISION);
}
```

### I3 — `WorkspaceShell` Uses Direct Property Assignment (`ui.activeEquationId = x`) While Other Code Uses `setActiveEquationId(id)`

File: `lib/components/WorkspaceShell.svelte`, lines ~125, ~145, ~195
Problem: The method `ui.setActiveEquationId()` exists specifically to encapsulate active equation changes, but `WorkspaceShell` bypasses it with direct property assignment in several places. This means future logic added to `setActiveEquationId` won't be triggered.
Fix: Replace all `ui.activeEquationId = x` with `ui.setActiveEquationId(x)` in `WorkspaceShell.svelte`.

---

## UNNECESSARY ELEMENTS

### N1 — `symbolicPrimitive` in `equationAnalysis.ts` Hardcodes Only 4 Patterns and Always Returns `null` for Everything Else

File: `lib/analysis/equationAnalysis.ts`, lines ~355-380 (`symbolicPrimitive`)
Problem: `symbolicPrimitive` handles exactly `sin(x)`, `cos(x)`, `exp(x)`, and `x` — nothing else. For 99% of real equations it returns `null` and falls through to numerical integration. This function exists for performance but the conditions for it triggering are so narrow that it provides negligible real-world benefit while adding dead code maintenance surface.
Fix: Remove `symbolicPrimitive` entirely and let `integralSummary` fall through to the numerical path, OR expand it meaningfully to handle polynomial terms using symbolic derivative output.

### N2 — `EquationCard` `defaultRawByKind` Object Duplicates `STARTER_EQUATIONS` Data

File: `lib/components/EquationCard.svelte`, lines ~55-65 and `lib/state/graph.svelte.ts` lines ~720-725
Problem: `defaultRawByKind` in `EquationCard` defines default expression strings per kind (e.g., `parametric: 'x(t)=cos(t); y(t)=sin(t)'`). `STARTER_EQUATIONS` in `graph.svelte.ts` also defines `{ raw: 'x(t)=3cos(t); y(t)=2sin(t)', kind: 'parametric' }`. These serve different purposes but the data could drift. Define defaults in one place and import.

### N3 — `compileCache` WeakMap in `engine.ts` Holds References to `MathNode` Objects That Are Never Garbage Collected

File: `lib/math/engine.ts`, lines ~155-165 (`compileCache`)
Problem: `compileCache` is a `WeakMap<MathNode, EvalFunction>`. MathNode objects are stored on `PlotEquation.compiled`. When an equation is removed, its MathNode should be GC'd, releasing the WeakMap entry. But `equation.compiled` is also stored in history snapshots (via `createSnapshot`... wait, no — `createSnapshot` only stores serializable fields, not `compiled`). Actually equations in history are raw text only. This is fine. But it means `compileCache` entries are never evicted during a session since MathNodes on active equations persist.
Fix: Replace with `nativeCompileCache` (the LRU by string key) as the sole cache, and remove `compileCache` WeakMap entirely since `compileNode` can use the string-keyed LRU via the node's `toString()`.

### N4 — `shade-between` Button in Sidebar Footer is Always Visible But Disabled 99% of the Time

File: `lib/components/WorkspaceShell.svelte`, lines ~850-860
Problem: The "Shade between" button shows for all users at all times. It requires exactly 2 cartesian equations selected via Shift+click — a power-user workflow most users never discover. The disabled state with a tooltip explaining it is easy to overlook. It clutters the sidebar footer.
Fix: Only render the button when 2 equations are selected:

```svelte
{#if ui.selectedEquationIds.size === 2}
	<button
		type="button"
		class="compact-action compact-action-neutral shade-between"
		onclick={shadeBetweenSelected}
		disabled={graph.equations
			.filter((eq) => ui.selectedEquationIds.has(eq.id))
			.some((eq) => eq.kind !== 'cartesian')}>Shade between</button
	>
{/if}
```

---

## LOW PRIORITY

### L1 — `formatSig` Uses `toPrecision` Which Produces Scientific Notation for Large Numbers

File: `lib/utils/format.ts`, `formatSig` function
Problem: `formatSig(1000000, 3)` returns `"1.00e+6"` which looks jarring in UI labels. `formatCoordinate` handles this with a conditional but `formatSig` doesn't.

### L2 — `STARTER_EQUATIONS` Are Added Every Time a Guest Workspace Has No Equations — Including After Deliberate Clearing

File: `lib/firebase/workspace-sync.svelte.ts`, line ~175 (`if (!graph.equations.length) graph.seedStarterEquations()`)
Problem: If a user deliberately deletes all equations and saves, next session they get the starter equations back. The intent check should be "has this workspace EVER had equations" not "does it currently have equations".

### L3 — `VariableSliderPanel` Animation Uses `performance.now()` Correctly But `elapsed` Is Clamped to 33ms, Meaning 30 fps Cap

File: `lib/components/VariableSliderPanel.svelte`, lines ~40-55 (`step` function)
Problem: `const elapsed = Math.min(now - previous, 33) / 1000` caps elapsed time at 33ms (30fps equivalent). On a 144Hz monitor, actual elapsed is ~7ms, so the cap is never hit. But on a 30fps display, the cap prevents spiral/catchup issues correctly. However, `60 * elapsed` at 33ms = 1.98 ≈ the step per frame. The animation feels slow on high-refresh displays because `variable.step * 60 * (7/1000)` = `step * 0.42` per frame instead of `step * 1.0` per frame. The formula should normalize to wall-clock time, not frame count.
Fix: Remove the `* 60` multiplier and instead define `step` as "units per second":

```ts
const delta = variable.step * elapsed; // step is now "per second", not "per frame"
```

### L4 — `Modal.svelte` and `Select.svelte` and `ColorPicker.svelte` All Implement the Same "Close on Outside Click" Pattern Separately

File: Three files, ~50 lines each
Problem: Three separate module-level `Set` + pointer listener patterns for the same functionality. Should be a shared utility:

```ts
// lib/utils/outsideClick.ts
export function createOutsideClickRegistry() {
	const registry = new Set<{
		root: () => HTMLElement | null;
		close: () => void;
		isOpen: () => boolean;
	}>();
	// ... shared listener logic
	return registry;
}
```

### L5 — `app.css` Contains 2600+ Lines in a Single File With No Logical Chunking Beyond Comments

File: `lib/styles/app.css`
Problem: The CSS file is one monolith. CSS layers are used (`.components`) but all component styles are mixed together. This makes it hard to find styles, impossible to code-split, and every page load parses the entire file even if only a fraction of components are used.
Fix: Split into per-component CSS modules (`EquationCard.css`, `AnalysisPanel.css`, etc.) imported in each Svelte component's `<style>` block.

### L6 — `graph.svelte.ts` `MAX_HISTORY_BYTES = 10MB` But Histories Are Never Compressed

File: `lib/state/graph.svelte.ts`, line ~700
Problem: At 10MB limit with 20 entries, average snapshot size is 500KB. For a graph with 30 equations and 5 data sheets, a snapshot can easily be 200-400KB of JSON. History is kept in RAM uncompressed. Using `CompressionStream` (available in all modern browsers) could reduce this to 15-30KB per snapshot, allowing 5× more history entries or cutting RAM usage by 90%.
