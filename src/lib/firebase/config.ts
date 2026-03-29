import { browser } from '$app/environment';
import {
	PUBLIC_FIREBASE_API_KEY,
	PUBLIC_FIREBASE_APP_ID,
	PUBLIC_FIREBASE_AUTH_DOMAIN,
	PUBLIC_FIREBASE_MEASUREMENT_ID,
	PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
	PUBLIC_FIREBASE_PROJECT_ID,
	PUBLIC_FIREBASE_STORAGE_BUCKET
} from '$env/static/public';
import {
	getApp,
	getApps,
	initializeApp,
	type FirebaseApp,
	type FirebaseOptions
} from 'firebase/app';

type RequiredFirebaseField =
	| 'PUBLIC_FIREBASE_API_KEY'
	| 'PUBLIC_FIREBASE_APP_ID'
	| 'PUBLIC_FIREBASE_AUTH_DOMAIN'
	| 'PUBLIC_FIREBASE_MESSAGING_SENDER_ID'
	| 'PUBLIC_FIREBASE_PROJECT_ID';

const firebaseConfig: FirebaseOptions = {
	apiKey: PUBLIC_FIREBASE_API_KEY,
	appId: PUBLIC_FIREBASE_APP_ID,
	authDomain: PUBLIC_FIREBASE_AUTH_DOMAIN,
	messagingSenderId: PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
	projectId: PUBLIC_FIREBASE_PROJECT_ID,
	...(PUBLIC_FIREBASE_STORAGE_BUCKET ? { storageBucket: PUBLIC_FIREBASE_STORAGE_BUCKET } : {}),
	...(PUBLIC_FIREBASE_MEASUREMENT_ID ? { measurementId: PUBLIC_FIREBASE_MEASUREMENT_ID } : {})
};

const missingFields = (
	[
		['PUBLIC_FIREBASE_API_KEY', PUBLIC_FIREBASE_API_KEY],
		['PUBLIC_FIREBASE_APP_ID', PUBLIC_FIREBASE_APP_ID],
		['PUBLIC_FIREBASE_AUTH_DOMAIN', PUBLIC_FIREBASE_AUTH_DOMAIN],
		['PUBLIC_FIREBASE_MESSAGING_SENDER_ID', PUBLIC_FIREBASE_MESSAGING_SENDER_ID],
		['PUBLIC_FIREBASE_PROJECT_ID', PUBLIC_FIREBASE_PROJECT_ID]
	] as const
)
	.filter(([, value]) => !value.trim().length)
	.map(([field]) => field) as RequiredFirebaseField[];

export const firebaseSetup = {
	config: firebaseConfig,
	configured: missingFields.length === 0,
	missingFields
};

export function getFirebaseApp(): FirebaseApp | null {
	if (!browser || !firebaseSetup.configured) {
		return null;
	}

	return getApps().length ? getApp() : initializeApp(firebaseConfig);
}
