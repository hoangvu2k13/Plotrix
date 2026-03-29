export function saveBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.rel = 'noopener';
	anchor.style.display = 'none';
	document.body.append(anchor);
	anchor.click();
	setTimeout(() => {
		anchor.remove();
		URL.revokeObjectURL(url);
	}, 0);
}

export function saveText(text: string, filename: string, type = 'application/json'): void {
	saveBlob(new Blob([text], { type }), filename);
}

export async function copyText(text: string): Promise<void> {
	if (navigator.clipboard?.writeText && window.isSecureContext) {
		await navigator.clipboard.writeText(text);
		return;
	}

	const textarea = document.createElement('textarea');
	textarea.value = text;
	textarea.setAttribute('readonly', 'true');
	textarea.style.position = 'fixed';
	textarea.style.top = '0';
	textarea.style.left = '-9999px';
	document.body.append(textarea);
	textarea.select();
	textarea.setSelectionRange(0, text.length);

	try {
		const copied = document.execCommand('copy');

		if (!copied) {
			throw new Error('Clipboard access is unavailable in this browser.');
		}
	} finally {
		textarea.remove();
	}
}
