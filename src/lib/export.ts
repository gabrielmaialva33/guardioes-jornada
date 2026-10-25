import type { Session } from './session.ts';

/** Saves a session as a JSON file the guide can keep or share; photos stay on the phone. */
export function downloadSession(session: Session) {
	const name = [session.participant || session.school || 'jornada', session.className, session.date]
		.filter(Boolean)
		.join('-')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-zA-Z0-9-]+/g, '-')
		.toLowerCase();
	const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const link = Object.assign(document.createElement('a'), { href: url, download: `${name}.json` });
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
