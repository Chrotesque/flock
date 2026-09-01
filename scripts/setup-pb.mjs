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
		name: 'platform_settings',
		type: 'base',
		...RULES,
		fields: [
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
			'CREATE UNIQUE INDEX `idx_platform_settings_platform` ON `platform_settings` (`platform`)'
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
			...stamps
		],
		indexes: ['CREATE INDEX `idx_upload_jobs_status` ON `upload_jobs` (`status`)']
	},
	{
		name: 'upload_targets',
		type: 'base',
		...RULES,
		fields: [
			{ type: 'relation', name: 'job', required: true, maxSelect: 1, cascadeDelete: true },
			{ type: 'text', name: 'platform', required: true, max: 40 },
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
				values: ['pending', 'publishing', 'published', 'failed', 'cancelled']
			},
			{ type: 'text', name: 'remote_url', max: 1000 },
			{ type: 'text', name: 'error', max: 2000 },
			{ type: 'date', name: 'published_at' },
			...stamps
		],
		indexes: [
			'CREATE INDEX `idx_upload_targets_job` ON `upload_targets` (`job`)',
			'CREATE INDEX `idx_upload_targets_due` ON `upload_targets` (`status`, `scheduled_at`)'
		]
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
		// The relation field needs the *id* of its target collection, which only
		// exists once that collection has been created.
		const fields = def.fields.map((f) => {
			if (f.type !== 'relation') return f;
			const target = map.get('upload_jobs');
			if (!target) throw new Error('upload_jobs must be created before upload_targets');
			return { ...f, collectionId: target.id };
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
