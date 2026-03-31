<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { getFirestore } from 'firebase/firestore';
	import { onMount } from 'svelte';

	import GraphCanvas from '$components/GraphCanvas.svelte';
	import { getFirebaseApp } from '$lib/firebase/config';
	import { loadPublicWorkspaceRecord } from '$lib/firebase/projects';
	import { createGraphState } from '$stores/graph.svelte';
	import { createUiState } from '$stores/ui.svelte';

	let { data } = $props<{ data: { workspaceId: string } }>();

	const graph = createGraphState();
	const ui = createUiState();

	let loading = $state(true);
	let errorMessage = $state<string | null>(null);
	let showControls = $state(false);
	let showEquationOverlay = $state(false);

	function applyThemeOverride(): void {
		const theme = page.url.searchParams.get('theme');
		graph.updateSettings({
			theme: theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system'
		});
		showControls = page.url.searchParams.get('controls') === 'true';
		showEquationOverlay = page.url.searchParams.get('equations') === 'true';
	}

	onMount(() => {
		applyThemeOverride();

		if (!browser) {
			return;
		}

		const app = getFirebaseApp();

		if (!app) {
			errorMessage = 'Firebase is unavailable for this embed.';
			loading = false;
			return;
		}

		void (async () => {
			try {
				const record = await loadPublicWorkspaceRecord(getFirestore(app), data.workspaceId);

				if (!record.snapshot || !record.isPublic) {
					errorMessage = 'This Plotrix embed is unavailable.';
					return;
				}

				await graph.importJSON(JSON.stringify(record.snapshot), {
					commitHistory: false,
					resetHistory: true
				});
				ui.setSidebarOpen(false);
			} catch (error) {
				errorMessage =
					error instanceof Error ? error.message : 'This Plotrix embed could not be loaded.';
			} finally {
				loading = false;
			}
		})();
	});
</script>

<svelte:head>
	<title>Plotrix Embed</title>
</svelte:head>

<div style="position:relative;width:100%;height:100vh;background:var(--color-bg-base);">
	{#if loading}
		<div style="position:absolute;inset:0;display:grid;place-items:center;">Loading graph…</div>
	{:else if errorMessage}
		<div
			style="position:absolute;inset:0;display:grid;place-items:center;padding:2rem;text-align:center;"
		>
			{errorMessage}
		</div>
	{:else}
		<GraphCanvas {graph} {ui} interactive={false} {showControls} showRangeInputs={false} />
		{#if showEquationOverlay}
			<div
				style="position:absolute;top:12px;left:12px;max-width:min(320px,calc(100vw - 24px));padding:12px 14px;border:1px solid var(--color-border);border-radius:12px;background:color-mix(in oklch, var(--color-bg-surface) 92%, transparent);backdrop-filter:blur(12px);display:grid;gap:8px;"
			>
				<strong>Equations</strong>
				{#each graph.equations.filter( (equation) => graph.isEquationEffectivelyVisible(equation.id) ) as equation (equation.id)}
					<div
						style="display:grid;grid-template-columns:10px minmax(0,1fr);gap:10px;align-items:start;"
					>
						<span
							aria-hidden="true"
							style={`width:10px;height:10px;border-radius:999px;background:${equation.color};margin-top:5px;`}
						></span>
						<div style="min-width:0;">
							<div
								style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
							>
								{equation.label || equation.raw}
							</div>
							<div
								style="color:var(--color-text-secondary);font-size:0.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
							>
								{equation.raw}
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>
