<script lang="ts">
	import { Download, Plus, ScatterChart, Trash2, TrendingUp, Upload } from '@lucide/svelte';

	import ColorPicker from '$components/ColorPicker.svelte';
	import Icon from '$components/Icon.svelte';
	import Slider from '$components/Slider.svelte';
	import type { DataSeries, GraphState } from '$stores/graph.svelte';
	import type { UiState } from '$stores/ui.svelte';
	import { saveText } from '$utils/download';

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

	function deleteRow(series: DataSeries, rowIndex: number): void {
		const rows = series.rows.filter((_, index) => index !== rowIndex);
		while (rows.length < 20) {
			rows.push(Array.from({ length: series.columns.length }, () => ''));
		}
		graph.updateDataSeries(series.id, { rows });
	}

	function resetSheet(series: DataSeries): void {
		graph.updateDataSeries(series.id, {
			rows: Array.from({ length: 20 }, () =>
				Array.from({ length: series.columns.length }, () => '')
			),
			plotted: false
		});
		ui.pushToast({
			title: 'Sheet reset',
			description: `${series.name} was cleared and reset to a fresh grid.`,
			tone: 'success'
		});
	}

	function parseCsv(text: string): {
		rows: string[][];
		truncatedColumns: boolean;
		truncatedRows: boolean;
	} {
		const rows: string[][] = [];
		let current: string[] = [];
		let row: string[] = [];
		let quoted = false;
		let truncatedColumns = false;
		let truncatedRows = false;

		const flushField = () => {
			const value = current.join('');
			current = [];

			if (row.length < MAX_CSV_COLUMNS) {
				row.push(value);
			} else {
				truncatedColumns = true;
			}
		};

		for (let index = 0; index < text.length; index += 1) {
			const char = text[index]!;
			const next = text[index + 1];

			if (char === '"' && quoted && next === '"') {
				current.push('"');
				index += 1;
				continue;
			}

			if (char === '\\' && quoted && next === '"') {
				current.push('"');
				index += 1;
				continue;
			}

			if (char === '"') {
				quoted = !quoted;
				continue;
			}

			if (char === ',' && !quoted) {
				flushField();
				continue;
			}

			if ((char === '\n' || char === '\r') && !quoted) {
				if (char === '\r' && next === '\n') index += 1;
				flushField();
				rows.push(row.slice(0, MAX_CSV_COLUMNS));
				if (rows.length >= MAX_CSV_ROWS) {
					truncatedRows = true;
					break;
				}
				row = [];
				continue;
			}

			current.push(char);
		}

		if ((current.length || row.length) && rows.length < MAX_CSV_ROWS) {
			flushField();
			rows.push(row.slice(0, MAX_CSV_COLUMNS));
		}

		return { rows, truncatedColumns, truncatedRows };
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
		const parsedCsv = parseCsv(await file.text());
		const rows = parsedCsv.rows;
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
		if (parsedCsv.truncatedColumns || parsedCsv.truncatedRows) {
			ui.pushToast({
				title: 'CSV import trimmed',
				description:
					`${parsedCsv.truncatedRows ? 'Extra rows were ignored. ' : ''}${parsedCsv.truncatedColumns ? 'Columns beyond the first eight were ignored.' : ''}`.trim(),
				tone: 'warning'
			});
		}
		input.value = '';
	}

	function extractDataset(series: DataSeries) {
		return series.rows
			.map((row) => ({ x: Number(row[0]), y: Number(row[1]) }))
			.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
	}

	function escapeCsvCell(value: string): string {
		if (/[",\n\r]/.test(value)) {
			return `"${value.replaceAll('"', '""')}"`;
		}

		return value;
	}

	function exportCsv(series: DataSeries): void {
		const lines = [
			series.columns.map((column) => escapeCsvCell(column.name)).join(','),
			...series.rows
				.filter((row) => row.some((cell) => cell.trim().length > 0))
				.map((row) =>
					series.columns.map((_, columnIndex) => escapeCsvCell(row[columnIndex] ?? '')).join(',')
				)
		];

		saveText(
			lines.join('\n'),
			`${series.name.toLowerCase().replace(/\s+/g, '-') || 'plotrix-data'}.csv`,
			'text/csv;charset=utf-8'
		);
		ui.pushToast({
			title: 'CSV exported',
			description: `${series.name} was exported as CSV.`,
			tone: 'success'
		});
	}
</script>

<input bind:this={importInput} type="file" accept=".csv" class="sr-only" onchange={importCsv} />

<section class="data-panel panel">
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
									tabindex="0"
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
								class="add tiny"
								onclick={() => addColumn(activeSheet)}
								aria-label="Add column"
							>
								<Icon icon={Plus} size="var(--icon-sm)" class="action-icon" />
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
							<td class="row-actions">
								<button
									type="button"
									class="tiny"
									aria-label={`Delete row ${rowIndex + 1}`}
									onclick={() => deleteRow(activeSheet, rowIndex)}
								>
									<Icon icon={Trash2} size="var(--icon-sm)" class="action-icon" />
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="series-options">
			<div class="symbols" role="group" aria-label="Scatter symbol">
				{#each ['circle', 'square', 'triangle', 'cross', 'diamond'] as symbol (symbol)}
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

			<div class="actions">
				<button
					type="button"
					class="primary"
					onclick={() => graph.updateDataSeries(activeSheet.id, { plotted: true })}
				>
					<Icon icon={ScatterChart} size="var(--icon-md)" class="action-icon" />
					<span>Plot</span>
				</button>
				<button type="button" class="secondary" onclick={() => resetSheet(activeSheet)}>
					<span>Reset sheet</span>
				</button>
				<button
					type="button"
					class="secondary"
					onclick={() => graph.updateDataSeries(activeSheet.id, { plotted: false })}
				>
					<Icon icon={Trash2} size="var(--icon-md)" class="action-icon" />
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
					<Icon icon={TrendingUp} size="var(--icon-md)" class="action-icon" />
					<span>Fit curve</span>
				</button>
				<button type="button" class="secondary" onclick={() => importInput?.click()}>
					<Icon icon={Upload} size="var(--icon-md)" class="action-icon" />
					<span>Import CSV</span>
				</button>
				<button type="button" class="secondary" onclick={() => exportCsv(activeSheet)}>
					<Icon icon={Download} size="var(--icon-md)" class="action-icon" />
					<span>Export CSV</span>
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
				<Icon icon={Plus} size="var(--icon-md)" class="action-icon" />
			</button>
		</div>
	{/if}
</section>
