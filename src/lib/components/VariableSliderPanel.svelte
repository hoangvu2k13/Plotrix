<script lang="ts">
	import { ChevronDown, Play, Square } from '@lucide/svelte';
	import { onDestroy } from 'svelte';

	import Icon from '$components/Icon.svelte';
	import Slider from '$components/Slider.svelte';
	import type { GraphState, Variable } from '$stores/graph.svelte';

	let { graph } = $props<{ graph: GraphState }>();

	let collapsed = $state(false);
	let running = $state(new Set<string>());
	const frames = new Map<string, number>();

	function toggleAnimation(variable: Variable): void {
		const active = frames.get(variable.name);

		if (active) {
			cancelAnimationFrame(active);
			frames.delete(variable.name);
			running = new Set([...running].filter((name) => name !== variable.name));
			return;
		}

		let previous = performance.now();

		const step = (now: number) => {
			const elapsed = Math.min(now - previous, 33) / 1000;
			previous = now;
			const delta = variable.step * 60 * elapsed;
			let next = variable.value + delta;

			if (next > variable.max) {
				next = variable.min + (next - variable.max);
			}

			graph.updateVariable(variable.name, { value: next });
			frames.set(variable.name, requestAnimationFrame(step));
		};

		frames.set(variable.name, requestAnimationFrame(step));
		running = new Set(running).add(variable.name);
	}

	onDestroy(() => {
		for (const frame of frames.values()) {
			cancelAnimationFrame(frame);
		}
	});
</script>

{#if graph.variables.length}
	<section class="panel">
		<button
			type="button"
			class="header"
			aria-expanded={!collapsed}
			onclick={() => (collapsed = !collapsed)}
		>
			<span>Variables</span>
			<Icon
				icon={ChevronDown}
				size="var(--icon-md)"
				class={collapsed ? 'header-icon chevron-rotated' : 'header-icon'}
			/>
		</button>

		{#if !collapsed}
			<div class="rows">
				{#each graph.variables as variable, index (variable.name)}
					<div class="row">
						<div class="main">
							<strong>{variable.name}</strong>
							<Slider
								min={variable.min}
								max={variable.max}
								step={variable.step}
								value={variable.value}
								ariaLabel={`Variable ${variable.name}`}
								onChange={(value) => graph.updateVariable(variable.name, { value })}
							/>
							<input
								type="number"
								class="value-input"
								value={variable.value}
								step={variable.step}
								onblur={(event) =>
									graph.updateVariable(variable.name, {
										value: Number((event.currentTarget as HTMLInputElement).value)
									})}
							/>
							<button
								type="button"
								class="play"
								aria-label={running.has(variable.name)
									? `Stop animation for ${variable.name}`
									: `Play animation for ${variable.name}`}
								onclick={() => toggleAnimation(variable)}
							>
								{#if running.has(variable.name)}
									<Icon icon={Square} size="var(--icon-sm)" class="play-icon" />
								{:else}
									<Icon icon={Play} size="var(--icon-sm)" class="play-icon" />
								{/if}
							</button>
						</div>

						<div class="config">
							<input
								type="number"
								value={variable.min}
								aria-label={`${variable.name} minimum`}
								onblur={(event) =>
									graph.updateVariable(variable.name, {
										min: Number((event.currentTarget as HTMLInputElement).value)
									})}
							/>
							<span>to</span>
							<input
								type="number"
								value={variable.max}
								aria-label={`${variable.name} maximum`}
								onblur={(event) =>
									graph.updateVariable(variable.name, {
										max: Number((event.currentTarget as HTMLInputElement).value)
									})}
							/>
							<label>
								<span>step:</span>
								<input
									type="number"
									value={variable.step}
									onblur={(event) =>
										graph.updateVariable(variable.name, {
											step: Number((event.currentTarget as HTMLInputElement).value)
										})}
								/>
							</label>
						</div>
					</div>
					{#if index < graph.variables.length - 1}
						<div class="separator" aria-hidden="true"></div>
					{/if}
				{/each}
			</div>
		{/if}
	</section>
{/if}

<style>
	.panel {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-3);
		border: 1px solid color-mix(in srgb, var(--color-accent) 18%, var(--color-border));
		border-radius: var(--radius-xl);
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--color-accent) 7%, var(--color-bg-surface)),
			color-mix(in srgb, var(--color-bg-surface) 96%, transparent)
		);
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		font-weight: var(--font-weight-semibold);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		cursor: pointer;
	}

	:global(.header-icon) {
		transition: transform var(--duration-fast) var(--ease-default);
	}

	.rows,
	.row,
	.config {
		display: grid;
		gap: var(--space-2);
	}

	.main {
		display: grid;
		grid-template-columns: 24px minmax(0, 1fr) 60px 32px;
		align-items: center;
		gap: var(--space-2);
	}

	.main strong {
		font-family: var(--font-mono);
		color: var(--color-accent);
	}

	.value-input,
	.config input {
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-base);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}

	.play {
		display: inline-grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-overlay);
		cursor: pointer;
	}

	:global(.play-icon) {
		display: block;
	}

	.config {
		grid-template-columns: minmax(0, 1fr) 24px minmax(0, 1fr) 118px;
		align-items: center;
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}

	.config > span {
		width: 24px;
		text-align: center;
	}

	.config label {
		display: grid;
		grid-template-columns: 34px minmax(64px, 84px);
		align-items: center;
		gap: var(--space-1);
	}

	.config label span {
		width: 34px;
	}

	.separator {
		height: 1px;
		background: color-mix(in srgb, var(--color-border) 70%, transparent);
	}
</style>
