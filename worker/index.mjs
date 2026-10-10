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
// Belongs beside PocketBase, not in the SPA: it holds the platforms' client
// secrets, and it has to keep running when no browser is open. Its `role`
// (roles.mjs) splits the work between a NAS and a PC worker; the default,
// `all`, does everything.

import { requireConfig, hasTikTok, hasInstagram } from './config.mjs';
import { makeClient } from './pb.mjs';
import { publishToYouTube, probeYouTube } from './youtube.mjs';
import { publishToTikTok, probeTikTok, refreshTikTokCreator, creatorInfo, privacyLabel } from './tiktok.mjs';
import {
	publishToInstagram,
	probeInstagram,
	publishReady,
	dropHostedCover,
	refreshInstagramAccount,
	accountInfo
} from './instagram.mjs';
import { copyToDestination, copyInto } from './archive.mjs';
import { scanWatchFolder, scanLocalFolders } from './watch.mjs';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { resolveFolder } from './paths.mjs';
import { pickFolder } from './folderpick.mjs';
import { scoreTitle, generateTitles, listTools } from './vidiq.mjs';
import { statsPass, unitsToday } from './stats.mjs';
import { msUntil } from './upload.mjs';
import { startPreviewServer } from './preview.mjs';
import { makeRemoteLog } from './remotelog.mjs';
import { randomBytes } from 'node:crypto';
import { makeHeartbeat } from './heartbeat.mjs';
import { ownsPublishing } from './roles.mjs';
import { decide, mayBeAlive } from './orphans.mjs';

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
		probe: probeYouTube,
		timing: 'now',
		lead: () => 0,
		ready: (config) => Boolean(config.google.refreshToken),
		setup: 'pnpm worker:auth'
	},
	tiktok: {
		publish: publishToTikTok,
		probe: probeTikTok,
		timing: 'slot',
		lead: () => 0,
		ready: hasTikTok,
		setup: 'pnpm worker:auth --tiktok'
	},
	instagram: {
		publish: publishToInstagram,
		probe: probeInstagram,
		timing: 'slot',
		lead: (config) => Math.max(0, Number(config.instagramLeadSeconds) || 0),
		ready: hasInstagram,
		setup: 'pnpm worker:auth --instagram --token'
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

// Everything printed is also copied to the Log screen. `run` tells one start
// of the worker from the next there.
const run = randomBytes(4).toString('hex');
const remote = makeRemoteLog({ run });

function log(message) {
	console.log(`[${stamp()}] ${message}`);
	remote.push(message);
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

const NAMES = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };

/**
 * Who does what, and what is being done — set in main. The one-shot modes get
 * a heartbeat that writes nothing and does what the role owns.
 */
let hb;

/** Rows this run is publishing; any other `publishing` row is an orphan. */
const inHand = new Set();

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

	// A handover may have begun since this pass listed the row; leave it for
	// the worker taking over.
	if (!hb.canPublish()) return;

	// Claim before starting, so a second pass cannot pick up the same row while
	// its upload is in flight. The claim names this run, which is what lets
	// the platform handle below be refused if the row has been taken over.
	inHand.add(target.id);
	try {
		const claim = { run, role: config.role, claimedAt: new Date().toISOString() };
		await pb.updateTarget(target.id, { status: 'publishing', error: '', handle: claim });
		log(`claimed ${label}`);

		const name = `${NAMES[platform] ?? platform}: "${target.title || target.description?.slice(0, 60) || target.id}"`;
		const until = adapter.timing === 'slot' && msUntil(target.scheduled_at) > 0 ? target.scheduled_at : undefined;
		await hb.track(`Publishing to ${name}`, () => publishOne(pb, config, platform, target, job, label, claim), {
			publishing: true,
			until
		});
	} finally {
		inHand.delete(target.id);
	}
}

/** Whether the row is still this run's — another worker may have taken it over. */
async function stillOurs(pb, id) {
	const row = await pb.getTarget(id);
	return row.status === 'publishing' && row.handle?.run === run;
}

async function publishOne(pb, config, platform, target, job, label, claim) {
	const adapter = ADAPTERS[platform];
	// The platform's handle on the upload goes on the row before any bytes do,
	// and the adapters do not start without it: a worker taking over asks the
	// platform about it rather than uploading again. See orphans.mjs.
	const saveHandle = async (handle) => {
		if (!(await stillOurs(pb, target.id))) {
			throw new Error('Another worker has taken this row over; not uploading it here as well.');
		}
		await pb.updateTarget(target.id, { handle: { ...claim, ...handle } });
	};

	let result;
	let failure;
	try {
		result = await adapter.publish({
			target,
			job,
			pb,
			config,
			saveHandle,
			log: (message) => log(`  ${message}`)
		});
	} catch (err) {
		failure = err instanceof Error ? err.message : String(err);
	}

	// Taken over while this ran. If the other worker recorded this very upload
	// (the row is settled but still carries our claim), there is nothing to
	// add; if it queued the row again, a finished upload here is a duplicate.
	// An unreadable row falls through to the write, which reports itself.
	const now = await pb.getTarget(target.id).catch(() => null);
	if (now && !(now.status === 'publishing' && now.handle?.run === run)) {
		if (now.handle?.run === run) {
			log(`${label} was recorded by the worker that took over, from this same upload`);
			return;
		}
		const what = result ? `finished anyway as ${result.url} — a duplicate to remove` : `ended: ${failure}`;
		log(`${label} was taken over by another worker while publishing here; this upload ${what}`);
		if (result) pb.log(`Duplicate upload to ${platform}`, `${target.title || '(no title)'}: ${what}`);
		return;
	}

	if (result) {
		await recordResult(pb, platform, target, result, label);
		return;
	}
	await pb.updateTarget(target.id, { status: 'failed', error: failure.slice(0, 1900) });
	log(`FAILED ${label}: ${failure}`);
	pb.log(`Failed to publish to ${platform}`, `${target.title || '(no title)'}: ${failure}`);
}

async function recordResult(pb, platform, target, result, label) {
	await pb.updateTarget(target.id, {
		status: result.scheduled ? 'scheduled' : 'published',
		remote_url: result.url,
		error: result.locked ? 'Stored as private: the API project is not audited yet.' : '',
		...(result.scheduled ? {} : { published_at: new Date().toISOString() })
	});

	const how = result.scheduled ? `scheduled for ${target.scheduled_at}` : `live as ${result.privacyStatus}`;
	log(`done ${label} — ${how}  ${result.url}`);
	pb.log(`Published to ${platform}`, `${target.title || '(no title)'} -> ${result.url} (${how})`);
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
		if (!hb.canPublish()) return;
		try {
			const result = await hb.track(
				`Filing "${job.title || job.video_name || job.id}" into its destination`,
				() => copyToDestination({ job, pb, log: (m) => log(`  ${m}`) }),
				{ publishing: true }
			);
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
	// The listing is published by whoever publishes; a PC worker that is not
	// covering still scans it, for the previews it serves.
	const publish = hb.canPublish();
	// Swapped in once the scan is done, not emptied before it: a slow share
	// would otherwise cut off every preview for as long as the scan takes.
	let nas = new Map();
	if (folder && (publish || hb.canLocal())) {
		const index = await scanWatchFolder(folder);
		if (index) {
			if (publish) await pb.setSetting('watch_index', index);
			// Listed by the path the page knows, opened by the one that works here.
			if (!index.error) nas = new Map(index.files.map((f) => [f.path, { ...f, path: join(index.folder, f.name) }]));
			if (index.error) log(`watch folder: ${index.error}`);
			else log(`watch folder: ${index.files.length} video(s) in ${index.folder}`);
		}
	}
	listed.nas = nas;
	if (!hb.canLocal()) return;

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
	if (!hb.canLocal()) return;
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
			const dir = await resolveFolder(watch);
			const result = await hb.track(`Copying "${job.title || basename(from)}" to the NAS`, () =>
				copyInto({
					source: { stream: createReadStream(from), size: info.size },
					dir,
					wanted: job.video_name || basename(from),
					log: (m) => log(`  ${m}`)
				})
			);
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
	if (!hb.canPublish()) return;
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
	if (picking || dry || !hb.canLocal()) return;
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
		const path = await hb.track('Folder dialog open for Settings', () => pickFolder());
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
	if (!hb.canPublish()) return;
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
	if (!hb.canPublish()) return;
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
	if (!hb.canPublish()) return;
	if (hasTikTok(config)) {
		await refreshTikTokCreator(pb, config, log).catch((err) => log(`tiktok: ${err.message}`));
	}
	if (hasInstagram(config)) {
		await refreshInstagramAccount(pb, config, log).catch((err) => log(`instagram: ${err.message}`));
	}
}

/** What each orphan was last seen doing, and which have been reported. */
const orphanSeen = new Map();
const orphanSaid = new Map();
let orphansBusy = false;

/**
 * Settles rows left `publishing` by a run that is not handling them any more
 * — a crash, or a NAS worker this PC is covering for — by asking the platform
 * how far each got (orphans.mjs) instead of uploading it again blind. Runs
 * whenever this worker holds the publishing work, so a row the platform is
 * still busy with is asked about again on the next tick.
 */
async function orphanPass(pb, config) {
	if (orphansBusy || dry || !hb.canPublish()) return;
	orphansBusy = true;
	try {
		for (const [platform, adapter] of Object.entries(ADAPTERS)) {
			if (!adapter.ready(config)) continue;
			for (const row of await pb.stalePublishing(platform)) {
				if (inHand.has(row.id) || !hb.canPublish()) continue;
				await settleOrphan(pb, config, platform, row).catch((err) =>
					log(`could not check ${platform} ${row.id} with the platform: ${err.message.split('\n')[0]} — asking again later`)
				);
			}
		}
	} finally {
		orphansBusy = false;
	}
}

async function settleOrphan(pb, config, platform, row) {
	const adapter = ADAPTERS[platform];
	const label = `${platform} "${row.title || row.description?.slice(0, 40) || row.id}"`;
	const handle = row.handle ?? null;
	const probe = handle?.kind ? await adapter.probe(config, handle) : null;
	const alive = mayBeAlive(handle, config.role);
	const verdict = decide({
		handle,
		probe,
		alive,
		now: Date.now(),
		slotAt: row.scheduled_at,
		seen: orphanSeen.get(row.id)
	});

	if (verdict.action === 'leave') {
		if (verdict.seen) orphanSeen.set(row.id, verdict.seen);
		if (orphanSaid.get(row.id) !== verdict.reason) {
			orphanSaid.set(row.id, verdict.reason);
			log(`left ${label} from another run: ${verdict.reason}`);
		}
		return;
	}
	orphanSeen.delete(row.id);
	orphanSaid.delete(row.id);

	inHand.add(row.id);
	try {
		if (verdict.action === 'requeue') {
			await pb.updateTarget(row.id, {
				status: 'pending',
				handle: null,
				error: `Queued again: ${verdict.reason}.`.slice(0, 1900)
			});
			log(`queued ${label} again — ${verdict.reason}`);
		} else if (verdict.action === 'finish') {
			log(`${label} had finished on ${NAMES[platform]} under another run — recording it, not uploading again`);
			if (platform === 'youtube') log('  its thumbnail and playlist, if any, may not have been applied');
			await recordResult(pb, platform, row, probe.result, label);
		} else if (verdict.action === 'publish') {
			log(`${label} was processed but never published — publishing that container`);
			const result = await hb.track(`Publishing to ${NAMES[platform]}: "${row.title || row.id}"`, () => publishReady(config, handle), {
				publishing: true
			});
			await recordResult(pb, platform, row, result, label);
		}
	} finally {
		inHand.delete(row.id);
	}

	if (handle?.coverPhotoId) {
		await dropHostedCover(config, handle.coverPhotoId).catch((err) =>
			log(`cover photo ${handle.coverPhotoId} could not be deleted from the Page (${err.message.split('\n')[0]})`)
		);
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
			throw new Error('Instagram is not set up. Run:  pnpm worker:auth --instagram --token');
		}
		const account = await accountInfo(config);
		log(`Instagram posts as @${account.username} (id ${account.userId}), through the Page "${account.pageName}"`);
		if (account.quotaTotal) log(`${account.quotaUsed} of ${account.quotaTotal} posts used in the last 24 hours`);
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
	const live = !(once || dry || statsOnly);
	log(
		`worker started (${dry ? 'dry run' : once ? 'single pass' : statsOnly ? 'stats only' : 'polling'}, ` +
			`role ${config.role}, pid ${process.pid})`
	);
	remote.attach(pb);
	hb = makeHeartbeat({
		pb,
		role: config.role,
		run,
		log,
		live,
		onStartPublishing: () => orphanPass(pb, config).catch((err) => log(`orphan check failed: ${err.message}`))
	});

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

	// The other roles check when they take the publishing work up — see
	// heartbeat.mjs — and every role again on each slot tick.
	if (!dry && config.role === 'all') await orphanPass(pb, config);

	if (once || dry) {
		await scorePass(pb, config);
		if (!dry && config.statsSeconds > 0 && hb.canPublish()) await statsPass({ pb, config, log });
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

	await hb.start();
	// A last heartbeat on the way out, so the sidebar turns red and a PC worker
	// takes over at once rather than after the stale window. A second ctrl-c
	// does not wait for it.
	let stopping = false;
	for (const signal of ['SIGINT', 'SIGTERM']) {
		process.on(signal, () => {
			if (stopping) process.exit(1);
			stopping = true;
			log('stopping');
			void Promise.race([
				hb.stop().then(() => remote.flush()),
				new Promise((resolve) => setTimeout(resolve, 3000))
			]).finally(() => process.exit(0));
		});
	}

	// The Upload step's player — see preview.mjs. Only for a worker that stays
	// up; the address is published where the page looks for it, and left there
	// when the worker stops, so the page checks it answers before using it.
	if (config.previewPort > 0 && hb.canLocal()) {
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
		if (!ownsPublishing(config.role)) log('stats run here only while covering for the NAS worker');
		log(
			`stats: newest ${config.statsVideos} videos every ${config.statsSeconds}s, ` +
				`up to ${config.statsBudget} units a day`
		);
		let statsBusy = false;
		const tick = async () => {
			if (statsBusy || !hb.canPublish()) return;
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
		void orphanPass(pb, config).catch((err) => log(`orphan check failed: ${err.message}`));
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

// The one-shot modes return from main, and their last lines are still queued
// for the Log screen; a fatal error is worth seeing there most of all.
main()
	.then(() => remote.flush())
	.catch(async (err) => {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`\n${message}\n`);
		remote.push(`stopped: ${message}`);
		await remote.flush().catch(() => {});
		process.exit(1);
	});
