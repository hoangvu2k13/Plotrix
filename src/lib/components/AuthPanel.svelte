<script lang="ts">
	import {
		Cloud,
		CloudOff,
		LoaderCircle,
		LogOut,
		Mail,
		ShieldCheck,
		UserRound,
		UserRoundPlus
	} from '@lucide/svelte';

	import Icon from '$components/Icon.svelte';
	import type { AuthState } from '$lib/firebase/auth.svelte';
	import type { WorkspaceSyncState } from '$lib/firebase/workspace-sync.svelte';

	let {
		auth,
		sync,
		onClose = () => {}
	} = $props<{
		auth: AuthState;
		sync: WorkspaceSyncState;
		onClose?: () => void;
	}>();

	let mode = $state<'sign-in' | 'sign-up'>('sign-in');
	let displayName = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');

	const isBusy = $derived(auth.loading && auth.pendingAction !== null);
	const emailError = $derived.by(() => {
		if (!email.trim().length) {
			return 'Email is required.';
		}

		return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : 'Enter a valid email address.';
	});
	const passwordError = $derived.by(() => {
		if (!password.length) {
			return 'Password is required.';
		}

		if (mode === 'sign-up' && password.length < 8) {
			return 'Use at least 8 characters for new accounts.';
		}

		return null;
	});
	const confirmPasswordError = $derived.by(() => {
		if (mode !== 'sign-up') {
			return null;
		}

		if (!confirmPassword.length) {
			return 'Confirm the password.';
		}

		return confirmPassword === password ? null : 'The passwords do not match.';
	});
	const primaryActionLabel = $derived.by(() =>
		mode === 'sign-in'
			? auth.pendingAction === 'email-sign-in'
				? 'Signing in...'
				: 'Sign in'
			: auth.pendingAction === 'email-sign-up'
				? 'Creating account...'
				: 'Create account'
	);
	const googleActionLabel = $derived.by(() =>
		auth.pendingAction === 'google-sign-in' ? 'Opening Google...' : 'Continue with Google'
	);
	const syncStatusLabel = $derived.by(() => {
		switch (sync.status) {
			case 'disabled':
				return 'Firebase is not configured.';
			case 'error':
				return sync.error ?? 'Workspace sync is paused.';
			case 'loading':
				return 'Restoring your synced workspace...';
			case 'syncing':
				return 'Syncing your workspace to Firebase...';
			case 'synced':
				return 'Realtime sync is active for this account.';
			default:
				return 'This browser is currently using local-only storage.';
		}
	});

	function switchMode(nextMode: 'sign-in' | 'sign-up'): void {
		mode = nextMode;
		auth.clearError();
		password = '';
		confirmPassword = '';
	}

	async function submit(): Promise<void> {
		auth.clearError();

		if (emailError || passwordError || confirmPasswordError) {
			return;
		}

		try {
			if (mode === 'sign-in') {
				await auth.signInWithEmail(email, password);
			} else {
				await auth.signUpWithEmail(email, password, displayName);
			}
			onClose();
		} catch {
			// Error state is surfaced through the centralized auth store.
		}
	}

	async function continueWithGoogle(): Promise<void> {
		auth.clearError();

		try {
			await auth.signInWithGoogle();
			onClose();
		} catch {
			// Error state is surfaced through the centralized auth store.
		}
	}

	async function signOutCurrentUser(): Promise<void> {
		auth.clearError();

		try {
			await auth.signOut();
			onClose();
		} catch {
			// Error state is surfaced through the centralized auth store.
		}
	}
</script>

<div class="auth-panel">
	{#if auth.user}
		<section class="auth-account-card">
			<div class="auth-account-head">
				<div class="auth-avatar" aria-hidden="true">
					{#if auth.user.photoURL}
						<img src={auth.user.photoURL} alt="" referrerpolicy="no-referrer" />
					{:else}
						<Icon icon={UserRound} size="var(--icon-lg)" class="auth-avatar-icon" />
					{/if}
				</div>
				<div class="auth-account-copy">
					<strong>{auth.user.displayName || auth.user.email || 'Signed-in account'}</strong>
					<p>{auth.user.email || 'Firebase account session is active.'}</p>
				</div>
			</div>

			<div class="auth-sync-status" data-tone={sync.status === 'error' ? 'warning' : 'success'}>
				<div class="auth-sync-icon" aria-hidden="true">
					<Icon
						icon={sync.status === 'error' ? CloudOff : ShieldCheck}
						size="var(--icon-md)"
						class="auth-inline-icon"
					/>
				</div>
				<div class="auth-sync-copy">
					<strong>{sync.projectName}</strong>
					<p>{syncStatusLabel}</p>
					{#if sync.lastSyncedAt}
						<small>Last client sync {new Date(sync.lastSyncedAt).toLocaleTimeString()}</small>
					{/if}
				</div>
				<div class="auth-sync-pill" data-state={sync.status}>
					{sync.status === 'syncing' ? 'Syncing' : sync.status === 'error' ? 'Paused' : 'Synced'}
				</div>
			</div>

			<p class="auth-footnote">
				Plotrix is syncing equations, data tables, graph settings, annotations, and regression
				history in real time for this account.
			</p>

			<button
				type="button"
				class="action-btn action-btn-secondary auth-signout"
				disabled={isBusy}
				onclick={signOutCurrentUser}
			>
				<Icon icon={LogOut} size="var(--icon-md)" class="auth-inline-icon" />
				<span>{auth.pendingAction === 'sign-out' ? 'Signing out...' : 'Sign out'}</span>
			</button>

			{#if auth.error}
				<p class="auth-error" role="alert">{auth.error}</p>
			{/if}
		</section>
	{:else}
		<section class="auth-intro">
			<div>
				<strong>Account sync</strong>
				<p>
					Sign in to bind this workspace to Firebase and keep it in sync across browser sessions in
					real time.
				</p>
			</div>
			<div class="auth-mode-switch" role="tablist" aria-label="Authentication mode">
				<button
					type="button"
					role="tab"
					class:active={mode === 'sign-in'}
					aria-selected={mode === 'sign-in'}
					onclick={() => switchMode('sign-in')}
				>
					<Icon icon={Mail} size="var(--icon-sm)" class="auth-inline-icon" />
					<span>Sign in</span>
				</button>
				<button
					type="button"
					role="tab"
					class:active={mode === 'sign-up'}
					aria-selected={mode === 'sign-up'}
					onclick={() => switchMode('sign-up')}
				>
					<Icon icon={UserRoundPlus} size="var(--icon-sm)" class="auth-inline-icon" />
					<span>Create account</span>
				</button>
			</div>
		</section>

		<form
			class="auth-form"
			onsubmit={async (event) => {
				event.preventDefault();
				await submit();
			}}
		>
			{#if mode === 'sign-up'}
				<label class="auth-field">
					<span>Name</span>
					<input
						type="text"
						bind:value={displayName}
						placeholder="How Plotrix should label your account"
						autocomplete="name"
						disabled={isBusy || !auth.available}
					/>
				</label>
			{/if}

			<label class="auth-field">
				<span>Email</span>
				<input
					type="email"
					bind:value={email}
					placeholder="name@example.com"
					autocomplete={mode === 'sign-in' ? 'email' : 'username'}
					inputmode="email"
					disabled={isBusy || !auth.available}
				/>
				{#if emailError}
					<small class="auth-error">{emailError}</small>
				{/if}
			</label>

			<label class="auth-field">
				<span>Password</span>
				<input
					type="password"
					bind:value={password}
					placeholder={mode === 'sign-in' ? 'Enter your password' : 'Use at least 8 characters'}
					autocomplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
					disabled={isBusy || !auth.available}
				/>
				{#if passwordError}
					<small class="auth-error">{passwordError}</small>
				{/if}
			</label>

			{#if mode === 'sign-up'}
				<label class="auth-field">
					<span>Confirm password</span>
					<input
						type="password"
						bind:value={confirmPassword}
						placeholder="Repeat the password"
						autocomplete="new-password"
						disabled={isBusy || !auth.available}
					/>
					{#if confirmPasswordError}
						<small class="auth-error">{confirmPasswordError}</small>
					{/if}
				</label>
			{/if}

			{#if auth.error}
				<p class="auth-error" role="alert">{auth.error}</p>
			{/if}

			<button
				type="submit"
				class="action-btn action-btn-primary auth-submit"
				disabled={Boolean(emailError || passwordError || confirmPasswordError) ||
					isBusy ||
					!auth.available}
			>
				{#if isBusy && (auth.pendingAction === 'email-sign-in' || auth.pendingAction === 'email-sign-up')}
					<Icon icon={LoaderCircle} size="var(--icon-md)" class="auth-inline-icon spin-icon" />
				{/if}
				<span>{primaryActionLabel}</span>
			</button>
		</form>

		<div class="auth-divider"><span>or</span></div>

		<button
			type="button"
			class="action-btn action-btn-secondary auth-google"
			disabled={isBusy || !auth.available}
			onclick={continueWithGoogle}
		>
			{#if auth.pendingAction === 'google-sign-in'}
				<Icon icon={LoaderCircle} size="var(--icon-md)" class="auth-inline-icon spin-icon" />
			{:else}
				<Icon icon={Cloud} size="var(--icon-md)" class="auth-inline-icon" />
			{/if}
			<span>{googleActionLabel}</span>
		</button>

		<div class="auth-sync-status" data-tone={auth.available ? 'success' : 'warning'}>
			<div class="auth-sync-icon" aria-hidden="true">
				<Icon
					icon={auth.available ? Cloud : CloudOff}
					size="var(--icon-md)"
					class="auth-inline-icon"
				/>
			</div>
			<div class="auth-sync-copy">
				<strong>{auth.available ? 'Firebase ready' : 'Firebase unavailable'}</strong>
				<p>{syncStatusLabel}</p>
				{#if !auth.available && auth.missingFields.length}
					<small>Missing: {auth.missingFields.join(', ')}</small>
				{/if}
			</div>
		</div>

		<p class="auth-footnote">
			Guest mode keeps your workspace only on this device. Signing in turns on account-bound,
			realtime sync through Firebase.
		</p>
	{/if}
</div>
