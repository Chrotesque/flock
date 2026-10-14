import { PLATFORMS, isPlatformId } from './platforms';
import { brandKey } from './brands';
import { formatSchedule, isoDate, parseTagList } from './format';
import type { Brand, PlatformId } from './types';

/**
 * The "flock block": a JSON object, typically written by Claude in a chat,
 * that fills an upload's text when pasted anywhere in flock with Ctrl+V.
 * A paste is ours only when it carries `"flock": 1`; anything else is left to
 * paste wherever it was going, untouched.
 *
 *   {
 *     "flock": 1,
 *     "brand": "Paper Moon",
 *     "thumbnail": "C:/Users/me/Pictures/thumb.png",
 *     "youtube":   { "title": "…", "description": "…", "tags": ["…"], "playlist": "…", "schedule": "2026-10-13 18:00" },
 *     "instagram": { "caption": "…", "schedule": "2026-10-13 19:30" },
 *     "tiktok":    { "caption": "…", "schedule": "now" }
 *   }
 *
 * `schedule` is the release slot, in local time — the clock where flock is
 * used — and only fills the Schedule step, where it can still be changed.
 *
 * Only text and what is written alongside it travel this way. TikTok's
 * audience, comments, Duet, Stitch and disclosure, and paid promotion, are
 * never read from a block: TikTok's guidelines want each picked by hand on
 * every post, and a pre-fill is the default they forbid.
 */

export const PASTE_VERSION = 1;

/** The YouTube tag box a block's tags land in; the other boxes keep theirs. */
export const PASTE_TAG_BOX = 'tagsOther';

export interface PastedPlatform {
	title?: string;
	description?: string;
	tags?: string[];
	playlist?: string;
	/** The release slot in local time, or 'now' to go out the moment the worker sees it. */
	schedule?: Slot | 'now';
}

export interface Slot {
	date: string;
	time: string;
}

export interface FlockPaste {
	brand: string;
	/** A path on the worker's machine; the worker fetches it (repo.requestLocalImage). */
	thumbnail: string;
	/** In the order the block names them. */
	platforms: Partial<Record<PlatformId, PastedPlatform>>;
	/** What was ignored or looks wrong, in words for the person who pasted. */
	notes: string[];
}

export type PasteResult = { ok: true; paste: FlockPaste } | { ok: false; error: string };

const MARK = /"flock"\s*:/;
const VERSION_ONE = /"flock"\s*:\s*"?1"?\s*[,}]/;

/**
 * Reads a paste. Null when it is not a flock block — no `"flock"` key at the
 * top — so the caller lets the paste through; an error when it is one that
 * cannot be used, so the person learns why nothing filled.
 */
export function readFlockPaste(text: string, now = Date.now()): PasteResult | null {
	if (!text || !MARK.test(text)) return null;
	const body = extractBlock(text);
	if (!body) return null;

	let data: unknown;
	try {
		data = parseLenient(rawPath(body, 'thumbnail'));
	} catch (err) {
		// Prose that merely mentions "flock": is not ours; a block that says it
		// is version 1 but does not parse is, and worth an explanation.
		if (!VERSION_ONE.test(body)) return null;
		const why = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `The pasted flock block is not valid JSON (${why}).` };
	}
	if (!isRecord(data) || !('flock' in data)) return null;

	const version = Number(data.flock);
	if (version !== PASTE_VERSION) {
		return {
			ok: false,
			error: `The pasted block is flock format ${String(data.flock)}; this flock reads format ${PASTE_VERSION}.`
		};
	}
	return { ok: true, paste: normalise(data, now) };
}

/**
 * The object holding the `"flock"` key, out of whatever surrounds it: the
 * code block's own Copy gives bare JSON, but copying a whole chat message
 * brings a ```json fence and prose along, braces and all. A fenced block that
 * mentions flock wins; otherwise the first `{` before the key is followed to
 * its matching `}`, reading strings properly so a brace inside a caption does
 * not end the object early. An object that never closes is returned to its
 * end, so the parse can say what is wrong with it.
 */
function extractBlock(text: string): string {
	for (const match of text.matchAll(/```[a-z]*\s*\n?([\s\S]*?)```/gi)) {
		if (MARK.test(match[1])) return match[1].trim();
	}
	const mark = text.search(MARK);
	for (let start = text.indexOf('{'); start >= 0 && start < mark; start = text.indexOf('{', start + 1)) {
		const end = matchingBrace(text, start);
		if (end < 0) return text.slice(start);
		if (end > mark) return text.slice(start, end + 1);
	}
	return '';
}

/** Index of the `}` closing the `{` at `start`, or -1 when it never closes. */
function matchingBrace(text: string, start: number): number {
	let depth = 0;
	let inString = false;
	for (let i = start; i < text.length; i++) {
		const c = text[i];
		if (inString) {
			if (c === '\\') i++;
			else if (c === '"') inString = false;
		} else if (c === '"') {
			inString = true;
		} else if (c === '{') {
			depth++;
		} else if (c === '}') {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/**
 * Re-escapes a path value so every backslash in it is a separator. A Windows
 * path written with single backslashes is the one mistake a chat reliably
 * makes, and JSON would read "C:\Users\me\thumb.png" as an error at `\U` —
 * or, worse, quietly turn `\t` into a tab. A path holds no escapes, so a
 * written `\\` and a lone `\` both mean one backslash here.
 */
function rawPath(body: string, key: string): string {
	const value = new RegExp(`("${key}"\\s*:\\s*)"((?:[^"\\\\]|\\\\.)*)"`);
	return body.replace(value, (_all, head: string, raw: string) =>
		`${head}${JSON.stringify(raw.replace(/\\\\|\\/g, '\\'))}`
	);
}

/**
 * JSON.parse, and once more with stray backslashes doubled elsewhere, for
 * the same mistake in any other value. Valid escapes, `\\` included, are left
 * alone.
 */
function parseLenient(body: string): unknown {
	try {
		return JSON.parse(body);
	} catch (err) {
		const repaired = body.replace(/\\(["\\/bfnrtu]?)/g, (all, next: string) => (next ? all : '\\\\'));
		if (repaired === body) throw err;
		try {
			return JSON.parse(repaired);
		} catch {
			throw err;
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const TOP_KEYS = new Set(['flock', 'brand', 'thumbnail']);
const PLATFORM_KEYS = new Set(['title', 'description', 'caption', 'tags', 'playlist', 'schedule']);

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A release slot as a block writes it: "2026-10-13 18:00", in local time.
 * A T for the space, seconds, and an offset ("…T18:00:00+02:00", "Z") are
 * taken too — an offset is turned into local time. "now" sends the post the
 * moment the worker sees it. Null for anything else, a day that does not
 * exist included.
 */
export function parseSchedule(value: unknown): Slot | 'now' | null {
	if (typeof value !== 'string') return null;
	const clean = value.trim();
	if (/^(now|immediately)$/i.test(clean)) return 'now';
	const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(clean);
	if (!m) return null;
	const [, y, mo, d, h, mi, zone] = m;
	if (Number(h) > 23 || Number(mi) > 59) return null;
	if (zone) {
		const offset = zone.toUpperCase() === 'Z' ? 'Z' : zone.includes(':') ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
		const at = new Date(`${y}-${mo}-${d}T${pad(Number(h))}:${mi}:00${offset}`);
		if (Number.isNaN(at.getTime())) return null;
		return { date: isoDate(at), time: `${pad(at.getHours())}:${pad(at.getMinutes())}` };
	}
	const local = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
	if (local.getMonth() !== Number(mo) - 1 || local.getDate() !== Number(d)) return null;
	return { date: `${y}-${mo}-${d}`, time: `${pad(Number(h))}:${mi}` };
}

function text(value: unknown): string | undefined {
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'number') return String(value);
	return undefined;
}

function normalise(data: Record<string, unknown>, now: number): FlockPaste {
	const notes: string[] = [];
	const platforms: FlockPaste['platforms'] = {};

	const brand = text(data.brand) ?? '';
	const thumbnail = text(data.thumbnail) ?? '';

	for (const [rawKey, value] of Object.entries(data)) {
		const key = rawKey.trim().toLowerCase();
		if (TOP_KEYS.has(key)) continue;
		if (!isPlatformId(key)) {
			notes.push(`Ignored "${rawKey}": not something flock reads.`);
			continue;
		}
		if (!isRecord(value)) {
			notes.push(`Ignored "${rawKey}": expected an object with its text.`);
			continue;
		}
		platforms[key] = readPlatform(key, value, notes, now);
	}

	if (Object.keys(platforms).length === 0 && !thumbnail) {
		notes.push('The block names no platform, so there was nothing to fill.');
	}
	return { brand, thumbnail, platforms, notes };
}

function readPlatform(id: PlatformId, value: Record<string, unknown>, notes: string[], now: number): PastedPlatform {
	const def = PLATFORMS[id];
	const out: PastedPlatform = {};

	for (const key of Object.keys(value)) {
		if (!PLATFORM_KEYS.has(key)) notes.push(`${def.label}: ignored "${key}".`);
	}

	const title = text(value.title);
	if (title !== undefined) {
		if (def.hasTitle) out.title = title;
		else if (title) notes.push(`${def.label} has no title; it was left out — put it in the caption if it belongs there.`);
	}

	// Either name is fine; a chat uses whichever it thinks of.
	const description = text(value.description);
	const caption = text(value.caption);
	if (description !== undefined && caption !== undefined && description !== caption) {
		notes.push(`${def.label}: both "description" and "caption" were given; used "description".`);
	}
	const body = description ?? caption;
	if (body !== undefined) out.description = body;

	if (value.tags !== undefined) {
		if (!def.tagBudget) {
			notes.push(`${def.label} takes no tags; hashtags belong in its caption.`);
		} else {
			const pieces = Array.isArray(value.tags)
				? value.tags.filter((t): t is string => typeof t === 'string')
				: typeof value.tags === 'string'
					? value.tags.split(',')
					: [];
			// A leading # is a hashtag habit, not part of a YouTube tag — dropped
			// before de-duplicating, so "#cats" and "cats" are one tag.
			out.tags = parseTagList(pieces.map((tag) => tag.trim().replace(/^#+/, '')).join(','));
		}
	}

	if (value.playlist !== undefined) {
		if (id === 'youtube') out.playlist = text(value.playlist) ?? '';
		else notes.push(`${def.label} has no playlists.`);
	}

	if (value.schedule !== undefined) {
		const slot = parseSchedule(value.schedule);
		if (!slot) {
			notes.push(`${def.label}: ignored the schedule "${String(value.schedule)}" — it is written "YYYY-MM-DD HH:mm".`);
		} else {
			out.schedule = slot;
			if (slot !== 'now' && new Date(`${slot.date}T${slot.time}`).getTime() < now) {
				notes.push(`${def.label}'s time, ${formatSchedule(slot.date, slot.time)}, has passed — pick another on the Schedule step.`);
			}
		}
	}

	if (out.title && out.title.length > def.titleLimit) {
		notes.push(`${def.label} title is ${out.title.length} characters, over its ${def.titleLimit}.`);
	}
	if (out.description && out.description.length > def.descriptionLimit) {
		notes.push(
			`${def.label} ${def.hasTitle ? 'description' : 'caption'} is ${out.description.length} characters, over its ${def.descriptionLimit}.`
		);
	}
	return out;
}

/**
 * The brand a block names, matched loosely: case, spaces and punctuation
 * aside, so "Owl's Nest" finds a brand called "Owls Nest".
 */
export function matchBrand(brands: Brand[], name: string): Brand | null {
	const wanted = looseBrand(name);
	if (!wanted) return null;
	return (
		brands.find((b) => brandKey(b.name) === brandKey(name)) ??
		brands.find((b) => looseBrand(b.name) === wanted) ??
		null
	);
}

const looseBrand = (value: string) => brandKey(value).replace(/[^\p{L}\p{N}]/gu, '');

/**
 * The brand a name that matched none was most likely meant to be — a typo
 * ("Lanturn" for "Lantern") — for the question that asks which brand a block
 * is for. Only a near miss: at most one edit in four characters, and never a
 * tie between two brands.
 */
export function closestBrand(brands: Brand[], name: string): Brand | null {
	const wanted = looseBrand(name);
	if (!wanted) return null;
	let best: Brand | null = null;
	let bestDistance = Infinity;
	let tied = false;
	for (const brand of brands) {
		const key = looseBrand(brand.name);
		const distance = editDistance(wanted, key);
		if (distance > Math.max(1, Math.floor(Math.max(wanted.length, key.length) / 4))) continue;
		if (distance < bestDistance) {
			best = brand;
			bestDistance = distance;
			tied = false;
		} else if (distance === bestDistance) {
			tied = true;
		}
	}
	return tied ? null : best;
}

/** Levenshtein distance: inserts, deletes and swaps of one character each. */
function editDistance(a: string, b: string): number {
	let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++) {
			current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
		previous = current;
	}
	return previous[b.length];
}

/** "title, description, 14 tags, playlist" — what a platform got, for the notice. */
export function filledSummary(id: PlatformId, entry: PastedPlatform): string {
	const parts: string[] = [];
	if (entry.title !== undefined) parts.push('title');
	if (entry.description !== undefined) parts.push(PLATFORMS[id].hasTitle ? 'description' : 'caption');
	if (entry.tags !== undefined) parts.push(`${entry.tags.length} tag${entry.tags.length === 1 ? '' : 's'}`);
	if (entry.playlist !== undefined) parts.push(entry.playlist ? 'playlist' : 'no playlist');
	if (entry.schedule) parts.push(entry.schedule === 'now' ? 'out on pickup' : formatSchedule(entry.schedule.date, entry.schedule.time));
	return parts.join(', ') || 'ticked, nothing to fill';
}
