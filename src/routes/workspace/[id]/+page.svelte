<script lang="ts">
	import WorkspaceShell from '$components/WorkspaceShell.svelte';

	let { data } = $props<{ data: { workspaceId: string } }>();
</script>

<WorkspaceShell workspaceId={data.workspaceId} />
