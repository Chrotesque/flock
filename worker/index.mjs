#!/usr/bin/env node
// The publishing worker.
//
//   pnpm worker             poll forever
//   pnpm worker:once        one pass, then exit
//   pnpm worker:dry         one pass, reporting what it would do, uploading nothing
//   pnpm worker:vidiq       check the vidIQ key, spending no credits
//   pnpm worker:stats       one stats pass over the channel, then exit
//   pnpm worker:tiktok      show who the TikTok token posts as, then exit
//   pnpm worker:instagram   show who the Instagram token posts as, then exit
//
// Belongs on the NAS beside PocketBase, not in the SPA: it holds the
// platforms' client secrets, and it has to keep running when no browser is
// open.

import { requireConfig, hasTikTok, hasInstagram } from './config.mjs';
import { makeClient } from './pb.mjs';
import { publishToYouTube } from './youtube.mjs';
import { publishToTikTok, refreshTikTokCreator, creatorInfo, privacyLabel } from './tiktok.mjs';
import {
	publishToInstagram,
	refreshInstagramAccount,
	accountInfo,
	setCoverServer
} from './instagram.mjs';
import { copyToDestination, copyInto } from './archive.mjs';
import { scanWatchFolder, scanLocalFolders } from './watch.mjs';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { resolveFolder } from './paths.mjs';
import { pickFolder } from './folderpick.mjs';
import { scoreTitle, generateTitles, listTools } from './vidiq.mjs';
import { statsPass, unitsToday } from './stats.mjs';
import { msUntil } from './upload.mjs';
import { startPreviewServer } from './preview.mjs';
import { startCoverServer } from './covers.mjs';

/**
 * One entry per platform that can actually publish, and how it is timed.
 *
 * `now` platforms take the release time themselves, so their rows are picked
 * up the moment they exist and the platform releases at the slot. `slot`
 * platforms cannot, so the worker holds each row and starts only when the
 * slot comes — less `lead` seconds, for one that needs a head start to be
 * ready on the minute. Facebook has no entry and its rows are left alone.
 * A platform whose credentials are missing is skipped with a notice rather
 * than failed: its rows wait in the queue for the day it is set up.
 */
const ADAPTERS = {
	youtube: {
		publish: publishToYouTube,
		timing: 'now',
		lead: () => 0,
		ready: (config) => Boolean(config.google.refreshToken),
		setup: 'pnpm worker:auth'
	},
	tiktok: {
		publish: publishToTikTok,
		timing: 'slot',
		lead: () => 0,
		ready: hasTikTok,
		setup: 'pnpm worker:auth --tiktok'
	},
	instagram: {
		publish: publishToInstagram,
		timing: 'slot',
		lead: (config) => Math.max(0, Number(config.instagramLeadSeconds) || 0),
		ready: hasInstagram,
		setup: 'pnpm worker:auth --instagram'
	}
};

const once = process.argv.includes('--once');
const dry = process.argv.includes('--dry');
const checkVidiq = process.argv.includes('--vidiq');
const statsOnly = process.argv.includes('--stats');
const checkTikTok = process.argv.includes('--tiktok');
const checkInstagram = process.argv.includes('--instagram');

function stamp() {
	return new Date().toLocaleTimeString();
}

function log(message) {
	console.log(`[${stamp()}] ${message}`);
}

/** "in 12 min", "in 3h 05m" — for the dry run's account of a held row. */
function inWords(ms) {
	const minutes = Math.round(ms / 60000);
	if (minutes < 60) return `in ${minutes} min`;
	const hours = Math.floor(minutes / 60);
	return `in ${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** Targets already reported as waiting on an import, so that is said once. */
const waitingImport = new Set();

async function handle(pb, config, platform, target) {
	const adapter = ADAPTERS[platform];
	const label = `${platform} "${target.title || target.description?.slice(0, 40) || target.id}"`;

	if (dry) {
		if (adapter.timing === 'slot') {
			const wait = msUntil(target.scheduled_at) - adapter.lead(config) * 1000;
			log(
				wait > 0
					? `would hold ${label} until ${target.scheduled_at} (${inWords(wait)})`
					: `would publish ${label} now — slot ${target.scheduled_at}`
			);
		} else {
			log(`would publish ${label}, scheduled ${target.scheduled_at}`);
		}
		return;
	}

	// A local pick is not on the NAS until importPass has copied it; the row
	// stays pending until then, whatever its slot says.
	const job = await pb.getJob(target.job);
	if (job.source_local) {
		if (!waitingImport.has(target.id)) log(`holding ${label}: its video is still being copied to the NAS`);
		waitingImport.add(target.id);
		return;
	}
	waitingImport.delete(target.id);

	// Claim before starting, so a second pass cannot pick up the same row while
	// its upload is in flight.
	await pb.updateTarget(target.id, { status: 'publishing', error: '' });
	log(`claimed ${label}`);

	try {
		const result = await adapter.publish({
			target,
			job,
			pb,
			config,
			log: (message) => log(`  ${message}`)
		});

		await pb.updateTarget(target.id, {
			status: result.scheduled ? 'scheduled' : 'published',
			remote_url: result.url,
			error: result.locked ? 'Stored as private: the API project is not audited yet.' : '',
			...(result.scheduled ? {} : { published_at: new Date().toISOString() })
		});

		const how = result.scheduled ? `scheduled for ${target.scheduled_at}` : `live as ${result.privacyStatus}`;
		log(`done ${label} — ${how}  ${result.url}`);
		pb.log(`Published to ${platform}`, `${target.title || '(no title)'} -> ${result.url} (${how})`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await pb.updateTarget(target.id, { status: 'failed', error: message.slice(0, 1900) });
		log(`FAILED ${label}: ${message}`);
		pb.log(`Failed to publish to ${platform}`, `${target.title || '(no title)'}: ${message}`);
	}
}

/**
 * Files finished videos into their NAS destination.
 *
 * Deliberately separate from publishing: the destination is somewhere to keep
 * the video, not a platform, so this runs for every job that asks for one —
 * including jobs going only to platforms that have no adapter yet.
 */
async function copyPass(pb) {
	const jobs = await pb.pendingCopies();
	if (jobs.length === 0) return;
	log(`${jobs.length} to copy to their NAS destination`);

	for (const job of jobs) {
		if (dry) {
			log(`would copy "${job.title}" -> ${job.destination_path}`);
			continue;
		}
		try {
			const result = await copyToDestination({ job, pb, log: (m) => log(`  ${m}`) });
			await pb.updateJob(job.id, { status: 'done', error: '' });
			log(`copied "${job.title}" -> ${result.path}`);
			pb.log(
				'Copied to the NAS',
				`${job.title || '(untitled)'} -> ${result.path}` +
					(result.renamed ? ' (renamed: a file of that name was already there)' : '')
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			// Left `stored` on purpose so the next pass retries — an unreachable
			// share is usually temporary, and the video is safe in PocketBase.
			await pb.updateJob(job.id, { error: message.slice(0, 1900) });
			log(`copy FAILED for "${job.title}": ${message}`);
		}
	}
}

/**
 * The latest listing of each list, by path: what the preview server may
 * stream. Replaced wholesale on every scan, so a file that has left a folder
 * stops being playable at the same moment it stops being listed.
 */
const listed = { nas: new Map(), local: new Map() };

function byPath(files) {
	return new Map(files.map((file) => [file.path, file]));
}

/**
 * Publishes what is sitting in the watch folder so the compose screen can list
 * it. The folder is configured in the SPA, so it is read back out of settings
 * each pass rather than duplicated into the worker's own config.
 */
async function watchPass(pb) {
	const row = await pb.getSetting('general');
	const folder = row?.value?.watchFolder?.trim() ?? '';
	// Swapped in once the scan is done, not emptied before it: a slow share
	// would otherwise cut off every preview for as long as the scan takes.
	let nas = new Map();
	if (folder) {
		const index = await scanWatchFolder(folder);
		if (index) {
			await pb.setSetting('watch_index', index);
			if (!index.error) nas = byPath(index.files);
			if (index.error) log(`watch folder: ${index.error}`);
			else log(`watch folder: ${index.files.length} video(s) in ${index.folder}`);
		}
	}
	listed.nas = nas;

	// The local folders, pooled into one listing for the "Locally" box. Read
	// from this machine's disks, which is why they only work while the worker
	// runs on the PC they belong to.
	const locals = Array.isArray(row?.value?.localFolders)
		? row.value.localFolders.map((f) => f?.path ?? '').filter((p) => p.trim())
		: [];
	let local = new Map();
	if (locals.length > 0) {
		const index = await scanLocalFolders(locals);
		await pb.setSetting('local_index', index);
		local = byPath(index.files);
		for (const entry of index.folders) if (entry.error) log(`local folder: ${entry.error}`);
		log(`local folders: ${index.files.length} video(s) in ${locals.length} folder(s)`);
	}
	listed.local = local;
}

/**
 * Copies videos picked from a local folder into the NAS watch folder, then
 * points the job at the copy. Until that happens nothing publishes from the
 * job and nothing is filed into its destination — see `handle` and
 * `pendingCopies`. The local original is left alone.
 */
async function importPass(pb) {
	const jobs = await pb.pendingImports();
	if (jobs.length === 0) return;

	const row = await pb.getSetting('general');
	const watch = row?.value?.watchFolder?.trim() ?? '';

	for (const job of jobs) {
		if (dry) {
			log(`would copy local ${job.source_path} into the watch folder`);
			continue;
		}
		try {
			if (!watch) throw new Error('No NAS watch folder is set to copy local videos into.');
			const from = job.source_path;
			let info;
			try {
				info = await stat(from);
			} catch (err) {
				throw new Error(`Local video is gone: ${from} (${err.code || err.message})`);
			}
			const result = await copyInto({
				source: { stream: createReadStream(from), size: info.size },
				dir: await resolveFolder(watch),
				wanted: job.video_name || basename(from),
				log: (m) => log(`  ${m}`)
			});
			await pb.updateJob(job.id, {
				source_path: result.path,
				source_origin: from,
				source_local: false,
				error: ''
			});
			log(`imported "${job.title}" -> ${result.path}`);
			pb.log('Copied a local video to the NAS', `${from} -> ${result.path}`);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			// Left marked local so the next pass retries.
			await pb.updateJob(job.id, { error: message.slice(0, 1900) });
			log(`import FAILED for "${job.title}": ${message}`);
		}
	}
}

/**
 * Answers scoring requests from the compose screen.
 *
 * Runs on its own, much faster tick than everything else: somebody is watching
 * a button spin here, where nobody watches an upload queue. A missing key is
 * reported onto the row rather than logged and forgotten, so the interface can
 * say why nothing came back.
 */
async function scorePass(pb, config) {
	const requests = await pb.pendingScores();
	if (requests.length === 0) return;

	for (const row of requests) {
		if (!config.vidiqKey) {
			await pb.updateScore(row.id, {
				status: 'failed',
				error: 'No vidIQ key configured. Add vidiqKey to the worker config.'
			});
			continue;
		}

		try {
			if (row.kind === 'titles') {
				// `context` carries the description, and `result` the previous titles
				// the SPA pulled from its own upload history.
				const previous = Array.isArray(row.result) ? row.result : [];
				const titles = await generateTitles(config.vidiqKey, {
					title: row.text,
					description: row.context || '',
					format: row.format,
					previousTitles: previous
				});
				await pb.updateScore(row.id, { status: 'done', result: titles, error: '' });
				log(`suggested ${titles.length} titles from "${row.text.slice(0, 40)}"`);
				continue;
			}

			const score = await scoreTitle(config.vidiqKey, {
				title: row.text,
				format: row.format,
				channelId: row.channel || undefined
			});
			await pb.updateScore(row.id, { status: 'done', score, error: '' });
			log(`scored "${row.text.slice(0, 50)}" -> ${score}`);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			await pb.updateScore(row.id, { status: 'failed', error: message.slice(0, 1900) });
			log(`score failed for "${row.text.slice(0, 40)}": ${message}`);
		}
	}
}

/**
 * Answers Settings' "Add folder…" by opening the Windows folder dialog here,
 * on the worker's own desktop, and writing the chosen path back to
 * `app_settings` / `folder_pick`. One request at a time; it rides on the
 * scoring tick because somebody is waiting on it just the same.
 *
 * A request left pending while the worker was off is not honoured when it
 * starts: a dialog springing up minutes after anyone asked for it would only
 * confuse.
 */
let picking = false;
const PICK_MAX_AGE_MS = 2 * 60_000;

async function folderPickPass(pb) {
	if (picking || dry) return;
	const row = await pb.getSetting('folder_pick');
	const ask = row?.value;
	if (!ask || ask.status !== 'pending' || !ask.id) return;
	if (Date.now() - new Date(ask.requestedAt).getTime() > PICK_MAX_AGE_MS) {
		await pb.setSetting('folder_pick', { ...ask, status: 'expired' });
		return;
	}

	picking = true;
	try {
		await pb.setSetting('folder_pick', { ...ask, status: 'open' });
		log('folder dialog opened for Settings');
		const path = await pickFolder();
		await pb.setSetting('folder_pick', { ...ask, status: path ? 'done' : 'cancelled', path: path ?? '' });
		log(path ? `folder chosen: ${path}` : 'folder dialog cancelled');
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await pb.setSetting('folder_pick', { ...ask, status: 'failed', error: message.slice(0, 1000) });
		log(`folder dialog failed: ${message}`);
	} finally {
		picking = false;
	}
}

const noticed = new Map();

/**
 * Says, once an hour, that rows are waiting for a platform this worker has no
 * credentials for. They are left `pending` on purpose — the queue is the
 * right place for them until the platform's consent flow has been run.
 */
async function noteUnready(pb, platform) {
	if (Date.now() - (noticed.get(platform) ?? 0) < 60 * 60_000) return;
	const waiting = await pb.pendingTargets(platform);
	if (waiting.length === 0) return;
	noticed.set(platform, Date.now());
	log(
		`${waiting.length} pending for ${platform}, which is not set up here — ` +
			`run ${ADAPTERS[platform].setup}. Left in the queue.`
	);
}

async function pass(pb, config) {
	await watchPass(pb);
	await importPass(pb);
	await copyPass(pb);

	for (const [platform, adapter] of Object.entries(ADAPTERS)) {
		if (!dry && !adapter.ready(config)) {
			await noteUnready(pb, platform);
			continue;
		}
		if (adapter.timing !== 'now') continue;
		const targets = await pb.pendingTargets(platform);
		if (targets.length === 0) continue;
		log(`${targets.length} pending for ${platform}`);
		for (const target of targets) {
			await handle(pb, config, platform, target);
		}
	}
}

const busy = new Set();

/**
 * The hold-and-fire platforms, on their own tick.
 *
 * Their rows become due at a particular minute, and the main loop can be held
 * for many minutes by one YouTube upload, so they are checked apart from it.
 * Each platform works one row at a time; a platform still busy with an upload
 * is skipped until it is free, so a second row for it waits while a row for
 * the other platform does not. A dry run lists every pending row, due or not.
 */
async function slotPass(pb, config, { wait = false } = {}) {
	const running = [];
	for (const [platform, adapter] of Object.entries(ADAPTERS)) {
		if (adapter.timing !== 'slot') continue;
		if (!dry && !adapter.ready(config)) continue;
		if (busy.has(platform)) continue;
		busy.add(platform);

		const work = (async () => {
			try {
				const dueBy = dry ? null : new Date(Date.now() + adapter.lead(config) * 1000);
				const targets = await pb.pendingTargets(platform, dueBy);
				if (targets.length === 0) return;
				log(`${targets.length} ${dry ? 'pending' : 'due'} for ${platform}`);
				for (const target of targets) {
					await handle(pb, config, platform, target);
				}
			} catch (err) {
				log(`${platform} pass failed: ${err instanceof Error ? err.message : err}`);
			} finally {
				busy.delete(platform);
			}
		})();
		running.push(work);
	}
	if (wait) await Promise.all(running);
}

/** The account details the compose screen shows, each on its own timer. */
async function accountPass(pb, config) {
	if (hasTikTok(config)) {
		await refreshTikTokCreator(pb, config, log).catch((err) => log(`tiktok: ${err.message}`));
	}
	if (hasInstagram(config)) {
		await refreshInstagramAccount(pb, config, log).catch((err) => log(`instagram: ${err.message}`));
	}
}

/**
 * Rows left `publishing` by a crash would otherwise sit there forever, since
 * nothing polls that state. Safe only at startup, when by definition no upload
 * of ours is in flight — which is also why this assumes a single worker.
 */
async function recoverStale(pb) {
	for (const platform of Object.keys(ADAPTERS)) {
		const stale = await pb.stalePublishing(platform);
		for (const row of stale) {
			await pb.updateTarget(row.id, {
				status: 'pending',
				error: 'Worker restarted mid-upload; queued again.'
			});
			log(`recovered ${platform} ${row.id} from a previous run`);
		}
	}
}

/** Who the TikTok and Instagram tokens post as — the check that a setup worked. */
async function showAccounts(config) {
	if (checkTikTok) {
		if (!hasTikTok(config)) throw new Error('TikTok is not set up. Run:  pnpm worker:auth --tiktok');
		const creator = await creatorInfo(config);
		log(`TikTok posts as ${creator.nickname} (@${creator.username})`);
		log(`audiences offered: ${creator.privacyOptions.map(privacyLabel).join(', ') || 'none reported'}`);
		log(
			`comments ${creator.commentDisabled ? 'off' : 'on'}, duet ${creator.duetDisabled ? 'off' : 'on'}, ` +
				`stitch ${creator.stitchDisabled ? 'off' : 'on'}; videos up to ${creator.maxDurationSeconds || '?'}s`
		);
	}
	if (checkInstagram) {
		if (!hasInstagram(config)) {
			throw new Error('Instagram is not set up. Run:  pnpm worker:auth --instagram');
		}
		const account = await accountInfo(config);
		log(`Instagram posts as @${account.username} (${account.accountType || 'type unknown'}, id ${account.userId})`);
		if (account.quotaTotal) log(`${account.quotaUsed} of ${account.quotaTotal} posts used in the last 24 hours`);
		log(`token good until ${config.instagram.tokenExpiresAt || 'unknown'}`);
	}
}

async function main() {
	// The vidIQ check needs neither PocketBase nor Google — it exists to answer
	// whether the key is any good before anything else is set up.
	if (checkVidiq) {
		const { vidiqKey } = requireConfig({ needToken: false, needGoogle: false });
		if (!vidiqKey) throw new Error('No vidiqKey in the worker config.');
		const tools = await listTools(vidiqKey);
		log(`vidIQ key works — ${tools.length} tools available`);
		log(`scoring tool present: ${tools.includes('vidiq_score_title')}`);
		return;
	}
	// Likewise for the other two platforms' checks.
	if (checkTikTok || checkInstagram) {
		await showAccounts(requireConfig({ needToken: false, needGoogle: false }));
		return;
	}

	const config = requireConfig({ needToken: !dry, needGoogle: !dry });
	const pb = makeClient(config.pocketbaseUrl);

	// Started at boot, or straight after a resume, the NAS or the Tailscale link
	// to it may not be up yet. Waiting beats dying on the first probe; the
	// one-shot modes fail fast, since there somebody is watching.
	for (let attempt = 1; ; attempt++) {
		try {
			await pb.health();
			break;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (once || dry || statsOnly || attempt >= 30) throw err;
			log(`${message} — retrying in 10s (${attempt}/30)`);
			await new Promise((resolve) => setTimeout(resolve, 10_000));
		}
	}
	log(`PocketBase ok at ${config.pocketbaseUrl}`);
	log(
		'adapters: ' +
			Object.entries(ADAPTERS)
				.map(([platform, adapter]) => (adapter.ready(config) ? platform : `${platform} (not set up)`))
				.join(', ')
	);

	// Reads only, so it goes before the stale-row recovery: a stats check must
	// not touch the publishing queue.
	if (statsOnly) {
		await statsPass({ pb, config, log });
		log(`stats pass complete — ${unitsToday()} unit(s) spent`);
		return;
	}

	if (!dry) await recoverStale(pb);

	// Instagram fetches a custom reel cover from a public address — see
	// covers.mjs. Started before the passes so a one-shot run can serve one
	// too; without a public base configured, covers fall back to the frame at
	// the cover time and the adapter says so in the log.
	if (!dry && config.instagram.coverPublicBase && config.coverPort > 0) {
		const covers = startCoverServer({
			port: config.coverPort,
			publicBase: config.instagram.coverPublicBase,
			log,
			onListening: (port) => log(`covers: served to Instagram from ${covers.base} (port ${port})`)
		});
		setCoverServer(covers);
	}

	if (once || dry) {
		await scorePass(pb, config);
		if (!dry && config.statsSeconds > 0) await statsPass({ pb, config, log });
		if (!dry) await accountPass(pb, config);
		await pass(pb, config);
		await slotPass(pb, config, { wait: true });
		log('single pass complete');
		return;
	}

	log(
		`polling every ${config.pollSeconds}s, slots every ${config.slotSeconds}s, ` +
			`scoring every ${config.scoreSeconds}s — ctrl-c to stop`
	);

	// The Upload step's player — see preview.mjs. Only for a worker that stays
	// up; the address is published where the page looks for it, and left there
	// when the worker stops, so the page checks it answers before using it.
	if (config.previewPort > 0) {
		startPreviewServer({
			port: config.previewPort,
			lookup: (source, path) =>
				source === 'nas' || source === 'local' ? (listed[source].get(path) ?? null) : null,
			log,
			onListening: (port) => {
				const url = config.previewUrl || `http://127.0.0.1:${port}`;
				log(`preview: listed videos play from ${url}`);
				pb.setSetting('preview_server', { url, startedAt: new Date().toISOString() }).catch((err) =>
					log(`preview: could not publish its address: ${err.message}`)
				);
			}
		});
	}

	// Same reason as scoring: an upload can hold the main loop for many
	// minutes, and the Analytics screen should not go stale for the duration.
	// `busy` stops a slow poll overlapping the next tick.
	if (config.statsSeconds > 0) {
		log(
			`stats: newest ${config.statsVideos} videos every ${config.statsSeconds}s, ` +
				`up to ${config.statsBudget} units a day`
		);
		let statsBusy = false;
		const tick = async () => {
			if (statsBusy) return;
			statsBusy = true;
			try {
				await statsPass({ pb, config, log });
			} catch (err) {
				log(`stats pass failed: ${err.message}`);
			} finally {
				statsBusy = false;
			}
		};
		void tick();
		setInterval(() => void tick(), Math.max(5, config.statsSeconds) * 1000);
	}

	// Its own interval rather than a counter inside the main loop: an upload can
	// hold that loop for many minutes, and a score request must not queue behind
	// one.
	setInterval(() => {
		void scorePass(pb, config).catch((err) => log(`score pass failed: ${err.message}`));
		void folderPickPass(pb).catch((err) => log(`folder pick failed: ${err.message}`));
	}, Math.max(1, config.scoreSeconds) * 1000);

	// The hold-and-fire platforms, on their own tighter tick — see slotPass.
	// The account refreshes ride on it too; each keeps its own half-hour timer.
	const slotTick = () => {
		void accountPass(pb, config);
		void slotPass(pb, config);
	};
	slotTick();
	setInterval(slotTick, Math.max(5, config.slotSeconds) * 1000);

	for (;;) {
		try {
			await pass(pb, config);
		} catch (err) {
			// A transient PocketBase blip must not end the process; the next tick
			// picks up wherever it left off.
			log(`pass failed: ${err instanceof Error ? err.message : err}`);
		}
		await new Promise((resolve) => setTimeout(resolve, config.pollSeconds * 1000));
	}
}

main().catch((err) => {
	console.error(`\n${err instanceof Error ? err.message : err}\n`);
	process.exit(1);
});
