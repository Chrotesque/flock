// Idempotent schema bootstrap for flock's PocketBase instance.
//
//   node scripts/runpb.mjs setup-pb.mjs
//
// Safe to re-run: existing collections are patched to match, never dropped.
// Seed *rows* are not created here - the app seeds platform_settings itself
// from src/lib/platforms.ts so the defaults live in exactly one place.

import { api } from './pb-api.mjs';

const OPEN = ''; // '' = open to anyone; null = superuser only.
// flock is local, single-user and unauthenticated, so every rule is open.
const RULES = {
	listRule: OPEN,
	viewRule: OPEN,
	createRule: OPEN,
	updateRule: OPEN,
	deleteRule: OPEN
};

const stamps = [
	{ type: 'autodate', name: 'created', onCreate: true },
	{ type: 'autodate', name: 'updated', onCreate: true, onUpdate: true }
];

const collections = [
	{
		// A brand is a set of accounts, one per platform, with its own copy of
		// every per-platform setting and its own templates. Declared first:
		// platform_settings and upload_jobs both point at it.
		name: 'brands',
		type: 'base',
		...RULES,
		fields: [
			{ type: 'text', name: 'name', required: true, max: 120 },
			// Lower-cased form, so "Acme" and "acme" collide — the same trick
			// as devices.key, and for the same reason: an index, not a check.
			{ type: 'text', name: 'key', required: true, max: 120 },
			{ type: 'number', name: 'sort_order' },
			// Which account the brand posts as on each platform:
			// { instagram: "<account_id>", youtube: "<account_id>", ... }, ids
			// from `accounts`. A platform left out has none.
			{ type: 'json', name: 'accounts', maxSize: 20000 },
			...stamps
		],
		indexes: ['CREATE UNIQUE INDEX `idx_brands_key` ON `brands` (`key`)']
	},
	{
		// The accounts the worker can post as, as it last read them — the public
		// half only: the platform's own id, handle and name, plus whatever the
		// compose screen needs (`details`: TikTok's audiences, Instagram's daily
		// allowance). Tokens never come here; they live in the worker config.
		// Written only by the worker.
		name: 'accounts',
		type: 'base',
		...RULES,
		fields: [
			{ type: 'text', name: 'platform', required: true, max: 40 },
			{ type: 'text', name: 'account_id', required: true, max: 120 },
			{ type: 'text', name: 'handle', max: 200 },
			{ type: 'text', name: 'name', max: 200 },
			{ type: 'json', name: 'details', maxSize: 50000 },
			{ type: 'text', name: 'error', max: 2000 },
			{ type: 'date', name: 'fetched_at' },
			...stamps
		],
		indexes: [
			'CREATE UNIQUE INDEX `idx_accounts_platform_id` ON `accounts` (`platform`, `account_id`)'
		]
	},
	{
		name: 'platform_settings',
		type: 'base',
		...RULES,
		fields: [
			// Deleting a brand takes its settings with it.
			{
				type: 'relation',
				name: 'brand',
				collection: 'brands',
				maxSelect: 1,
				cascadeDelete: true
			},
			{ type: 'text', name: 'platform', required: true, max: 40 },
			{ type: 'bool', name: 'enabled' },
			{ type: 'number', name: 'sort_order' },
			// Per-platform publish defaults. Deliberately schemaless: the real
			// option sets are unknown until the platform APIs are wired up.
			{ type: 'json', name: 'defaults', maxSize: 200000 },
			// [{ id, find, replace, target, mode, enabled }]
			{ type: 'json', name: 'filters', maxSize: 200000 },
			// { mode, defaultTime, profiles: [{ id, name, useTime, time, useDays, days }] }
			{ type: 'json', name: 'scheduling', maxSize: 200000 },
			...stamps
		],
		indexes: [
			'CREATE UNIQUE INDEX `idx_platform_settings_brand_platform` ON `platform_settings` (`brand`, `platform`)'
		]
	},
	{
		name: 'upload_jobs',
		type: 'base',
		...RULES,
		fields: [
			{ type: 'text', name: 'title', max: 500 },
			{ type: 'text', name: 'description', max: 20000 },
			// The video itself, parked on the NAS so publishing no longer needs
			// this PC to be online.
			{ type: 'file', name: 'video', maxSelect: 1, maxSize: 5368709120 },
			// A custom thumbnail for YouTube. The 2 MB cap is YouTube's own for
			// thumbnails.set, so anything that fits here can be set there.
			{
				type: 'file',
				name: 'thumbnail',
				maxSelect: 1,
				maxSize: 2097152,
				mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
			},
			// A custom cover for the Instagram reel, portrait where the thumbnail
			// is landscape. The 8 MB cap is Instagram's own for cover images.
			{
				type: 'file',
				name: 'cover',
				maxSelect: 1,
				maxSize: 8388608,
				mimeTypes: ['image/jpeg', 'image/png']
			},
			// Set instead of `video` for a file picked out of the watch folder:
			// the bytes are left on the NAS and only referenced, which is what
			// makes a video larger than the file field's 5 GiB cap possible.
			{ type: 'text', name: 'source_path', max: 1000 },
			// A file picked from a local folder on the worker's machine. The
			// worker first copies it into the NAS watch folder, then points
			// source_path there, clears this and keeps the old path in
			// source_origin. Nothing publishes from the job while this is set.
			{ type: 'bool', name: 'source_local' },
			{ type: 'text', name: 'source_origin', max: 1000 },
			{ type: 'text', name: 'video_name', max: 500 },
			// Where on the NAS this video should end up. Recorded per job rather
			// than read from settings at publish time, so changing the configured
			// destinations later cannot relocate videos already queued.
			{ type: 'text', name: 'destination_label', max: 200 },
			{ type: 'text', name: 'destination_path', max: 1000 },
			{ type: 'number', name: 'video_size' },
			{ type: 'number', name: 'video_duration' },
			{
				type: 'select',
				name: 'status',
				maxSelect: 1,
				values: ['draft', 'uploading', 'stored', 'publishing', 'done', 'failed']
			},
			{ type: 'text', name: 'error', max: 2000 },
			// The brand the upload was made for. Not cascading: deleting a brand
			// must not delete its history, so the relation empties and the name
			// snapshot below is what the job keeps.
			{ type: 'relation', name: 'brand', collection: 'brands', maxSelect: 1, cascadeDelete: false },
			{ type: 'text', name: 'brand_name', max: 120 },
			...stamps
		],
		indexes: [
			'CREATE INDEX `idx_upload_jobs_status` ON `upload_jobs` (`status`)',
			'CREATE INDEX `idx_upload_jobs_brand` ON `upload_jobs` (`brand`)'
		]
	},
	{
		name: 'upload_targets',
		type: 'base',
		...RULES,
		fields: [
			{
				type: 'relation',
				name: 'job',
				collection: 'upload_jobs',
				required: true,
				maxSelect: 1,
				cascadeDelete: true
			},
			{ type: 'text', name: 'platform', required: true, max: 40 },
			// The `accounts` id this post goes out as, chosen by its brand. The
			// worker publishes through exactly that account or refuses; empty means
			// the platform's only account (a single-brand install).
			{ type: 'text', name: 'account', max: 120 },
			// Title/description are stored *post-filter*, per platform, so the
			// worker never has to re-run the adaptation rules.
			{ type: 'text', name: 'title', max: 500 },
			{ type: 'text', name: 'description', max: 20000 },
			{ type: 'json', name: 'options', maxSize: 200000 },
			{ type: 'date', name: 'scheduled_at' },
			{
				type: 'select',
				name: 'status',
				maxSelect: 1,
				values: ['pending', 'publishing', 'scheduled', 'published', 'failed', 'cancelled']
			},
			{ type: 'text', name: 'remote_url', max: 1000 },
			{ type: 'text', name: 'error', max: 2000 },
			{ type: 'date', name: 'published_at' },
			// Which worker run claimed the row, and the platform's own handle on
			// the upload once there is one — what a worker taking over asks the
			// platform about before uploading again (worker/orphans.mjs).
			{ type: 'json', name: 'handle', maxSize: 20000 },
			...stamps
		],
		indexes: [
			'CREATE INDEX `idx_upload_targets_job` ON `upload_targets` (`job`)',
			'CREATE INDEX `idx_upload_targets_due` ON `upload_targets` (`status`, `scheduled_at`)'
		]
	},
	{
		// Scoring asks the SPA cannot make itself: vidIQ has no REST API, only an
		// MCP server, and its key is a credential — so the browser writes the
		// request here and the worker answers it. Kept as rows rather than a
		// single slot so the history of what scored what survives.
		name: 'score_requests',
		type: 'base',
		...RULES,
		fields: [
			{ type: 'text', name: 'kind', required: true, max: 40 },
			{ type: 'text', name: 'text', required: true, max: 500 },
			{ type: 'text', name: 'platform', max: 40 },
			{ type: 'text', name: 'channel', max: 60 },
			{ type: 'text', name: 'format', max: 20 },
			{
				type: 'select',
				name: 'status',
				maxSelect: 1,
				values: ['pending', 'done', 'failed']
			},
			{ type: 'number', name: 'score' },
			// Suggestions come back as a list of scored titles, where a plain score
			// is one number — so the richer answers land here.
			{ type: 'json', name: 'result', maxSize: 200000 },
			{ type: 'text', name: 'context', max: 5000 },
			{ type: 'text', name: 'error', max: 2000 },
			...stamps
		],
		indexes: ['CREATE INDEX `idx_score_requests_status` ON `score_requests` (`status`)']
	},
	{
		// The newest videos on the channel as the worker last read them, one row
		// per video and keyed by YouTube's id rather than by anything of flock's:
		// most of the channel was never published through here. `data` is the
		// whole videos.list item, and `history` the counters each time they
		// moved, so the screen can draw a curve without a second collection.
		name: 'video_stats',
		type: 'base',
		...RULES,
		fields: [
			{ type: 'text', name: 'video_id', required: true, max: 40 },
			{ type: 'text', name: 'title', max: 500 },
			{ type: 'date', name: 'published_at' },
			{ type: 'text', name: 'privacy', max: 20 },
			{ type: 'number', name: 'duration' },
			{ type: 'number', name: 'views' },
			{ type: 'number', name: 'likes' },
			{ type: 'number', name: 'comments' },
			{ type: 'json', name: 'data', maxSize: 500000 },
			// [[iso, views, likes, comments], ...], appended only when one moved.
			{ type: 'json', name: 'history', maxSize: 500000 },
			{ type: 'date', name: 'fetched_at' },
			...stamps
		],
		indexes: ['CREATE UNIQUE INDEX `idx_video_stats_video` ON `video_stats` (`video_id`)']
	},
	{
		// Claimed device names. A browser writes one row here when it is named;
		// the unique index on `key` is what actually prevents two machines
		// sharing a name, since a check-then-write would race.
		name: 'devices',
		type: 'base',
		...RULES,
		fields: [
			{ type: 'text', name: 'name', required: true, max: 120 },
			// Lower-cased form, so "Studio PC" and "studio pc" collide.
			{ type: 'text', name: 'key', required: true, max: 120 },
			...stamps
		],
		indexes: ['CREATE UNIQUE INDEX `idx_devices_key` ON `devices` (`key`)']
	},
	{
		name: 'activity_log',
		type: 'base',
		...RULES,
		fields: [
			{
				type: 'select',
				name: 'category',
				maxSelect: 1,
				values: ['upload', 'calendar', 'settings']
			},
			{ type: 'text', name: 'action', required: true, max: 200 },
			{ type: 'text', name: 'detail', max: 2000 },
			// Browsers cannot read the OS hostname, so this is the name the user
			// gave this browser (stored per-device in localStorage).
			{ type: 'text', name: 'device', max: 120 },
			...stamps
		],
		indexes: [
			'CREATE INDEX `idx_activity_log_created` ON `activity_log` (`created`)',
			'CREATE INDEX `idx_activity_log_category` ON `activity_log` (`category`)'
		]
	},
	{
		// The worker's console, line by line, for the Log screen's Worker tab.
		// Written only by the worker; pruned by it after 14 days, because unlike
		// activity_log this is diagnostics rather than an audit trail.
		name: 'worker_log',
		type: 'base',
		...RULES,
		fields: [
			{ type: 'text', name: 'message', required: true, max: 2000 },
			// One random id per worker start, to tell runs apart.
			{ type: 'text', name: 'run', max: 20 },
			...stamps
		],
		indexes: ['CREATE INDEX `idx_worker_log_created` ON `worker_log` (`created`)']
	},
	{
		name: 'app_settings',
		type: 'base',
		...RULES,
		fields: [
			{ type: 'text', name: 'key', required: true, max: 100 },
			{ type: 'json', name: 'value', maxSize: 200000 },
			...stamps
		],
		indexes: ['CREATE UNIQUE INDEX `idx_app_settings_key` ON `app_settings` (`key`)']
	}
];

async function existing() {
	const res = await api('/api/collections?perPage=200');
	return new Map(res.items.map((c) => [c.name, c]));
}

async function run() {
	let map = await existing();

	for (const def of collections) {
		// A relation field needs the *id* of its target collection, which only
		// exists once that collection has been created — hence the order of the
		// list above. `collection` names it here and is not sent to PocketBase.
		const fields = def.fields.map((f) => {
			if (f.type !== 'relation') return f;
			const { collection, ...rest } = f;
			const target = map.get(collection);
			if (!target) throw new Error(`${collection} must be declared before ${def.name}`);
			return { ...rest, collectionId: target.id };
		});

		const payload = { ...def, fields };
		const current = map.get(def.name);

		if (!current) {
			const created = await api('/api/collections', {
				method: 'POST',
				body: JSON.stringify(payload)
			});
			map.set(created.name, created);
			console.log(`created  ${def.name}`);
		} else {
			// Preserve field ids so PATCH updates columns instead of dropping and
			// recreating them (which would discard the data in them).
			const byName = new Map(current.fields.map((f) => [f.name, f]));
			payload.fields = fields.map((f) => {
				const prev = byName.get(f.name);
				return prev ? { ...f, id: prev.id } : f;
			});
			const updated = await api(`/api/collections/${current.id}`, {
				method: 'PATCH',
				body: JSON.stringify(payload)
			});
			map.set(updated.name, updated);
			console.log(`updated  ${def.name}`);
		}
	}

	console.log('\nSchema is up to date.');
}

run().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
