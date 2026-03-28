<script lang="ts">
	/*
	Icon mapping guide for contributors:
	- sidebar toggle -> PanelLeft / PanelRight
	- add / add column / add sheet -> Plus
	- delete / clear -> Trash2
	- duplicate / copy report -> Copy / ClipboardCopy
	- visibility -> Eye / EyeOff
	- collapse / expand / reorder -> ChevronDown / ChevronUp
	- close -> X
	- settings -> Settings2
	- export -> Download
	- share -> Share2
	- undo / redo -> Undo2 / Redo2
	- theme -> SunMoon
	- command palette -> Terminal
	- analyze -> BarChart2
	- zoom in / out -> Plus / Minus
	- fit -> Maximize2
	- reset -> Home
	- search -> Search
	- warning -> AlertTriangle
	- play / stop -> Play / Square
	- scatter plot -> ScatterChart
	- import -> Upload
	- fit curve -> TrendingUp
	- drag handle -> GripVertical
	- crosshair -> Crosshair
	- trace -> MousePointer2
	- grid -> Grid3x3
	- intersection -> X
	*/
	import type { Component } from 'svelte';

	type LucideIcon = Component<{
		size?: number | string;
		color?: string;
		strokeWidth?: number | string;
		class?: string;
		role?: string;
		'aria-hidden'?: 'true' | 'false';
		'aria-label'?: string;
	}>;

	type PhosphorIcon = Component<{
		size?: number | string;
		color?: string;
		weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
		class?: string;
		role?: string;
		'aria-hidden'?: 'true' | 'false';
		'aria-label'?: string;
	}>;

	type IconSource = LucideIcon | PhosphorIcon;

	let {
		icon,
		library = 'lucide',
		size = 'var(--icon-md)',
		label,
		class: className = ''
	} = $props<{
		icon: IconSource;
		library?: 'lucide' | 'phosphor';
		size?: 'var(--icon-sm)' | 'var(--icon-md)' | 'var(--icon-lg)' | 'var(--icon-xl)';
		label?: string;
		class?: string;
	}>();

	const LucideComponent = $derived(icon as LucideIcon);
	const PhosphorComponent = $derived(icon as PhosphorIcon);
</script>

{#if library === 'lucide'}
	<LucideComponent
		size={size}
		color="currentColor"
		strokeWidth={1.7}
		class={className}
		{...(label
			? { 'aria-label': label, 'aria-hidden': 'false' as const, role: 'img' }
			: { 'aria-hidden': 'true' as const })}
	/>
{:else}
	<PhosphorComponent
		size={size}
		color="currentColor"
		weight="regular"
		class={className}
		{...(label
			? { 'aria-label': label, 'aria-hidden': 'false' as const, role: 'img' }
			: { 'aria-hidden': 'true' as const })}
	/>
{/if}
