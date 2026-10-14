import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	FACEBOOK_SCOPES,
	LEAD_SECONDS,
	SCHEDULE_MAX_MS,
	checkFacebookGrant,
	coverNote,
	facebookAccount,
	reelState,
	releasePlan
} from './facebook.mjs';
import { GraphError, graph } from './instagram.mjs';

const NOW = Date.parse('2026-10-14T12:00:00Z');
const MIN = 60_000;
const at = (ms) => new Date(NOW + ms).toISOString().replace('T', ' ');

describe('releasePlan', () => {
	it('lets Facebook hold a reel whose slot is 10 minutes to 29 days ahead', () => {
		assert.deepEqual(releasePlan(at(60 * MIN), NOW), { state: 'SCHEDULED', publishTime: Math.floor((NOW + 60 * MIN) / 1000) });
		assert.equal(releasePlan(at(11 * MIN), NOW).state, 'SCHEDULED');
		assert.equal(releasePlan(at(SCHEDULE_MAX_MS), NOW).state, 'SCHEDULED');
	});

	it('puts it out at once when the slot is near or past, saying how late', () => {
		assert.deepEqual(releasePlan(at(9 * MIN), NOW), { state: 'PUBLISHED', lateMs: 0 });
		assert.deepEqual(releasePlan(at(-5 * MIN), NOW), { state: 'PUBLISHED', lateMs: 5 * MIN });
		assert.deepEqual(releasePlan('', NOW), { state: 'PUBLISHED', lateMs: 0 });
	});

	it('never puts out at once a reel too far ahead for Facebook to hold', () => {
		assert.deepEqual(releasePlan(at(SCHEDULE_MAX_MS + MIN), NOW), { state: 'TOO_EARLY' });
		assert.ok(LEAD_SECONDS * 1000 < SCHEDULE_MAX_MS, 'the worker takes rows up within reach');
	});
});

describe('reelState', () => {
	const phase = (status, extra = {}) => ({ status, ...extra });

	it('is done once published or held for its time', () => {
		assert.deepEqual(reelState({ video_status: 'ready', publishing_phase: phase('complete', { publish_status: 'published' }) }), {
			state: 'done',
			scheduled: false
		});
		assert.deepEqual(reelState({ publishing_phase: phase('complete', { publish_status: 'scheduled' }) }), {
			state: 'done',
			scheduled: true
		});
	});

	it('is gone when Facebook failed it, with why', () => {
		assert.equal(reelState({ video_status: 'expired' }).state, 'gone');
		const failed = reelState({
			video_status: 'processing',
			processing_phase: phase('error', { errors: [{ message: 'could not be processed' }] })
		});
		assert.deepEqual(failed, { state: 'gone', reason: 'Facebook reports the reel could not be processed' });
	});

	it('reads an upload part-way with its bytes, and one whose finish call never came', () => {
		assert.deepEqual(reelState({ video_status: 'uploading', uploading_phase: phase('in_progress', { bytes_transferred: 1234 }) }), {
			state: 'uploading',
			bytes: 1234
		});
		const inButUnfinished = { video_status: 'upload_complete', uploading_phase: phase('complete'), publishing_phase: phase('not_started') };
		assert.deepEqual(reelState(inButUnfinished, { finished: false }), { state: 'ready' });
		assert.deepEqual(reelState(inButUnfinished), { state: 'processing' });
	});
});

describe('checkFacebookGrant', () => {
	it('stops for a missing required permission and names what an optional one costs', () => {
		const rows = FACEBOOK_SCOPES.filter((s) => s !== 'pages_manage_posts' && s !== 'business_management').map((permission) => ({
			permission,
			status: 'granted'
		}));
		rows.push({ permission: 'pages_manage_posts', status: 'declined' });
		const grant = checkFacebookGrant(rows);
		assert.deepEqual(grant.missing.map((p) => p.name), ['pages_manage_posts']);
		assert.deepEqual(grant.optional.map((p) => p.name), ['business_management']);
	});
});

describe('facebookAccount', () => {
	const config = {
		facebook: {
			apiVersion: 'v23.0',
			accounts: [
				{ pageId: 'p1', pageName: 'Owls Nest', pageAccessToken: 't1' },
				{ pageId: 'p2', pageName: 'Paper Moon', pageAccessToken: 't2' },
				{ pageId: 'p3', pageName: 'No token', pageAccessToken: '' }
			]
		}
	};

	it('gives exactly the Page a post names, labelled for its errors', () => {
		const page = facebookAccount(config, 'p2');
		assert.equal(page.pageAccessToken, 't2');
		assert.equal(page.label, 'Facebook');
		assert.equal(page.apiVersion, 'v23.0');
	});

	it('never guesses between several Pages, nor posts through one without a token', () => {
		assert.throws(() => facebookAccount(config, ''), /names no Facebook account/);
		assert.throws(() => facebookAccount(config, 'p3'), /no credentials/);
	});
});

describe('the reel cover', () => {
	it('goes up as a multipart POST with the file beside the parameters and the token', async () => {
		const realFetch = globalThis.fetch;
		let sent;
		globalThis.fetch = async (url, init) => {
			sent = { url: String(url), init };
			return new Response('{"success":true}', { status: 200 });
		};
		try {
			const page = { pageAccessToken: 'tok', apiVersion: 'v23.0', label: 'Facebook' };
			const image = { bytes: Buffer.from('jpeg bytes'), mimeType: 'image/jpeg', name: 'cover.jpg' };
			const answer = await graph(page, '/v1/thumbnails', {
				method: 'POST',
				params: { is_preferred: 'true' },
				files: { source: image }
			});
			assert.deepEqual(answer, { success: true });
			assert.match(sent.url, /\/v23\.0\/v1\/thumbnails$/);
			const body = sent.init.body;
			assert.ok(body instanceof FormData);
			assert.equal(body.get('is_preferred'), 'true');
			assert.equal(body.get('access_token'), 'tok');
			const file = body.get('source');
			assert.equal(file.name, 'cover.jpg');
			assert.equal(file.type, 'image/jpeg');
			assert.equal(Buffer.from(await file.arrayBuffer()).toString(), 'jpeg bytes');
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	it('says why it was not set, naming the permission Meta lists when one was refused', () => {
		const refused = new GraphError({ code: 200, message: 'Permissions error' }, 403, 'Facebook');
		assert.match(coverNote(refused), /^Cover not set: .*pages_manage_engagement.*Facebook shows a frame it picks\.$/);
		assert.equal(
			coverNote(new Error('Cannot read the stored Facebook cover (404)\nmore')),
			'Cover not set: Cannot read the stored Facebook cover (404). Facebook shows a frame it picks.'
		);
	});
});
