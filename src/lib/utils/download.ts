export function saveBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}

export function saveText(text: string, filename: string, type = 'application/json'): void {
	saveBlob(new Blob([text], { type }), filename);
}

export async function copyText(text: string): Promise<void> {
	await navigator.clipboard.writeText(text);
}
