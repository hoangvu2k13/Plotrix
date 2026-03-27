<script lang="ts">
	import ColorPicker from '$components/ColorPicker.svelte';
	import Slider from '$components/Slider.svelte';
	import type { DataSeries, GraphState } from '$stores/graph.svelte';
	import type { UiState } from '$stores/ui.svelte';

	let { graph, ui } = $props<{ graph: GraphState; ui: UiState }>();

	let activeSheetId = $state<string | null>(null);
	let importInput: HTMLInputElement | null = null;
	const MAX_CSV_ROWS = 2000;
	const MAX_CSV_COLUMNS = 8;

	const activeSheet = $derived(
		graph.dataSeries.find(
			(series: GraphState['dataSeries'][number]) => series.id === activeSheetId
		) ??
			graph.dataSeries[0] ??
			null
	);

	function ensureActive(): void {
		if (!activeSheetId && graph.dataSeries[0]) {
			activeSheetId = graph.dataSeries[0].id;
		}
	}

	$effect(() => {
		graph.dataSeries.length;
		ensureActive();
	});

	function updateCell(
		series: DataSeries,
		rowIndex: number,
		columnIndex: number,
		value: string
	): void {
		const rows = series.rows.map((row) => [...row]);
		while (rows.length <= rowIndex) {
			rows.push(Array.from({ length: series.columns.length }, () => ''));
		}
		while ((rows[rowIndex]?.length ?? 0) < series.columns.length) {
			rows[rowIndex]!.push('');
		}
		rows[rowIndex]![columnIndex] = sanitizeCell(value);
		const last = rows[rows.length - 1] ?? [];
		if (last.some((cell) => cell.trim().length > 0)) {
			rows.push(Array.from({ length: series.columns.length }, () => ''));
		}
		graph.updateDataSeries(series.id, { rows });
	}

	function renameColumn(series: DataSeries, columnIndex: number, name: string): void {
		const columns = series.columns.map((column) => ({ ...column }));
		columns[columnIndex]!.name = sanitizeHeader(name);
		graph.updateDataSeries(series.id, { columns });
	}

	function addColumn(series: DataSeries): void {
		const columns = [
			...series.columns,
			{
				id: crypto.randomUUID?.() ?? String(Date.now()),
				name: `Col ${series.columns.length + 1}`,
				width: 120
			}
		];
		const rows = series.rows.map((row) => [...row, '']);
		graph.updateDataSeries(series.id, { columns, rows });
	}

	function parseCsv(text: string): string[][] {
		const rows: string[][] = [];
		let current = '';
		let row: string[] = [];
		let quoted = false;

		for (let index = 0; index < text.length; index += 1) {
			const char = text[index]!;
			const next = text[index + 1];

			if (char === '"' && quoted && next === '"') {
				current += '"';
				index += 1;
				continue;
			}

			if (char === '"') {
				quoted = !quoted;
				continue;
			}

			if (char === ',' && !quoted) {
				if (row.length < MAX_CSV_COLUMNS) {
					row.push(current);
				}
				current = '';
				continue;
			}

			if ((char === '\n' || char === '\r') && !quoted) {
				if (char === '\r' && next === '\n') index += 1;
				if (row.length < MAX_CSV_COLUMNS) {
					row.push(current);
				}
				rows.push(row.slice(0, MAX_CSV_COLUMNS));
				if (rows.length >= MAX_CSV_ROWS) {
					break;
				}
				row = [];
				current = '';
				continue;
			}

			current += char;
		}

		if ((current.length || row.length) && rows.length < MAX_CSV_ROWS) {
			if (row.length < MAX_CSV_COLUMNS) {
				row.push(current);
			}
			rows.push(row.slice(0, MAX_CSV_COLUMNS));
		}

		return rows;
	}

	function sanitizeHeader(value: string): string {
		const cleaned = value
			.replace(/[^a-zA-Z0-9 ]+/g, '')
			.trim()
			.slice(0, 32);
		return cleaned || 'Column';
	}

	function sanitizeCell(value: string): string {
		const trimmed = value.trim();
		if (!trimmed) return '';
		const numeric = Number(trimmed);
		return Number.isFinite(numeric) ? `${numeric}` : '';
	}

	async function importCsv(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !activeSheet) return;
		const rows = parseCsv(await file.text());
		const first = rows[0] ?? [];
		const headerLike = first.some((cell) => Number.isNaN(Number(cell)));
		const columns = (
			headerLike
				? first
				: first.map((_, index) => (index === 0 ? 'X' : index === 1 ? 'Y' : `Col ${index + 1}`))
		).map((name) => ({
			id: crypto.randomUUID?.() ?? String(Math.random()),
			name: sanitizeHeader(name),
			width: 120
		}));
		const values = (headerLike ? rows.slice(1) : rows).map((row) => {
			const next = Array.from({ length: columns.length }, (_, index) =>
				sanitizeCell(row[index] ?? '')
			);
			return next;
		});
		while (values.length < 20) values.push(Array.from({ length: columns.length }, () => ''));
		graph.updateDataSeries(activeSheet.id, { columns, rows: values });
		input.value = '';
	}

	function extractDataset(series: DataSeries) {
		return series.rows
			.map((row) => ({ x: Number(row[0]), y: Number(row[1]) }))
			.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
	}
</script>

<input bind:this={importInput} type="file" accept=".csv" class="sr-only" onchange={importCsv} />

<section class="panel">
	{#if activeSheet}
		<div
			class="grid-wrap"
			onpaste={(event) => {
				const data = event.clipboardData?.getData('text/plain');
				if (!data || !activeSheet) return;
				event.preventDefault();
				const rows = data
					.split(/\r?\n/)
					.filter(Boolean)
					.map((row: string) => row.split('\t'));
				const merged = activeSheet.rows.map((row: string[]) => [...row]);
				rows.forEach((row: string[], rowIndex: number) => {
					while (merged.length <= rowIndex)
						merged.push(Array.from({ length: activeSheet.columns.length }, () => ''));
					row.forEach((cell, colIndex) => {
						if (colIndex < activeSheet.columns.length)
							merged[rowIndex]![colIndex] = sanitizeCell(cell);
					});
				});
				graph.updateDataSeries(activeSheet.id, { rows: merged });
			}}
		>
			<table class="sheet">
				<thead>
					<tr>
						<th class="row-number"></th>
						{#each activeSheet.columns as column, columnIndex (column.id)}
							<th class="data-col-header" style={`width:${column.width}px`}>
								<div
									contenteditable="true"
									role="textbox"
									aria-label={`Column ${columnIndex + 1} name`}
									onblur={(event) =>
										renameColumn(
											activeSheet,
											columnIndex,
											(event.currentTarget as HTMLDivElement).textContent ?? column.name
										)}
								>
									{column.name}
								</div>
							</th>
						{/each}
						<th class="data-col-header add-col">
							<button
								type="button"
								class="tiny"
								onclick={() => addColumn(activeSheet)}
								aria-label="Add column"
							>
								<svg viewBox="0 0 20 20" aria-hidden="true">
									<path
										d="M10 4.5v11M4.5 10h11"
										fill="none"
										stroke="currentColor"
										stroke-linecap="round"
										stroke-width="1.5"
									/>
								</svg>
							</button>
						</th>
					</tr>
				</thead>
				<tbody>
					{#each activeSheet.rows as row, rowIndex (`${activeSheet.id}:${rowIndex}`)}
						<tr class:odd={rowIndex % 2 === 1}>
							<td class="row-number data-row-num">{rowIndex + 1}</td>
							{#each activeSheet.columns as column, columnIndex (column.id)}
								<td class="data-cell">
									<div
										contenteditable="true"
										role="textbox"
										tabindex="0"
										aria-label={`Row ${rowIndex + 1} column ${column.name}`}
										onkeydown={(event) => {
											if (event.key === 'Enter') {
												event.preventDefault();
												(event.currentTarget as HTMLDivElement).blur();
											}
										}}
										onblur={(event) =>
											updateCell(
												activeSheet,
												rowIndex,
												columnIndex,
												(event.currentTarget as HTMLDivElement).textContent ?? ''
											)}
									>
										{row[columnIndex] ?? ''}
									</div>
								</td>
							{/each}
							<td></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="series-options">
			<div class="symbols" role="group" aria-label="Scatter symbol">
				{#each ['circle', 'square', 'triangle', 'cross', 'diamond'] as symbol}
					<button
						type="button"
						class:selected={activeSheet.style.symbol === symbol}
						onclick={() =>
							graph.updateDataSeries(activeSheet.id, {
								style: { ...activeSheet.style, symbol: symbol as DataSeries['style']['symbol'] }
							})}
					>
						{symbol.slice(0, 1).toUpperCase()}
					</button>
				{/each}
			</div>

			<label>
				<span>Size</span>
				<Slider
					min={4}
					max={12}
					value={activeSheet.style.size}
					ariaLabel="Scatter point size"
					onChange={(value) =>
						graph.updateDataSeries(activeSheet.id, {
							style: { ...activeSheet.style, size: value }
						})}
				/>
			</label>

			<label>
				<span>Color</span>
				<ColorPicker
					value={activeSheet.style.color}
					label="Series color"
					onChange={(value) =>
						graph.updateDataSeries(activeSheet.id, {
							style: { ...activeSheet.style, color: value }
						})}
				/>
			</label>

			<label class="toggle">
				<input
					type="checkbox"
					checked={activeSheet.style.showLine}
					onchange={(event) =>
						graph.updateDataSeries(activeSheet.id, {
							style: {
								...activeSheet.style,
								showLine: (event.currentTarget as HTMLInputElement).checked
							}
						})}
				/>
				<span>Connect with line</span>
			</label>

			<div class="actions">
				<button
					type="button"
					class="primary"
					onclick={() => graph.updateDataSeries(activeSheet.id, { plotted: true })}
				>
					<svg viewBox="0 0 20 20" aria-hidden="true"
						><path
							d="M5 13.5c.8 0 1.5-.7 1.5-1.5S5.8 10.5 5 10.5 3.5 11.2 3.5 12 4.2 13.5 5 13.5Zm5-4c.8 0 1.5-.7 1.5-1.5S10.8 6.5 10 6.5 8.5 7.2 8.5 8 9.2 9.5 10 9.5Zm5 6c.8 0 1.5-.7 1.5-1.5s-.7-1.5-1.5-1.5-1.5.7-1.5 1.5.7 1.5 1.5 1.5Z"
							fill="currentColor"
						/></svg
					>
					<span>Plot</span>
				</button>
				<button
					type="button"
					class="secondary"
					onclick={() => graph.updateDataSeries(activeSheet.id, { plotted: false })}
				>
					<svg viewBox="0 0 20 20" aria-hidden="true"
						><path
							d="M5.5 6.5h9m-7.5 0V15m3-8.5V15m3-11.25H7.75l-.5 1.5H5.5v1.25h9V5.25h-1.75l-.5-1.5Z"
							fill="none"
							stroke="currentColor"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
						/></svg
					>
					<span>Clear</span>
				</button>
				<button
					type="button"
					class="secondary"
					onclick={() => {
						ui.setActiveRegressionSeriesId(activeSheet.id);
						ui.openModal('regression');
					}}
					disabled={extractDataset(activeSheet).length < 2}
				>
					<svg viewBox="0 0 20 20" aria-hidden="true"
						><path
							d="M3.5 14.5c3-6 5.5-7.5 13-9M4 12.75l2.5-2.5M9 9.5l2.5-2.25M14 7l2-1.5"
							fill="none"
							stroke="currentColor"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
						/></svg
					>
					<span>Fit curve</span>
				</button>
				<button type="button" class="secondary" onclick={() => importInput?.click()}>
					<svg viewBox="0 0 20 20" aria-hidden="true"
						><path
							d="M10 3.5v8m0 0 2.75-2.75M10 11.5 7.25 8.75M4 13.75v1.75h12v-1.75"
							fill="none"
							stroke="currentColor"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
						/></svg
					>
					<span>Import CSV</span>
				</button>
			</div>
		</div>

		<div class="sheet-tabs">
			{#each graph.dataSeries as series (series.id)}
				<button
					type="button"
					class:active={series.id === activeSheetId}
					onclick={() => (activeSheetId = series.id)}
				>
					{series.name}
				</button>
			{/each}
			<button
				type="button"
				class="add"
				onclick={() => (activeSheetId = graph.addDataSeries().id)}
				aria-label="Add sheet"
			>
				<svg viewBox="0 0 20 20" aria-hidden="true">
					<path
						d="M10 4.5v11M4.5 10h11"
						fill="none"
						stroke="currentColor"
						stroke-linecap="round"
						stroke-width="1.5"
					/>
				</svg>
			</button>
		</div>
	{/if}
</section>

<style>
	.panel {
		display: grid;
		gap: var(--space-3);
		min-height: 0;
	}

	.grid-wrap {
		min-height: 0;
		overflow: auto;
		flex: 1;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg-surface);
	}

	.sheet {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}

	tbody * {
		transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
	}

	thead th {
		position: sticky;
		top: 0;
		z-index: 3;
	}

	th div,
	td div {
		min-height: 28px;
		padding: var(--space-2);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		outline: none;
	}

	td div:focus {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
	}

	.row-number {
		width: 30px;
		text-align: center;
		color: var(--color-text-muted);
	}

	.data-col-header {
		height: 32px;
		padding: 2px;
		border-right: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-overlay);
		font-size: var(--text-xs);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-secondary);
		letter-spacing: 0.05em;
		text-transform: uppercase;
		text-align: center;
		user-select: none;
		position: relative;
	}

	.data-row-num {
		position: sticky;
		left: 0;
		z-index: 2;
		min-width: 32px;
		padding: 0;
		background: var(--color-bg-overlay);
		border-right: 1px solid var(--color-border);
		font-size: 10px;
		user-select: none;
	}

	.data-cell {
		height: 28px;
		padding: 2px;
		border-right: 1px solid rgba(var(--color-border-rgb), 0.4);
		border-bottom: 1px solid rgba(var(--color-border-rgb), 0.4);
	}

	tr.odd td:not(.data-row-num) {
		background: transparent;
	}

	tr:not(.odd) td:not(.data-row-num) {
		background: var(--color-bg-surface);
	}

	.series-options,
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
	}

	.series-options {
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
		background: color-mix(in srgb, var(--color-bg-surface) 96%, transparent);
	}

	.symbols {
		display: inline-flex;
		gap: var(--space-2);
	}

	.symbols button,
	.sheet-tabs button,
	.primary,
	.secondary,
	.tiny {
		height: 32px;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-overlay);
		display: flex;
		align-items: center;
		justify-content: center;
		align-content: center;
		text-align: center;
		cursor: pointer;
	}

	.symbols button.selected,
	.sheet-tabs button.active,
	.primary {
		border-color: color-mix(in srgb, var(--color-accent) 50%, var(--color-border));
		background: var(--color-accent-subtle);
		color: var(--color-accent);
	}

	.symbols button:hover,
	.sheet-tabs button:hover,
	.secondary:hover,
	.tiny:hover {
		border-color: color-mix(in srgb, var(--color-accent) 32%, var(--color-border));
		background: color-mix(in srgb, var(--color-bg-overlay) 76%, var(--color-bg-surface));
		transform: translateY(-1px);
	}

	.primary:hover {
		box-shadow: var(--shadow-sm);
		transform: translateY(-1px);
	}

	.primary,
	.secondary {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.primary svg,
	.secondary svg,
	.add svg,
	.tiny svg {
		width: 14px;
		height: 14px;
	}

	label {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.toggle span {
		font-size: var(--text-sm);
	}

	.sheet-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.add,
	.tiny {
		width: 32px;
		padding: 0;
	}

	.add {
		padding: 4px !important;
	}
</style>
