// The on-screen warning of the worker that runs on a PC (v0.15.0): a card
// that slides in on the screen chosen in its settings — the second one by
// default — when a post did not go out, and stays until Dismiss is pressed.
//
// What counts is what turns flock's To finish box red: a post that failed in
// the last week, or one never sent after its slot (src/lib/attention.ts —
// the two rules are the same, and so are the keys, so a post dismissed or
// retried in flock leaves the card too). Dismiss on the card hides it on this
// PC only: the post stays in To finish with its Retry button, and only a post
// that fails afterwards brings the card back. The card itself, the settings
// window and Start with Windows are the tray helper's (trayapp.mjs).

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** How long a failure is worth a warning; To finish lists it as long. */
export const FAILED_WINDOW_MS = 7 * DAY;

const LABELS = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook' };

const time = (iso) => Date.parse(String(iso ?? '').replace(' ', 'T'));

/* ---- settings ---- */

export const SCREENS = ['second', 'main', 'mouse'];
export const POSITIONS = [
	'top-left',
	'top',
	'top-right',
	'left',
	'center',
	'right',
	'bottom-left',
	'bottom',
	'bottom-right'
];
export const SIZES = ['small', 'medium', 'large'];

/**
 * What the card looks like and where it goes. `screen` is one of SCREENS or
 * a display's device name (`\\.\DISPLAY2`), which falls back to the second
 * screen while that display is not connected.
 */
export const ALERT_DEFAULTS = {
	enabled: true,
	screen: 'second',
	position: 'top-right',
	size: 'medium',
	pulse: true,
	slide: true,
	showTitles: true
};

/** The `alerts` section of the config, field by field, whatever it holds. */
export function readAlertSettings(raw) {
	const r = raw && typeof raw === 'object' ? raw : {};
	const bool = (key) => (typeof r[key] === 'boolean' ? r[key] : ALERT_DEFAULTS[key]);
	const screen =
		typeof r.screen === 'string' && (SCREENS.includes(r.screen) || /^\\\\\.\\DISPLAY\d+$/i.test(r.screen))
			? r.screen
			: ALERT_DEFAULTS.screen;
	return {
		enabled: bool('enabled'),
		screen,
		position: POSITIONS.includes(r.position) ? r.position : ALERT_DEFAULTS.position,
		size: SIZES.includes(r.size) ? r.size : ALERT_DEFAULTS.size,
		pulse: bool('pulse'),
		slide: bool('slide'),
		showTitles: bool('showTitles')
	};
}

/* ---- what to warn about ---- */

/**
 * The posts that did not go out, newest slot first: failed within the last
 * week, or `pending` 10 minutes past when they were due — a YouTube post is
 * sent at once, so from its job's creation — counted from the row's last
 * change too, so one just retried is not flagged. A local pick still being
 * copied to the NAS is waiting, not late. Each row comes with its job
 * expanded (`created`, `title`, `source_local`).
 */
export function undelivered(targets, now = new Date()) {
	const at = now.getTime();
	const out = [];
	for (const t of [...targets].sort((a, b) => time(b.scheduled_at) - time(a.scheduled_at))) {
		const job = t.expand?.job ?? {};
		const slot = time(t.scheduled_at);
		const item = {
			platform: t.platform,
			label: LABELS[t.platform] ?? t.platform,
			title: t.title || job.title || 'Untitled',
			job: t.job,
			detail: String(t.error ?? '').split('\n')[0]
		};
		if (t.status === 'failed' && at - slot < FAILED_WINDOW_MS) {
			out.push({ key: `failed:${t.id}:${t.updated ?? ''}`, kind: 'failed', ...item });
		} else if (t.status === 'pending' && !job.source_local) {
			const due = t.platform === 'youtube' ? time(job.created) : slot;
			const changed = time(t.updated);
			const since = Number.isFinite(changed) ? Math.max(due, changed) : due;
			if (at - since > 10 * MIN) {
				out.push({ key: `unsent:${t.id}`, kind: 'unsent', ...item, detail: 'Its slot passed and it was never sent.' });
			}
		}
	}
	return out;
}

/** The warnings to show: less what flock's To finish dismissed, and what was dismissed on this PC. */
export function toShow(items, { dismissed = [], seen = [] } = {}) {
	const gone = new Set([...dismissed, ...seen]);
	return items.filter((item) => !gone.has(item.key));
}

/** The dismissed keys in flock's `todo_attention` row, whatever it holds. */
export function readDismissed(value) {
	const list = value?.dismissed;
	return Array.isArray(list) ? list.filter((k) => typeof k === 'string' && k) : [];
}

/** Enough for months of warnings; the oldest go first. */
export const SEEN_CAP = 300;

/** The keys dismissed on this PC, from the config's `alerts` section. */
export function readSeen(raw) {
	const list = raw?.seen;
	return Array.isArray(list) ? list.filter((k) => typeof k === 'string' && k) : [];
}

export function addSeen(seen, keys) {
	const out = seen.filter((k) => !keys.includes(k));
	out.push(...keys.filter(Boolean));
	return out.slice(-SEEN_CAP);
}

/** Whether two lists of warnings are the same, so the card is only told of a change. */
export function sameWarnings(a, b) {
	return a.length === b.length && a.every((item, i) => item.key === b[i].key);
}

/**
 * The card's view of the warnings: one line each, and where "Open in flock"
 * goes — the upload's overview in the Log, where its Retry button is.
 */
export function cardItems(items, flockUrl) {
	const base = String(flockUrl ?? '').replace(/\/+$/, '');
	return items.map((item) => ({
		key: item.key,
		platform: item.label,
		title: item.title,
		detail: item.detail,
		url: base && item.job ? `${base}/log/upload?job=${encodeURIComponent(item.job)}` : base ? `${base}/` : ''
	}));
}

/* ---- start with Windows ---- */

/** The Run entry's name, so a PC with two roles' workers keeps one each. */
export function runName(role) {
	return role === 'all' ? 'flock worker' : `flock worker (${role})`;
}

/** What Windows runs at sign-in: this executable, marked so a second copy leaves quietly. */
export function autostartCommand(exePath) {
	return `"${exePath}" --autostart`;
}

/* ---- the helper's line protocol ---- */

/**
 * Worker and helper talk in lines over the helper's stdin and stdout: a word,
 * then the payload as base64 of UTF-8 JSON, so titles with any characters in
 * them survive both pipes whatever their encodings.
 */
export function encodeLine(type, payload) {
	return payload === undefined
		? `${type}\n`
		: `${type} ${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}\n`;
}

export function decodeLine(line) {
	const text = String(line ?? '').trim();
	if (!text) return null;
	const at = text.indexOf(' ');
	if (at < 0) return { type: text, payload: undefined };
	try {
		return { type: text.slice(0, at), payload: JSON.parse(Buffer.from(text.slice(at + 1), 'base64').toString('utf8')) };
	} catch {
		return { type: text.slice(0, at), payload: undefined };
	}
}
