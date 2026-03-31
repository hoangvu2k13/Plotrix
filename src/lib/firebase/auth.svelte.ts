import { browser } from '$app/environment';
import {
	browserLocalPersistence,
	createUserWithEmailAndPassword,
	getAuth,
	GoogleAuthProvider,
	indexedDBLocalPersistence,
	onAuthStateChanged,
	setPersistence,
	signInWithEmailAndPassword,
	signInWithPopup,
	signOut,
	updateProfile,
	type Auth,
	type User
} from 'firebase/auth';

import { firebaseSetup, getFirebaseApp } from '$lib/firebase/config';

export interface AuthUser {
	uid: string;
	email: string | null;
	displayName: string | null;
	photoURL: string | null;
}

export interface AuthStateShape {
	available: boolean;
	configured: boolean;
	error: string | null;
	initialized: boolean;
	loading: boolean;
	missingFields: string[];
	pendingAction:
		| 'bootstrap'
		| 'email-sign-in'
		| 'email-sign-up'
		| 'google-sign-in'
		| 'sign-out'
		| null;
	user: AuthUser | null;
}

function normalizeAuthUser(user: User | null): AuthUser | null {
	if (!user) {
		return null;
	}

	return {
		uid: user.uid,
		email: user.email,
		displayName: user.displayName,
		photoURL: user.photoURL
	};
}

function normalizeAuthError(error: unknown): string {
	if (!(error instanceof Error)) {
		return 'Authentication failed. Try again.';
	}

	const code = (error as Error & { code?: string }).code ?? '';

	switch (code) {
		case 'auth/configuration-not-found':
			return 'Cloud sign-in is unavailable.';
		case 'auth/email-already-in-use':
			return 'That email address already has an account.';
		case 'auth/invalid-credential':
		case 'auth/invalid-login-credentials':
		case 'auth/wrong-password':
		case 'auth/user-not-found':
			return 'The email or password is incorrect.';
		case 'auth/popup-blocked':
			return 'The Google sign-in popup was blocked by the browser.';
		case 'auth/popup-closed-by-user':
			return 'The Google sign-in popup was closed before completion.';
		case 'auth/network-request-failed':
			return "Couldn't reach the server. Check your connection and try again.";
		case 'auth/too-many-requests':
			return 'Too many attempts. Try again later.';
		case 'auth/weak-password':
			return 'Choose a stronger password before creating the account.';
		default:
			return error.message || 'Authentication failed. Try again.';
	}
}

export function createAuthState() {
	const state = $state<AuthStateShape>({
		available: browser && firebaseSetup.configured,
		configured: firebaseSetup.configured,
		error: null,
		initialized: false,
		loading: false,
		missingFields: [...firebaseSetup.missingFields],
		pendingAction: null,
		user: null
	});

	let auth: Auth | null = null;
	let unsubscribe: (() => void) | null = null;
	let initPromise: Promise<AuthUser | null> | null = null;
	let persistenceReady = false;

	function clearError(): void {
		state.error = null;
	}

	async function ensureAuth(): Promise<Auth | null> {
		const app = getFirebaseApp();

		if (!app) {
			return null;
		}

		auth ??= getAuth(app);

		if (!persistenceReady) {
			try {
				await setPersistence(auth, indexedDBLocalPersistence);
			} catch {
				await setPersistence(auth, browserLocalPersistence);
			}

			persistenceReady = true;
		}

		return auth;
	}

	async function initialize(): Promise<AuthUser | null> {
		if (!browser) {
			state.initialized = true;
			return null;
		}

		if (initPromise) {
			return initPromise;
		}

		if (!firebaseSetup.configured) {
			state.initialized = true;
			state.available = false;
			return null;
		}

		state.loading = true;
		state.pendingAction = 'bootstrap';

		initPromise = (async () => {
			const instance = await ensureAuth();

			if (!instance) {
				state.loading = false;
				state.pendingAction = null;
				state.initialized = true;
				state.available = false;
				return null;
			}

			return await new Promise<AuthUser | null>((resolve) => {
				unsubscribe = onAuthStateChanged(
					instance,
					(user) => {
						state.user = normalizeAuthUser(user);
						state.initialized = true;
						state.loading = false;
						if (state.pendingAction === 'bootstrap') {
							state.pendingAction = null;
						}
						resolve(state.user);
					},
					(error) => {
						state.error = normalizeAuthError(error);
						state.initialized = true;
						state.loading = false;
						state.pendingAction = null;
						resolve(null);
					}
				);
			});
		})();

		return initPromise;
	}

	async function signInWithEmail(email: string, password: string): Promise<void> {
		clearError();
		state.loading = true;
		state.pendingAction = 'email-sign-in';

		try {
			await initialize();
			const instance = await ensureAuth();

			if (!instance) {
				throw new Error('Cloud sign-in is unavailable.');
			}

			await signInWithEmailAndPassword(instance, email.trim(), password);
		} catch (error) {
			state.error = normalizeAuthError(error);
			throw error;
		} finally {
			state.loading = false;
			state.pendingAction = null;
		}
	}

	async function signUpWithEmail(email: string, password: string, displayName = ''): Promise<void> {
		clearError();
		state.loading = true;
		state.pendingAction = 'email-sign-up';

		try {
			await initialize();
			const instance = await ensureAuth();

			if (!instance) {
				throw new Error('Cloud sign-in is unavailable.');
			}

			const credential = await createUserWithEmailAndPassword(instance, email.trim(), password);

			if (displayName.trim().length) {
				await updateProfile(credential.user, { displayName: displayName.trim() });
			}

			state.user = normalizeAuthUser(instance.currentUser ?? credential.user);
		} catch (error) {
			state.error = normalizeAuthError(error);
			throw error;
		} finally {
			state.loading = false;
			state.pendingAction = null;
		}
	}

	async function signInWithGoogle(): Promise<void> {
		clearError();
		state.loading = true;
		state.pendingAction = 'google-sign-in';

		try {
			await initialize();
			const instance = await ensureAuth();

			if (!instance) {
				throw new Error('Cloud sign-in is unavailable.');
			}

			const provider = new GoogleAuthProvider();
			provider.setCustomParameters({ prompt: 'select_account' });
			await signInWithPopup(instance, provider);
		} catch (error) {
			state.error = normalizeAuthError(error);
			throw error;
		} finally {
			state.loading = false;
			state.pendingAction = null;
		}
	}

	async function signOutUser(): Promise<void> {
		clearError();
		state.loading = true;
		state.pendingAction = 'sign-out';

		try {
			await initialize();
			const instance = await ensureAuth();

			if (!instance) {
				state.user = null;
				return;
			}

			await signOut(instance);
			state.user = null;
		} catch (error) {
			state.error = normalizeAuthError(error);
			throw error;
		} finally {
			state.loading = false;
			state.pendingAction = null;
		}
	}

	function destroy(): void {
		unsubscribe?.();
		unsubscribe = null;
		initPromise = null;
	}

	return Object.assign(state, {
		clearError,
		destroy,
		initialize,
		signInWithEmail,
		signInWithGoogle,
		signOut: signOutUser,
		signUpWithEmail
	});
}

export const authState = createAuthState();
export type AuthState = ReturnType<typeof createAuthState>;
