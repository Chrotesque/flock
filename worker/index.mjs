#!/usr/bin/env node
// The publishing worker.
//
//   pnpm worker             poll forever
//   pnpm worker:once        one pass, then exit
//   pnpm worker:dry         one pass, reporting what it would do, uploading nothing
//   pnpm worker:vidiq       check the vidIQ key, spending no credits
//   pnpm worker:stats       one stats pass over the channel (and the Instagram and Facebook posts), then exit
//   pnpm worker:tiktok      show who the TikTok token posts as, then exit
//   pnpm worker:instagram   show who the Instagram token posts as, then exit
//   … --stop                stop the polling worker of this role on this machine
//
// Belongs beside PocketBase, not in the SPA: it holds the platforms' client
// secrets, and it has to keep running when no browser is open. Its `role`
// (roles.mjs) splits the work between a NAS and a PC worker; the default,
// `all`, does everything.

import { loadConfig, requireConfig, hasYouTube, hasTikTok, hasInstagram, hasFacebook, saveSection } from './config.mjs';
import {
	LEAD_SECONDS as FACEBOOK_LEAD_SECONDS,
	deleteFacebookReel,
	facebookAccount,
	facebookRelease,
	probeFacebook,
	publishReadyReel,
	publishToFacebook,
	refreshFacebookPages,
	rescheduleFacebookReel
} from './facebook.mjs';
import {
	FAILED_WINDOW_MS,
	addSeen,
	cardItems,
	readAlertSettings,
	readDismissed,
	runName,
	sameWarnings,
	toShow,
	undelivered
} from './alerts.mjs';
import { isSea } from 'node:sea';
import { makeClient } from './pb.mjs';
import {
	deleteYouTubeVideo,
	grantCanEdit,
	releaseYouTubeNow,
	publishToYouTube,
	probeYouTube,
	refreshYouTubeChannels,
	rescheduleYouTube,
	youtubeChannels,
	youtubeRelease
} from './youtube.mjs';
import { publishToTikTok, probeTikTok, refreshTikTokCreators, creatorInfo, privacyLabel } from './tiktok.mjs';
import {
	publishToInstagram,
	probeInstagram,
	publishReady,
	dropHostedCover,
	refreshInstagramAccounts,
	accountInfo
} from './instagram.mjs';
import { instagramReady } from './accounts.mjs';
import { copyToDestination, copyInto } from './archive.mjs';
import { scanFolders, published } from './watch.mjs';
import { readWatchConfig } from './folders.mjs';
import { MANIFEST_NAME, archiveManifest, detachedKey, planProjectWrites, scanProjectRoots } from './projects.mjs';
import { makeFolderWatcher } from './folderwatch.mjs';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { resolveFolder } from './paths.mjs';
import { pickFolder } from './folderpick.mjs';
import { readLocalImage } from './localfile.mjs';
import { scoreTitle, generateTitles, listTools } from './vidiq.mjs';
import { statsPass, unitsToday } from './stats.mjs';
import { instagramStatsPass } from './igstats.mjs';
import { facebookStatsPass } from './fbstats.mjs';
import { msUntil } from './upload.mjs';
import { startPreviewServer } from './preview.mjs';
import { makeRemoteLog } from './remotelog.mjs';
import { randomBytes } from 'node:crypto';
import { makeHeartbeat } from './heartbeat.mjs';
import { coversNas, ownsPublishing } from './roles.mjs';
import { watchForUpdate } from './selfupdate.mjs';
import { askToStop, holdInstance } from './instance.mjs';
import { sayOnScreen, startTray, wantsTray } from './tray.mjs';
import { exeLogPath } from './filelog.mjs';
import { WORKER_VERSION } from './version.mjs';
import { decide, mayBeAlive } from './orphans.mjs';
import { moveStep, requeuePatch } from './moves.mjs';
import { SYNC_PLATFORMS, movedHandle, refusedHandle, rescheduleStep } from './reschedule.mjs';
import { requestStep } from './requests.mjs';
import { inJob } from './jobscope.mjs';

/**
 * One entry per platform that can actually publish, and how it is timed.
 *
 * `now` platforms take the release time themselves, so their rows are picked
 * up the moment they exist and the platform releases at the slot. `slot`
 * platforms cannot, so the worker holds each row and starts only when the
 * slot comes — less `lead` seconds, for one that needs a head start to be
 * ready on the minute. Facebook is a `slot` platform with a lead of four
 * weeks: Facebook holds a reel for its time itself (as YouTube does) but only
 * up to 29 days ahead, so a row is taken up once its slot is within reach, and
 * `holds: false` says the worker does not sit on it until then.
 * `publishReady` finishes a post another run left processed but unpublished
 * (orphans.mjs); `remove` deletes a post from the account it went out on, for
 * one moved to another brand (moves.mjs). A platform whose credentials are missing is skipped with a
 * notice rather than failed: its rows wait in the queue for the day it is set
 * up.
 */
const ADAPTERS = {
	youtube: {
		publish: publishToYouTube,
		probe: probeYouTube,
		remove: deleteYouTubeVideo,
		releaseNow: releaseYouTubeNow,
		reschedule: rescheduleYouTube,
		release: youtubeRelease,
		timing: 'now',
		lead: () => 0,
		ready: hasYouTube,
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
		publishReady,
		timing: 'slot',
		lead: (config) => Math.max(0, Number(config.instagramLeadSeconds) || 0),
		ready: hasInstagram,
		setup: 'pnpm worker:auth --instagram --token'
	},
	facebook: {
		publish: publishToFacebook,
		probe: probeFacebook,
		remove: deleteFacebookReel,
		reschedule: rescheduleFacebookReel,
		release: facebookRelease,
		publishReady: publishReadyReel,
		timing: 'slot',
		holds: false,
		lead: () => FACEBOOK_LEAD_SECONDS,
		ready: hasFacebook,
		setup: 'pnpm worker:auth --facebook'
	}
};

const once = process.argv.includes('--once');
const dry = process.argv.includes('--dry');
const checkVidiq = process.argv.includes('--vidiq');
const statsOnly = process.argv.includes('--stats');
const checkTikTok = process.argv.includes('--tiktok');
const checkInstagram = process.argv.includes('--instagram');
const checkFacebook = process.argv.includes('--facebook');
const checkYouTube = process.argv.includes('--youtube');
const stopOnly = process.argv.includes('--stop');
// Started by Windows at sign-in (Start with Windows, alerts.mjs autostartCommand).
const autostart = process.argv.includes('--autostart');

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

const NAMES = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };

/**
 * Who does what, and what is being done — set in main. The one-shot modes get
 * a heartbeat that writes nothing and does what the role owns.
 */
let hb;

/** Rows this run is publishing; any other `publishing` row is an orphan. */
const inHand = new Set();

/** One target, with everything it prints tagged as its job's (jobscope.mjs). */
function handle(pb, config, platform, target) {
	return inJob(target.job, () => handleTarget(pb, config, platform, target));
}

async function handleTarget(pb, config, platform, target) {
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

	// Read again just before the claim: the listing may be seconds old, and a
	// move to another brand (moves.mjs) or a drag in the Calendar may have
	// landed since. A row with a move waiting is the move pass's.
	const fresh = await pb.getTarget(target.id);
	if (fresh.status !== 'pending' || fresh.move || fresh.request) return;
	target = fresh;

	// Claim before starting, so a second pass cannot pick up the same row while
	// its upload is in flight. The claim names this run, which is what lets
	// the platform handle below be refused if the row has been taken over.
	inHand.add(target.id);
	try {
		const claim = { run, role: config.role, claimedAt: new Date().toISOString() };
		await pb.updateTarget(target.id, { status: 'publishing', error: '', handle: claim });
		log(`claimed ${label}`);

		const name = `${NAMES[platform] ?? platform}: "${target.title || target.description?.slice(0, 60) || target.id}"`;
		// A platform the worker holds a post for until its minute; Facebook holds its own.
		const until =
			adapter.timing === 'slot' && adapter.holds !== false && msUntil(target.scheduled_at) > 0 ? target.scheduled_at : undefined;
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
	// Asked by a platform that holds a post until its minute, just before it
	// goes out: false once the post has been moved to another brand meanwhile.
	// A PocketBase that cannot be read says yes — its outage must not cost
	// the slot.
	const stillWanted = async () => {
		const row = await pb.getTarget(target.id).catch(() => null);
		return !row?.move;
	};

	let result;
	let failure;
	let moved = false;
	try {
		result = await adapter.publish({
			target,
			job,
			pb,
			config,
			saveHandle,
			stillWanted,
			log: (message) => log(`  ${message}`)
		});
	} catch (err) {
		failure = err instanceof Error ? err.message : String(err);
		moved = Boolean(err?.moved);
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
	// Stopped before posting for a move: back in the queue, where the move
	// pass gives it its new account. Nothing was published anywhere.
	if (moved) {
		await pb.updateTarget(target.id, { status: 'pending', handle: null, error: '' });
		log(`${label} was not posted: it was moved to another account while it was held`);
		return;
	}
	await pb.updateTarget(target.id, { status: 'failed', error: failure.slice(0, 1900) });
	log(`FAILED ${label}: ${failure}`);
	pb.log(`Failed to publish to ${platform}`, `${target.title || '(no title)'}: ${failure}`);
}

async function recordResult(pb, platform, target, result, label) {
	// What the platform did not take and has to be set by hand (YouTube's
	// thumbnail, playlist, paid promotion) is said on the Log entry.
	const todo = result.todo?.length
		? `Set by hand in Studio: ${result.todo.join(', ')}${result.todoUrl ? ` — ${result.todoUrl}` : '.'}`
		: '';
	// And what an adapter says went out differently (Facebook's refused cover).
	const notes = [result.locked ? 'Stored as private: the API project is not audited yet.' : '', todo, ...(result.notes ?? [])];
	// A platform holding the post keeps the time it was handed, so a move in
	// the Calendar can be told apart from it (reschedule.mjs). Merged into the
	// handle as it stands, which the upload has been writing to.
	const release = result.scheduled ? await releaseHandle(pb, target) : null;
	await pb.updateTarget(target.id, {
		status: result.scheduled ? 'scheduled' : 'published',
		remote_url: result.url,
		error: notes.filter(Boolean).join(' '),
		...(release ? { handle: release } : {}),
		...(result.scheduled ? {} : { published_at: new Date().toISOString() })
	});

	const how = result.scheduled ? `scheduled for ${target.scheduled_at}` : `live as ${result.privacyStatus}`;
	log(`done ${label} — ${how}  ${result.url}`);
	if (todo) log(`  ${todo}`);
	const said = [todo, ...(result.notes ?? [])].filter(Boolean).join(' ');
	pb.log(`Published to ${platform}`, `${target.title || '(no title)'} -> ${result.url} (${how})${said ? ` ${said}` : ''}`);
}

/** The row's handle with the time the platform was handed; null when there is none to keep. */
async function releaseHandle(pb, target) {
	const at = Date.parse(String(target.scheduled_at ?? '').replace(' ', 'T'));
	if (!Number.isFinite(at)) return null;
	const row = await pb.getTarget(target.id).catch(() => null);
	const handle = row?.handle ?? target.handle;
	return { ...(handle && typeof handle === 'object' ? handle : {}), release: new Date(at).toISOString() };
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
		await inJob(job.id, () => copyOne(pb, job));
	}
}

async function copyOne(pb, job) {
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

/**
 * The latest listing of each kind, by path: what the preview server may
 * stream — the watch folders' videos and the projects' alike, `nas` for the
 * network's and `local` for the PC's. Replaced wholesale on every scan, so a
 * file that has left a folder stops being playable at the same moment it
 * stops being listed. Keyed by the path the page knows, holding the one that
 * opens here.
 */
const listed = { nas: new Map(), local: new Map() };

function playable(index, roots) {
	const map = new Map();
	for (const file of index?.files ?? []) map.set(file.path, { ...file, path: file.opened });
	for (const root of roots) {
		for (const project of root.projects) {
			for (const file of project.videos) map.set(file.path, { ...file, path: file.opened });
		}
	}
	return map;
}

/** For the listing's row: each project folder, and how many projects it holds. */
function rootSummary(roots) {
	return roots.map((root) =>
		root.error ? { folder: root.folder, error: root.error } : { folder: root.folder, count: root.projects.length }
	);
}

/**
 * Lists the watch folders and the project folders so the compose screen can
 * show them. The folders are configured in the SPA, so they are read back out
 * of settings each time rather than duplicated into the worker's own config.
 *
 * Two kinds, each scanned on its own (`scanKind`): the network's, written by
 * whoever publishes — a PC worker that is not covering still reads them, for
 * the previews it serves — and the PC's own, the `local` worker's, which only
 * work while it runs on the PC they are on. The regular pass scans both; a
 * change in a watched project folder scans its kind at once (`folderWatcher`).
 */
async function watchPass(pb) {
	lastWatchPass = Date.now();
	await scanKind(pb, 'network');
	await scanKind(pb, 'local');
}

/** When the last full listing ran: a main loop woken early skips the next. */
let lastWatchPass = 0;

/**
 * The project folders of each kind this worker writes, watched for changes
 * (folderwatch.mjs) — a long-running worker only. Null in the one-shot modes.
 */
let folderWatcher = null;

/** A scan of a kind in flight, and whether another was asked for meanwhile. */
const scanning = { network: null, local: null };
const rescan = { network: false, local: false };

/**
 * Scans one kind, never twice at once: a scan asked for while one runs makes
 * that one go round again when it ends, with the settings read afresh, so a
 * change landing mid-scan is never missed and two scans never write the same
 * project rows side by side.
 */
function scanKind(pb, kind, opts = {}) {
	if (scanning[kind]) {
		rescan[kind] = true;
		return scanning[kind];
	}
	scanning[kind] = (async () => {
		try {
			do {
				rescan[kind] = false;
				await scanKindOnce(pb, kind, opts);
			} while (rescan[kind]);
		} finally {
			scanning[kind] = null;
		}
	})();
	return scanning[kind];
}

/** Whether this worker writes a kind's listing and project rows — and so watches it. */
function writesKind(kind) {
	return kind === 'network' ? hb.canPublish() : hb.canLocal();
}

async function scanKindOnce(pb, kind, { quiet = false } = {}) {
	const all = readWatchConfig((await pb.getSetting('general'))?.value);
	const network = kind === 'network';
	const watchFolders = network ? all.network : all.local;
	const projectFolders = network ? all.projects.network : all.projects.local;
	const write = writesKind(kind);
	const read = write || (network && hb.canLocal());

	// Swapped in once the scan is done, not emptied before it: a slow share
	// would otherwise cut off every preview for as long as the scan takes.
	let map = new Map();
	let watched = [];
	if (read && watchFolders.length + projectFolders.length > 0) {
		const index = await scanFolders(watchFolders);
		const roots = await scanProjectRoots(projectFolders);
		if (write) {
			await pb.setSetting(network ? 'watch_index' : 'local_index', {
				...index,
				files: index.files.map(published),
				projectRoots: rootSummary(roots)
			});
			await writeProjects(pb, roots, !network);
			watched = roots.flatMap((root) => (root.resolved ? [root.resolved, ...root.dirs] : []));
		}
		map = playable(index, roots);
		if (!quiet) reportScan(network ? 'LAN' : 'local', index, roots);
	}
	listed[network ? 'nas' : 'local'] = map;

	if (folderWatcher) {
		const before = folderWatcher.count(kind);
		folderWatcher.sync(kind, watched);
		const after = folderWatcher.count(kind);
		if (after !== before) log(`watching ${after} ${network ? 'LAN' : 'local'} project folder(s) for changes`);
	}
}

function reportScan(kind, index, roots) {
	for (const entry of index.folders) if (entry.error) log(`${kind} watch folder: ${entry.error}`);
	if (index.folders.length > 0) {
		log(`${kind} watch folders: ${index.files.length} video(s) in ${index.folders.length} folder(s)`);
	}
	for (const root of roots) if (root.error) log(`${kind} projects: ${root.error}`);
	if (roots.length > 0) {
		const count = roots.reduce((sum, root) => sum + root.projects.length, 0);
		log(`${kind} projects: ${count} in ${roots.length} project folder(s)`);
	}
}

/** Off for the run once PocketBase says it has no `projects` collection. */
let projectsOff = false;

/**
 * Brings the `projects` rows in line with a scan of one kind's project
 * folders: only what changed is written (projects.mjs). A missing collection
 * — setup-pb not run since this arrived — turns this off with one line.
 */
async function writeProjects(pb, roots, local) {
	if (projectsOff || roots.length === 0) return;
	let existing;
	try {
		existing = await pb.listProjects();
	} catch (err) {
		if (!/ -> 404\b/.test(err.message)) throw err;
		projectsOff = true;
		log('projects is missing — run pnpm setup-pb, then restart; project folders are not listed until then');
		return;
	}
	const { create, update } = planProjectWrites(existing, roots, local);
	if (dry) {
		for (const data of create) log(`would list the new project ${data.name}`);
		if (update.length) log(`would update ${update.length} project row(s)`);
		return;
	}
	for (const data of create) {
		try {
			await pb.createProject(data);
			log(`new project: ${data.name} (${data.manifest_name}, ${data.videos.length} video(s))`);
		} catch (err) {
			log(`could not list the project ${data.name}: ${err.message.split('\n')[0]}`);
		}
	}
	for (const { id, data } of update) {
		await pb.updateProject(id, data).catch((err) => log(`could not update project ${id}: ${err.message.split('\n')[0]}`));
	}
}

/**
 * Renames a sent project's flock.json to flock_uploaded.json, so its folder
 * leaves the sidebar for good while the text stays beside the video — done
 * by the worker that scans that kind of folder, on the slot tick, so a long
 * upload holding the main loop does not hold it. The rename comes first and
 * the row is marked after: the other order, with a rename that then failed,
 * would list the same file again as a new project. A folder that cannot be
 * read is tried again on the next tick, said once.
 */
let archiving = false;
const archiveSaid = new Map();

async function archivePass(pb) {
	if (archiving || projectsOff || dry) return;
	const publish = hb.canPublish();
	const local = hb.canLocal();
	if (!publish && !local) return;
	archiving = true;
	try {
		let rows;
		try {
			rows = await pb.projectsToArchive();
		} catch (err) {
			if (/ -> 404\b/.test(err.message)) return;
			throw err;
		}
		for (const row of rows) {
			if (row.local ? !local : !publish) continue;
			const name = row.manifest_name || MANIFEST_NAME;
			try {
				const result = await archiveManifest(await resolveFolder(row.path), name);
				await pb.updateProject(row.id, {
					archived_at: new Date().toISOString(),
					archived_as: result.renamed ?? '',
					key: detachedKey(row)
				});
				archiveSaid.delete(row.id);
				log(
					result.renamed
						? `project ${row.name} sent: renamed ${name} to ${result.renamed}`
						: `project ${row.name} sent: ${name} was already gone from its folder`
				);
			} catch (err) {
				const message = err.message.split('\n')[0];
				if (archiveSaid.get(row.id) !== message) {
					archiveSaid.set(row.id, message);
					log(`project ${row.name} sent, but ${name} could not be renamed yet: ${message}`);
				}
			}
		}
	} finally {
		archiving = false;
	}
}

/**
 * Copies videos picked from a folder on the PC into the network watch folder
 * Settings marks for it, then points the job at the copy. Until that happens
 * nothing publishes from the job and nothing is filed into its destination —
 * see `handle` and `pendingCopies`. The local original is left alone.
 *
 * With no network folder to copy into, a worker that both lists and
 * publishes (`all`, one machine) uses the file where it lies.
 */
let importing = false;

/**
 * Also on the scoring tick, so a video picked from the PC is on its way to
 * the NAS within seconds of the confirm rather than at the next poll — the
 * NAS worker cannot publish it before. Never two at once: a copy can take a
 * long time.
 */
async function importPass(pb, config) {
	if (importing || !hb.canLocal()) return;
	importing = true;
	try {
		await importPending(pb, config);
	} finally {
		importing = false;
	}
}

async function importPending(pb, config) {
	const jobs = await pb.pendingImports();
	if (jobs.length === 0) return;

	const row = await pb.getSetting('general');
	const watch = readWatchConfig(row?.value).importTo;

	for (const job of jobs) {
		if (dry) {
			log(`would copy local ${job.source_path} into the watch folder`);
			continue;
		}
		await inJob(job.id, () => importOne(pb, config, job, watch));
	}
}

async function importOne(pb, config, job, watch) {
	try {
		if (!watch && config.role === 'all') {
			await pb.updateJob(job.id, { source_local: false, error: '' });
			log(`"${job.title}" is published from ${job.source_path}, where it lies — no network watch folder to copy it into`);
			return;
		}
		if (!watch) throw new Error('No network watch folder is set to copy local videos into.');
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
 * Answers Settings' "Choose folder…" by opening the Windows folder dialog
 * here, on the worker's own desktop, and writing the chosen path back to
 * `app_settings` / `folder_pick`. It rides on the scoring tick because
 * somebody is waiting on it just the same.
 *
 * The dialog opens on this machine whichever browser asked — Settings says
 * so — so one may come up where nobody is looking. A newer request therefore
 * closes a dialog still open and is answered instead, and an answer is only
 * written while the row still holds the request it answers: the dialog of
 * 11 Oct 2026 that nobody saw held every later request for ten minutes, then
 * wrote "failed" over the newest one.
 *
 * A request left pending while the worker was off is not honoured when it
 * starts: a dialog springing up minutes after anyone asked for it would only
 * confuse.
 */
let picking = null;
const PICK_MAX_AGE_MS = 2 * 60_000;

async function folderPickPass(pb) {
	if (dry || !hb.canLocal()) return;
	const row = await pb.getSetting('folder_pick');
	const ask = row?.value;
	if (picking) {
		if (ask?.status === 'pending' && ask.id && ask.id !== picking.id) picking.controller.abort();
		return;
	}
	if (!ask || ask.status !== 'pending' || !ask.id) return;
	if (Date.now() - new Date(ask.requestedAt).getTime() > PICK_MAX_AGE_MS) {
		await answerPick(pb, ask, { status: 'expired' });
		return;
	}

	const controller = new AbortController();
	picking = { id: ask.id, controller };
	try {
		await answerPick(pb, ask, { status: 'open' });
		log('folder dialog opened for Settings');
		const path = await hb.track('Folder dialog open for Settings', () => pickFolder({ signal: controller.signal }));
		await answerPick(pb, ask, { status: path ? 'done' : 'cancelled', path: path ?? '' });
		log(path ? `folder chosen: ${path}` : 'folder dialog cancelled');
	} catch (err) {
		if (controller.signal.aborted) {
			log('folder dialog closed: a newer request replaced it');
		} else {
			const message = err instanceof Error ? err.message : String(err);
			await answerPick(pb, ask, { status: 'failed', error: message.slice(0, 1000) });
			log(`folder dialog failed: ${message}`);
		}
	} finally {
		picking = null;
	}
}

/** Writes the answer to a folder request, unless a newer request has replaced it. */
function answerPick(pb, ask, patch) {
	return answerIfCurrent(pb, 'folder_pick', ask, patch);
}

/** Answers a one-slot request row, unless a newer request has replaced it. */
async function answerIfCurrent(pb, key, ask, patch) {
	const current = (await pb.getSetting(key))?.value;
	if (current?.id !== ask.id) return;
	await pb.setSetting(key, { ...ask, ...patch });
}

/**
 * Re-reads the TikTok accounts' creator info when the compose screen asks
 * (`app_settings` / `tiktok_check`): TikTok's guidelines want the latest
 * creator info each time the Post to TikTok box is shown, and the half-hourly
 * read alone can be thirty minutes old — too old to know the account has hit
 * its daily posting cap. Only the worker holding the TikTok tokens answers;
 * on the scoring tick, since somebody is looking at the box. An ask older
 * than a minute has been given up on.
 */
let checkingCreators = false;
const CREATOR_CHECK_MAX_AGE_MS = 60_000;

async function creatorCheckPass(pb, config) {
	if (checkingCreators || dry || !hb.canPublish() || !hasTikTok(config)) return;
	const ask = (await pb.getSetting('tiktok_check'))?.value;
	if (!ask || ask.status !== 'pending' || !ask.id) return;
	if (Date.now() - Date.parse(ask.requestedAt) > CREATOR_CHECK_MAX_AGE_MS) {
		await answerIfCurrent(pb, 'tiktok_check', ask, { status: 'expired' });
		return;
	}
	checkingCreators = true;
	try {
		await answerIfCurrent(pb, 'tiktok_check', ask, { status: 'running' });
		// Every account; each failure lands on its own row as `error`.
		await refreshTikTokCreators(pb, config, log, true);
		await answerIfCurrent(pb, 'tiktok_check', ask, { status: 'done', doneAt: new Date().toISOString() });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await answerIfCurrent(pb, 'tiktok_check', ask, { status: 'failed', error: message.slice(0, 1000) });
	} finally {
		checkingCreators = false;
	}
}

/**
 * Answers the compose screen's asks for an image on this machine: the
 * thumbnail a pasted flock block names by path. The browser cannot open a
 * path, so the file is read here (localfile.mjs: images only, up to 8 MB)
 * and attached to the `file_requests` row for the page to download. Rides on
 * the scoring tick, since somebody is waiting on it.
 *
 * An ask older than two minutes has been given up on by the page; a missing
 * collection (setup-pb not run since this arrived) turns the pass off for
 * the run with one line, rather than an error every three seconds.
 */
let fetchingFiles = false;
let fileRequestsOff = false;
let filesPrunedAt = 0;
const FILE_MAX_AGE_MS = 2 * 60_000;

async function fileRequestPass(pb) {
	if (fetchingFiles || fileRequestsOff || dry || !hb.canLocal()) return;
	fetchingFiles = true;
	try {
		let rows;
		try {
			rows = await pb.pendingFileRequests();
		} catch (err) {
			if (!/ -> 404\b/.test(err.message)) throw err;
			fileRequestsOff = true;
			log('file_requests is missing — run pnpm setup-pb, then restart; thumbnails named in a paste are not fetched until then');
			return;
		}

		for (const row of rows) {
			const asked = new Date(String(row.created).replace(' ', 'T')).getTime();
			if (Date.now() - asked > FILE_MAX_AGE_MS) {
				await pb.updateFileRequest(row.id, { status: 'failed', error: 'The worker picked the request up too late.' });
				continue;
			}
			try {
				const image = await readLocalImage(row.path);
				await pb.answerFileRequest(row.id, image);
				log(`sent ${image.name} to the compose screen (${Math.round(image.bytes.length / 1024)} KB)`);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				await pb.updateFileRequest(row.id, { status: 'failed', error: message.slice(0, 1900) });
				log(`could not send ${row.path} to the compose screen: ${message.split('\n')[0]}`);
			}
		}

		if (Date.now() - filesPrunedAt > 60 * 60_000) {
			filesPrunedAt = Date.now();
			await pb.pruneFileRequests(new Date(Date.now() - 24 * 60 * 60_000));
		}
	} finally {
		fetchingFiles = false;
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
	// A loop woken early for a release (nudgeMain) leaves the folders to the
	// regular minute: the watcher covers project folders meanwhile.
	if (Date.now() - lastWatchPass >= config.pollSeconds * 1000 - 2000) await watchPass(pb);
	await importPass(pb, config);
	if (!hb.canPublish()) return;

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

	// After publishing, not before: filing a big video into its NAS folder
	// would otherwise hold the YouTube upload, and its link, for the copy.
	await copyPass(pb);
}

/** Ends the main loop's wait early; set only while it waits. */
let wakeMain = null;

function sleepMain(ms) {
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			wakeMain = null;
			resolve();
		};
		const timer = setTimeout(done, ms);
		wakeMain = done;
	});
}

/**
 * Wakes the main loop when a release it handles is waiting — a YouTube row
 * just confirmed, or one held until its video is on the NAS — instead of
 * leaving it to the next poll, up to a minute away. One small query per slot
 * tick, and only while the loop is asleep.
 */
async function nudgeMain(pb, config) {
	if (!wakeMain || dry || !hb.canPublish()) return;
	for (const [platform, adapter] of Object.entries(ADAPTERS)) {
		if (adapter.timing !== 'now' || !adapter.ready(config)) continue;
		if (await pb.hasPending(platform)) {
			wakeMain?.();
			return;
		}
	}
}

/** Lanes at work, `platform:account`, and platforms whose rows are being listed. */
const busy = new Set();
const listing = new Set();

/**
 * The hold-and-fire platforms, on their own tick.
 *
 * Their rows become due at a particular minute, and the main loop can be held
 * for many minutes by one YouTube upload, so they are checked apart from it.
 * Each account is a lane that works one row at a time: a reel held for its
 * minute on one account must not keep another account's reel from going up
 * at the same time, while a second row for the same account waits for the
 * first. A dry run lists every pending row, due or not.
 */
async function slotPass(pb, config, { wait = false } = {}) {
	if (!hb.canPublish()) return;
	const running = [];
	for (const [platform, adapter] of Object.entries(ADAPTERS)) {
		if (adapter.timing !== 'slot') continue;
		if (!dry && !adapter.ready(config)) continue;
		if (listing.has(platform)) continue;
		listing.add(platform);

		const work = (async () => {
			let targets = [];
			try {
				const dueBy = dry ? null : new Date(Date.now() + adapter.lead(config) * 1000);
				targets = await pb.pendingTargets(platform, dueBy);
			} catch (err) {
				log(`${platform} pass failed: ${err instanceof Error ? err.message : err}`);
				return;
			} finally {
				listing.delete(platform);
			}

			const lanes = new Map();
			for (const target of targets) {
				const key = `${platform}:${target.account ?? ''}`;
				if (!lanes.has(key)) lanes.set(key, []);
				lanes.get(key).push(target);
			}
			const started = [];
			for (const [key, rows] of lanes) {
				if (busy.has(key)) continue;
				busy.add(key);
				log(`${rows.length} ${dry ? 'pending' : 'due'} for ${platform}`);
				started.push(
					(async () => {
						try {
							for (const target of rows) await handle(pb, config, platform, target);
						} catch (err) {
							log(`${platform} pass failed: ${err instanceof Error ? err.message : err}`);
						} finally {
							busy.delete(key);
						}
					})()
				);
			}
			await Promise.all(started);
		})();
		running.push(work);
	}
	if (wait) await Promise.all(running);
}

/**
 * The accounts each platform posts as, written to the `accounts` collection
 * for Settings and the compose screen — each on its own timer.
 */
async function accountPass(pb, config) {
	if (!hb.canPublish()) return;
	if (hasYouTube(config)) {
		await refreshYouTubeChannels(pb, config, log).catch((err) => log(`youtube: ${err.message}`));
	}
	if (hasTikTok(config)) {
		await refreshTikTokCreators(pb, config, log).catch((err) => log(`tiktok: ${err.message}`));
	}
	if (hasInstagram(config)) {
		await refreshInstagramAccounts(pb, config, log).catch((err) => log(`instagram: ${err.message}`));
	}
	if (hasFacebook(config)) {
		await refreshFacebookPages(pb, config, log).catch((err) => log(`facebook: ${err.message}`));
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
				await inJob(row.job, () =>
					settleOrphan(pb, config, platform, row).catch((err) =>
						log(`could not check ${platform} ${row.id} with the platform: ${err.message.split('\n')[0]} — asking again later`)
					)
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
	let verdict = decide({
		handle,
		probe,
		alive,
		now: Date.now(),
		slotAt: row.scheduled_at,
		seen: orphanSeen.get(row.id)
	});
	// Processed but never posted, and moved to another brand since: the old
	// account must not post it now. Queued again, the move pass moves it.
	if (verdict.action === 'publish' && row.move) {
		verdict = { action: 'requeue', reason: 'it was moved to another account before it was posted' };
	}

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
			if (platform === 'youtube') log('  its thumbnail, playlist and paid promotion, if any, may not have been applied');
			await recordResult(pb, platform, row, probe.result, label);
		} else if (verdict.action === 'publish') {
			log(`${label} was processed but never published — publishing it now`);
			const result = await hb.track(`Publishing to ${NAMES[platform]}: "${row.title || row.id}"`, () => adapter.publishReady(config, handle, row), {
				publishing: true
			});
			await recordResult(pb, platform, row, result, label);
		}
	} finally {
		inHand.delete(row.id);
	}

	if (handle?.coverPhotoId) {
		await dropHostedCover(config, handle).catch((err) =>
			log(`cover photo ${handle.coverPhotoId} could not be deleted from the Page (${err.message.split('\n')[0]})`)
		);
	}
}

let movesBusy = false;
let movesOff = false;
/** Moves already said to be waiting, so that is said once. */
const moveSaid = new Set();

/**
 * Carries out the moves to another brand the page asked for (moves.mjs). The
 * worker that publishes does it: it holds the tokens a delete needs, and it
 * is the one claiming rows. On the slot tick, so a move is done in seconds.
 */
async function movePass(pb, config) {
	if (movesBusy || movesOff || dry || !hb.canPublish()) return;
	movesBusy = true;
	try {
		let rows;
		try {
			rows = await pb.movingTargets();
		} catch (err) {
			// A PocketBase without the field (setup-pb not run since): nothing
			// can have asked for a move, so this stops asking.
			if (!/ -> 400\b/.test(err.message)) throw err;
			movesOff = true;
			log('moving posts to another brand is off: upload_targets has no `move` field — run pnpm setup-pb');
			return;
		}
		for (const row of rows) {
			if (!hb.canPublish()) break;
			await inJob(row.job, () =>
				moveOne(pb, config, row).catch((err) => log(`could not move ${row.platform} ${row.id}: ${err.message.split('\n')[0]}`))
			);
		}
	} finally {
		movesBusy = false;
	}
}

async function moveOne(pb, config, row) {
	const step = moveStep(row, { held: inHand.has(row.id) });
	if (step.action === 'none') return;
	const { move } = step;
	const name = NAMES[row.platform] ?? row.platform;
	const title = row.title || row.description?.slice(0, 60) || row.id;
	const label = `${row.platform} "${title}"`;
	const to = move.toName || move.to;

	if (step.action === 'wait') {
		if (!moveSaid.has(row.id)) log(`moving ${label} to ${move.brandName} once it is no longer being published`);
		moveSaid.add(row.id);
		return;
	}

	if (step.action === 'drop') {
		moveSaid.delete(row.id);
		await pb.updateTarget(row.id, { move: null });
		log(`not moving ${label} to ${move.brandName}: ${step.reason}`);
		pb.log(`Not moved: ${name}`, `${title}: ${step.reason}.`);
		return;
	}

	if (step.action === 'switch') {
		moveSaid.delete(row.id);
		await pb.updateTarget(row.id, { account: move.to, move: null });
		log(`${label} now goes out as ${to} (${move.brandName})`);
		pb.log(`Moved ${name} to ${move.brandName}`, `${title}: nothing had been sent yet; it goes out as ${to}.`);
		return;
	}

	if (step.action === 'repost') {
		moveSaid.delete(row.id);
		await pb.updateTarget(row.id, requeuePatch(move.to));
		log(`${label} queued again as ${to} (${move.brandName}); the old post stays up until it is deleted by hand: ${row.remote_url}`);
		pb.log(
			`Moved ${name} to ${move.brandName}`,
			`${title}: posted again as ${to}. The post on the old account is still up — delete it in ${name}: ${row.remote_url}`
		);
		return;
	}

	// replace: off the old account first, and queued again only once it is
	// gone — never both up at once.
	const adapter = ADAPTERS[row.platform];
	if (!adapter?.remove || !adapter.ready(config)) {
		if (!moveSaid.has(row.id)) log(`moving ${label}: ${name} is not set up here, so its post cannot be deleted — waiting`);
		moveSaid.add(row.id);
		return;
	}
	moveSaid.delete(row.id);
	let removed;
	inHand.add(row.id);
	try {
		removed = await hb.track(`Deleting from ${name}: "${title}"`, () => adapter.remove(config, row.account ?? '', step.remoteId), {
			publishing: true
		});
	} catch (err) {
		const why = err instanceof Error ? err.message.split('\n')[0] : String(err);
		await pb.updateTarget(row.id, {
			move: null,
			error: `Not moved to ${move.brandName}: it could not be deleted from ${name} — ${why}`.slice(0, 1900)
		});
		log(`could not move ${label} to ${move.brandName}: deleting it failed — ${why}`);
		pb.log(`Move failed: ${name}`, `${title}: it could not be deleted from the old account, so it stays there as it was. ${why}`);
		return;
	} finally {
		inHand.delete(row.id);
	}
	await pb.updateTarget(row.id, requeuePatch(move.to));
	const what = removed?.alreadyGone ? 'was already gone from' : 'deleted from';
	const where = removed?.channel || removed?.page || 'the old account';
	log(`${label} ${what} ${where} (${row.remote_url}) — queued again for ${to} (${move.brandName})`);
	pb.log(`Moved ${name} to ${move.brandName}`, `${title}: ${what} ${where} (${row.remote_url}) and queued again for ${to}.`);
	// Its numbers belong to a video that is gone; the stats passes no longer see it.
	if (row.platform === 'youtube') await pb.forgetVideoStats(step.remoteId).catch(() => {});
	if (row.platform === 'facebook') await pb.forgetPostStats('facebook', step.remoteId).catch(() => {});
}

/* ---- new times for posts a platform holds (reschedule.mjs) ---- */

let reschedulesBusy = false;
/** When each row's held time was last asked for, so an unreachable platform is asked every ten minutes, not every tick. */
const learnAsked = new Map();
const LEARN_EVERY_MS = 10 * 60_000;

const shortWhen = (iso) =>
	new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Tells YouTube and Facebook of posts moved in the Calendar. The worker that
 * publishes does it, on the slot tick, so a move reaches the platform within
 * seconds of the drop.
 */
async function reschedulePass(pb, config) {
	if (reschedulesBusy || dry || !hb.canPublish()) return;
	reschedulesBusy = true;
	try {
		const rows = await pb.scheduledTargets(SYNC_PLATFORMS, new Date(Date.now() - 86_400_000));
		for (const row of rows) {
			if (!hb.canPublish()) break;
			const adapter = ADAPTERS[row.platform];
			if (!adapter?.reschedule || !adapter.ready(config)) continue;
			const step = rescheduleStep(row, { held: inHand.has(row.id) });
			if (step.action === 'none') continue;
			await inJob(row.job, () =>
				rescheduleOne(pb, config, adapter, row, step).catch((err) =>
					log(`could not reschedule ${row.platform} ${row.id}: ${err.message.split('\n')[0]}`)
				)
			);
		}
	} finally {
		reschedulesBusy = false;
	}
}

async function rescheduleOne(pb, config, adapter, row, step) {
	const name = NAMES[row.platform] ?? row.platform;
	const title = row.title || row.description?.slice(0, 60) || row.id;
	const label = `${row.platform} "${title}"`;

	if (step.action === 'learn') {
		if (Date.now() - (learnAsked.get(row.id) ?? 0) < LEARN_EVERY_MS) return;
		learnAsked.set(row.id, Date.now());
		const held = await adapter.release(config, row);
		const handle = row.handle && typeof row.handle === 'object' ? row.handle : {};
		await pb.updateTarget(row.id, { handle: held.out ? { ...handle, released: true } : { ...handle, release: held.at } });
		learnAsked.delete(row.id);
		return;
	}

	const from = row.handle.release;
	if (step.action === 'refuse') {
		await pb.updateTarget(row.id, { scheduled_at: from, handle: refusedHandle(row.handle, `Not moved: ${step.reason}.`) });
		log(`not moving ${label} on ${name}: ${step.reason} — it stays at ${shortWhen(from)}`);
		pb.log(`Not moved on ${name}`, `${title}: ${step.reason}. It stays at ${shortWhen(from)}.`);
		return;
	}

	inHand.add(row.id);
	try {
		const done = await hb.track(`Moving on ${name}: "${title}"`, () => adapter.reschedule(config, row, step.to), {
			publishing: true
		});
		const release = done?.release ? new Date(done.release).toISOString() : step.to;
		await pb.updateTarget(row.id, { handle: movedHandle(row.handle, release) });
		log(`${label} moved on ${name}: ${shortWhen(from)} -> ${shortWhen(release)}`);
		pb.log(`Moved on ${name}`, `${title}: ${shortWhen(from)} → ${shortWhen(release)}.`);
	} catch (err) {
		const why = (err instanceof Error ? err.message : String(err)).split('\n')[0];
		await pb.updateTarget(row.id, {
			scheduled_at: from,
			handle: refusedHandle(row.handle, `Not moved: ${name} did not take the new time — ${why}`.slice(0, 500))
		});
		log(`could not move ${label} on ${name}: ${why} — it stays at ${shortWhen(from)}`);
		pb.log(`Not moved on ${name}`, `${title}: ${why}. It stays at ${shortWhen(from)}.`);
	} finally {
		inHand.delete(row.id);
	}
}

/* ---- releases and deletes asked for in the Calendar (requests.mjs) ---- */

let requestsBusy = false;
let requestsOff = false;
const requestSaid = new Set();

async function requestPass(pb, config) {
	if (requestsBusy || requestsOff || dry || !hb.canPublish()) return;
	requestsBusy = true;
	try {
		let rows;
		try {
			rows = await pb.requestedTargets();
		} catch (err) {
			// A PocketBase without the field (setup-pb not run since): nothing
			// can have asked, so this stops asking.
			if (!/ -> 400\b/.test(err.message)) throw err;
			requestsOff = true;
			log('releases and deletes from the Calendar are off: upload_targets has no `request` field — run pnpm setup-pb');
			return;
		}
		for (const row of rows) {
			if (!hb.canPublish()) break;
			await inJob(row.job, () =>
				requestOne(pb, config, row).catch((err) => log(`could not carry out the request on ${row.platform} ${row.id}: ${err.message.split('\n')[0]}`))
			);
		}
	} finally {
		requestsBusy = false;
	}
}

async function requestOne(pb, config, row) {
	const step = requestStep(row, { held: inHand.has(row.id) });
	if (step.action === 'none') return;
	const name = NAMES[row.platform] ?? row.platform;
	const title = row.title || row.description?.slice(0, 60) || row.id;
	const label = `${row.platform} "${title}"`;
	const deleting = step.request.kind === 'delete';
	const when = row.scheduled_at ? shortWhen(String(row.scheduled_at).replace(' ', 'T')) : 'its slot';
	const nowIso = () => new Date().toISOString();

	if (step.action === 'wait') {
		if (!requestSaid.has(row.id)) log(`${deleting ? 'deleting' : 'releasing'} ${label} once it is no longer being published`);
		requestSaid.add(row.id);
		return;
	}
	requestSaid.delete(row.id);

	if (step.action === 'drop') {
		await pb.updateTarget(row.id, {
			request: null,
			handle: refusedHandle(row.handle, `Not ${deleting ? 'deleted' : 'released'}: ${step.reason}.`)
		});
		log(`not ${deleting ? 'deleting' : 'releasing'} ${label}: ${step.reason}`);
		pb.log(`Not ${deleting ? 'deleted' : 'released'}: ${name}`, `${title}: ${step.reason}.`);
		return;
	}

	if (step.action === 'forget') {
		await pb.deleteTarget(row.id);
		log(`${label} deleted (it was not on ${name} yet)`);
		pb.log(`Deleted ${name}`, `${title}: it was not on ${name} yet, so only flock's post went.`);
		return;
	}

	if (step.action === 'now') {
		await pb.updateTarget(row.id, { scheduled_at: nowIso(), request: null });
		log(`${label} goes out now instead of at ${when}`);
		pb.log(`Released ${name} now`, `${title}: out now instead of at ${when}.`);
		return;
	}

	const adapter = ADAPTERS[row.platform];
	const needs = step.action === 'publish' ? adapter?.releaseNow : adapter?.remove;
	if (!needs || !adapter.ready(config)) {
		if (!requestSaid.has(row.id)) log(`${deleting ? 'deleting' : 'releasing'} ${label}: ${name} is not set up here — waiting`);
		requestSaid.add(row.id);
		return;
	}

	inHand.add(row.id);
	try {
		if (step.action === 'publish') {
			const done = await hb.track(`Releasing on ${name}: "${title}"`, () => adapter.releaseNow(config, row), { publishing: true });
			await pb.updateTarget(row.id, { status: 'published', published_at: nowIso(), request: null });
			log(`${label} is public on ${name} now${done.alreadyOut ? ' (YouTube had put it out already)' : ''} instead of at ${when}`);
			pb.log(`Released ${name} now`, `${title}: public now instead of at ${when}. ${row.remote_url}`);
			return;
		}

		const removed = await hb.track(`Deleting from ${name}: "${title}"`, () => adapter.remove(config, row.account ?? '', step.remoteId), {
			publishing: true
		});
		const what = removed?.alreadyGone ? 'was already gone from' : 'deleted from';
		if (row.platform === 'youtube') await pb.forgetVideoStats(step.remoteId).catch(() => {});
		if (row.platform === 'facebook') await pb.forgetPostStats('facebook', step.remoteId).catch(() => {});

		if (step.action === 'resend') {
			// Facebook takes no time nearer than ten minutes: off the Page, then
			// queued again for now — never both up at once.
			await pb.updateTarget(row.id, { ...requeuePatch(row.account ?? ''), scheduled_at: nowIso(), request: null });
			log(`${label} ${what} ${name} and queued again to go out now instead of at ${when}`);
			pb.log(`Released ${name} now`, `${title}: the reel held for ${when} was ${what === 'deleted from' ? 'deleted' : 'already gone'} and goes out again now.`);
			return;
		}

		await pb.deleteTarget(row.id);
		log(`${label} ${what} ${name} (${row.remote_url}) and from flock`);
		pb.log(`Deleted ${name}`, `${title}: ${what} ${name} (${row.remote_url}); it was due ${when}.`);
	} catch (err) {
		const why = (err instanceof Error ? err.message : String(err)).split('\n')[0];
		await pb.updateTarget(row.id, {
			request: null,
			handle: refusedHandle(row.handle, `Not ${deleting ? 'deleted' : 'released'}: ${name} refused — ${why}`.slice(0, 500))
		});
		log(`could not ${deleting ? 'delete' : 'release'} ${label}: ${why}`);
		pb.log(`Not ${deleting ? 'deleted' : 'released'}: ${name}`, `${title}: ${why}. It stays as it was.`);
	} finally {
		inHand.delete(row.id);
	}
}

/**
 * The tray icon (tray.mjs), when this worker has one, and the warnings its
 * card was last told of.
 */
let tray = null;
let warned = [];
let alertBusy = false;
let alertError = '';

/** A failed post is on screen within this long — the card is a person's to see, so seconds are plenty. */
const ALERT_SECONDS = 20;

/**
 * Whether a post did not go out (alerts.mjs): reads the failed and waiting
 * posts and flock's own dismissals, leaves out what was dismissed on this PC,
 * and tells the card only when the list changed. A read that fails keeps the
 * card as it is and says so once.
 */
async function alertPass(pb, config) {
	if (!tray || alertBusy) return;
	alertBusy = true;
	try {
		const [targets, dismissedRow] = await Promise.all([
			pb.undeliveredCandidates(new Date(Date.now() - FAILED_WINDOW_MS)),
			pb.getSetting('todo_attention')
		]);
		const items = config.alerts.enabled
			? toShow(undelivered(targets), { dismissed: readDismissed(dismissedRow?.value), seen: config.alertSeen })
			: [];
		if (alertError) log('warnings: reading flock works again');
		alertError = '';
		if (sameWarnings(items, warned)) return;
		const added = items.filter((item) => !warned.some((w) => w.key === item.key));
		warned = items;
		if (items.length === 0) {
			tray.send('hide');
			return;
		}
		tray.send('show', { items: cardItems(items, config.pocketbaseUrl) });
		if (added.length) log(`warning shown: ${added.map((item) => `${item.label} "${item.title}" ${item.kind === 'failed' ? 'failed' : 'was never sent'}`).join('; ')}`);
	} catch (err) {
		const message = err.message.split('\n')[0];
		if (message !== alertError) log(`warnings: could not read flock (${message})`);
		alertError = message;
	} finally {
		alertBusy = false;
	}
}

/**
 * Ctrl-c, SIGTERM or `--stop`: a last heartbeat on the way out, so the
 * sidebar turns red and a PC worker takes over at once rather than after the
 * stale window. A second ctrl-c does not wait for it.
 */
let stopping = false;

function shutdown() {
	if (stopping) process.exit(1);
	stopping = true;
	log('stopping');
	void Promise.race([
		(hb ? hb.stop() : Promise.resolve()).then(() => remote.flush()),
		new Promise((resolve) => setTimeout(resolve, 3000))
	]).finally(() => process.exit(0));
}

/**
 * A new worker file has settled beside this one: start nothing new, let what
 * is in hand finish — an upload, a held reel, a copy — then exit, for the
 * container's restart policy to bring the worker back on the new code. A row
 * claimed in the instant before the drain is caught by the orphan check on
 * the way back up.
 */
async function restartForUpdate() {
	log('a new worker file has arrived — restarting once nothing is in hand');
	hb.drain();
	let said = false;
	while (hb.inHand() > 0 || inHand.size > 0 || busy.size > 0) {
		if (!said) {
			said = true;
			log('  waiting for the work in hand to finish first');
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	log('restarting on the new worker file');
	await Promise.race([
		hb.stop().then(() => remote.flush()),
		new Promise((resolve) => setTimeout(resolve, 3000))
	]);
	process.exit(0);
}

/** Who the platforms' tokens post as — the check that a setup worked. */
async function showAccounts(config) {
	if (checkYouTube) {
		if (!hasYouTube(config)) throw new Error('YouTube is not set up. Run:  pnpm worker:auth');
		const list = await youtubeChannels(config);
		for (const account of list) {
			log(`YouTube uploads to "${account.title}"${account.handle ? ` (${account.handle})` : ''}, channel ${account.channelId}`);
			const canEdit = await grantCanEdit(config, account).catch(() => null);
			log(
				canEdit === true
					? '  can edit after upload: adding to playlists works'
					: canEdit === false
						? '  upload-only: no playlists (pnpm worker:auth --with-playlists)'
						: '  whether it can edit after upload is unknown'
			);
		}
		for (const account of config.google.accounts.filter((a) => !a.channelId)) {
			log(`a Google grant could not be read: ${(account.problem ?? 'unknown').split('\n')[0]}`);
		}
	}
	if (checkTikTok) {
		if (!hasTikTok(config)) throw new Error('TikTok is not set up. Run:  pnpm worker:auth --tiktok');
		for (const account of config.tiktok.accounts) {
			try {
				const creator = await creatorInfo(config, account);
				log(`TikTok posts as ${creator.nickname} (@${creator.username}), open id ${account.openId}`);
				log(`  audiences offered: ${creator.privacyOptions.map(privacyLabel).join(', ') || 'none reported'}`);
				log(
					`  comments ${creator.commentDisabled ? 'off' : 'on'}, duet ${creator.duetDisabled ? 'off' : 'on'}, ` +
						`stitch ${creator.stitchDisabled ? 'off' : 'on'}; videos up to ${creator.maxDurationSeconds || '?'}s`
				);
			} catch (err) {
				log(`TikTok ${account.username ? `@${account.username}` : account.openId}: ${err.message.split('\n')[0]}`);
			}
		}
	}
	if (checkFacebook) {
		if (!hasFacebook(config)) throw new Error('Facebook is not set up. Run:  pnpm worker:auth --facebook');
		for (const entry of config.facebook.accounts) {
			try {
				const page = facebookAccount(config, entry.pageId);
				log(`Facebook posts reels to the Page "${page.pageName}" (id ${page.pageId})`);
			} catch (err) {
				log(`Facebook Page ${entry.pageName || entry.pageId}: ${err.message.split('\n')[0]}`);
			}
		}
	}
	if (checkInstagram) {
		if (!hasInstagram(config)) {
			throw new Error('Instagram is not set up. Run:  pnpm worker:auth --instagram --token');
		}
		for (const entry of config.instagram.accounts.filter(instagramReady)) {
			try {
				const account = await accountInfo({ ...entry, apiVersion: config.instagram.apiVersion });
				log(
					`Instagram posts as @${account.username} (id ${account.userId}), through the Page ` +
						`"${account.pageName}"` +
						(account.quotaTotal ? ` — ${account.quotaUsed} of ${account.quotaTotal} posts used in 24 hours` : '')
				);
			} catch (err) {
				log(`Instagram @${entry.username || entry.igUserId}: ${err.message.split('\n')[0]}`);
			}
		}
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
	// Likewise for the platforms' account checks.
	if (checkYouTube || checkTikTok || checkInstagram || checkFacebook) {
		await showAccounts(requireConfig({ needToken: false, needGoogle: false }));
		return;
	}

	// Stops the worker of this role running on this machine — the background
	// build's ctrl-c, since it has no console. See instance.mjs.
	if (stopOnly) {
		log(await askToStop(loadConfig().role));
		return;
	}

	const config = requireConfig({ needToken: !dry, needGoogle: !dry });
	const pb = makeClient(config.pocketbaseUrl);
	const live = !(once || dry || statsOnly);
	// One polling worker of a role per machine; a second leaves before it has
	// written anything. The one-shot modes may run beside a polling worker.
	if (live && !(await holdInstance(config.role, shutdown))) {
		log(`another ${config.role} worker is already running on this machine — leaving it to it`);
		// Windows starting it at sign-in beside one already running (an old
		// Startup-folder shortcut, say) is no news worth a message box.
		if (autostart) return;
		await sayOnScreen(
			`The flock worker (${config.role}) is already running on this computer, so this copy closed again. ` +
				'Only one runs at a time.\n\nIts icon is in the notification area, perhaps behind the ^ arrow. ' +
				'If flock does not show it running, end flock-worker-background.exe in Task Manager (Details) ' +
				'and start this one again.',
			{ warn: false }
		);
		return;
	}
	log(
		`worker started (${dry ? 'dry run' : once ? 'single pass' : statsOnly ? 'stats only' : 'polling'}, ` +
			`role ${config.role}, ${WORKER_VERSION === 'dev' ? 'dev' : `v${WORKER_VERSION}`}, pid ${process.pid})`
	);
	remote.attach(pb);
	// A PC worker covers for the NAS one only with credentials of its own.
	const covers = coversNas(config.role, hasYouTube(config) || hasTikTok(config) || hasInstagram(config));
	hb = makeHeartbeat({
		pb,
		role: config.role,
		run,
		log,
		live,
		covers,
		onStartPublishing: () => orphanPass(pb, config).catch((err) => log(`orphan check failed: ${err.message}`))
	});

	// The background executable's icon, its way to be seen and stopped — see
	// tray.mjs. Up before PocketBase answers, so it is there while the worker
	// waits for the network at boot, rather than nothing at all.
	// It also carries the warning card for a post that did not go out, its
	// settings window and Start with Windows (alerts.mjs).
	if (live && wantsTray()) {
		if (autostart) log('started by Windows at sign-in');
		tray = startTray({
			title: `flock worker${WORKER_VERSION === 'dev' ? '' : ` v${WORKER_VERSION}`} (${config.role})`,
			url: `${config.pocketbaseUrl}/`,
			logPath: exeLogPath(),
			// Only the executable can be started by Windows; `pnpm worker` is a script.
			exePath: isSea() ? process.execPath : '',
			runName: runName(config.role),
			settings: config.alerts,
			log,
			onStop: shutdown,
			onDismiss: (keys) => {
				config.alertSeen = addSeen(config.alertSeen, keys);
				saveSection('alerts', { seen: config.alertSeen });
				warned = warned.filter((item) => !keys.includes(item.key));
				log(`warning dismissed on this PC (${keys.length} post${keys.length === 1 ? '' : 's'}); they stay in flock's To finish`);
			},
			onSettings: (settings) => {
				config.alerts = readAlertSettings(settings);
				saveSection('alerts', config.alerts);
				log(
					`warning settings saved: ${config.alerts.enabled ? 'on' : 'off'}, ${config.alerts.screen} screen, ` +
						`${config.alerts.position}, ${config.alerts.size}`
				);
				// Tell the card again, in its new place and look.
				warned = [];
				void alertPass(pb, config);
			}
		});
	}

	// Started at boot, or straight after a resume, the NAS or the Tailscale link
	// to it may not be up yet. Waiting beats dying on the first probe; the
	// one-shot modes fail fast, since there somebody is watching.
	for (let attempt = 1; ; attempt++) {
		try {
			await pb.health();
			break;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (once || dry || statsOnly) throw err;
			if (attempt >= 30) {
				throw new Error(
					`${message}\nGave up after five minutes. Check that this machine can open flock in a browser ` +
						'at that address, then start the worker again.'
				);
			}
			log(`${message} — retrying in 10s (${attempt}/30)`);
			await new Promise((resolve) => setTimeout(resolve, 10_000));
		}
	}
	log(`PocketBase ok at ${config.pocketbaseUrl}`);
	if (config.role === 'local' && !covers) {
		log('adapters: none here — publishing is the NAS worker\'s, and this one does the PC\'s own jobs only');
	} else {
		log(
			'adapters: ' +
				Object.entries(ADAPTERS)
					.map(([platform, adapter]) => (adapter.ready(config) ? platform : `${platform} (not set up)`))
					.join(', ')
		);
		if (covers) log('covers for the NAS worker while it is down, with the credentials in this config');
	}

	// Reads only, so it goes before the stale-row recovery: a stats check must
	// not touch the publishing queue.
	if (statsOnly) {
		await statsPass({ pb, config, log, every: true });
		if (hasInstagram(config)) await instagramStatsPass({ pb, config, log });
		if (hasFacebook(config)) await facebookStatsPass({ pb, config, log });
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
		await movePass(pb, config);
		await reschedulePass(pb, config);
		await requestPass(pb, config);
		await pass(pb, config);
		await slotPass(pb, config, { wait: true });
		await archivePass(pb);
		log('single pass complete');
		return;
	}

	log(
		`polling every ${config.pollSeconds}s, slots every ${config.slotSeconds}s, ` +
			`scoring every ${config.scoreSeconds}s — ctrl-c or --stop to stop`
	);

	await hb.start();
	for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);

	// The warning card: every worker with a tray icon looks, whatever its role,
	// so whichever PC runs flock's worker shows it.
	if (tray) {
		log(`warnings: ${config.alerts.enabled ? `on, ${config.alerts.screen} screen, ${config.alerts.position}` : 'off'} — set from the tray icon`);
		void alertPass(pb, config);
		setInterval(() => void alertPass(pb, config), ALERT_SECONDS * 1000);
	}

	// Project folders are watched, so a new flock.json is listed within a
	// second or two; each scan of a kind says which folders (folderwatch.mjs).
	folderWatcher = makeFolderWatcher({
		onChange: (kind) =>
			void scanKind(pb, kind, { quiet: true }).catch((err) =>
				log(`${kind === 'network' ? 'LAN' : 'local'} folder scan failed: ${err.message.split('\n')[0]}`)
			)
	});

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

	// A worker in a container restarts on a new bundle — see selfupdate.mjs.
	if (process.env.FLOCK_RESTART_ON_UPDATE === '1' && process.argv[1]) {
		log(`restarts itself when ${basename(process.argv[1])} is replaced`);
		watchForUpdate({ file: process.argv[1], onReady: () => void restartForUpdate() });
	}

	// Same reason as scoring: an upload can hold the main loop for many
	// minutes, and the Analytics screen should not go stale for the duration.
	// `busy` stops a slow poll overlapping the next tick. A PC worker that
	// never covers never reads them.
	if (config.statsSeconds > 0 && (ownsPublishing(config.role) || covers)) {
		if (!ownsPublishing(config.role)) log('stats run here only while covering for the NAS worker');
		const count = config.google.accounts.length;
		log(
			`stats: newest ${config.statsVideos} videos ` +
				(count > 1
					? `of each of ${count} channels, one every ${config.statsSeconds}s in turn, `
					: `every ${config.statsSeconds}s, `) +
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

	// Instagram's views, on their own slower tick and by the same workers.
	if (config.igStatsSeconds > 0 && hasInstagram(config) && (ownsPublishing(config.role) || covers)) {
		log(`instagram stats: newest ${config.igStatsPosts} posts of each account every ${config.igStatsSeconds}s`);
		let igBusy = false;
		const igTick = async () => {
			if (igBusy || !hb.canPublish()) return;
			igBusy = true;
			try {
				await instagramStatsPass({ pb, config, log });
			} catch (err) {
				log(`instagram stats pass failed: ${err.message.split('\n')[0]}`);
			} finally {
				igBusy = false;
			}
		};
		void igTick();
		setInterval(() => void igTick(), Math.max(60, config.igStatsSeconds) * 1000);
	}

	// Facebook's reels, likewise: every Page's views, likes and comments.
	if (config.fbStatsSeconds > 0 && hasFacebook(config) && (ownsPublishing(config.role) || covers)) {
		log(`facebook stats: newest ${config.fbStatsPosts} reels of each Page every ${config.fbStatsSeconds}s`);
		let fbBusy = false;
		const fbTick = async () => {
			if (fbBusy || !hb.canPublish()) return;
			fbBusy = true;
			try {
				await facebookStatsPass({ pb, config, log });
			} catch (err) {
				log(`facebook stats pass failed: ${err.message.split('\n')[0]}`);
			} finally {
				fbBusy = false;
			}
		};
		void fbTick();
		setInterval(() => void fbTick(), Math.max(60, config.fbStatsSeconds) * 1000);
	}

	// Its own interval rather than a counter inside the main loop: an upload can
	// hold that loop for many minutes, and a score request must not queue behind
	// one.
	setInterval(() => {
		void scorePass(pb, config).catch((err) => log(`score pass failed: ${err.message}`));
		void folderPickPass(pb).catch((err) => log(`folder pick failed: ${err.message}`));
		void fileRequestPass(pb).catch((err) => log(`image request failed: ${err.message.split('\n')[0]}`));
		void creatorCheckPass(pb, config).catch((err) => log(`TikTok account check failed: ${err.message.split('\n')[0]}`));
		void importPass(pb, config).catch((err) => log(`import pass failed: ${err.message.split('\n')[0]}`));
	}, Math.max(1, config.scoreSeconds) * 1000);

	// The hold-and-fire platforms, on their own tighter tick — see slotPass.
	// The account refreshes ride on it too; each keeps its own half-hour timer.
	const slotTick = () => {
		void accountPass(pb, config);
		void slotPass(pb, config);
		void orphanPass(pb, config).catch((err) => log(`orphan check failed: ${err.message}`));
		void movePass(pb, config).catch((err) => log(`move pass failed: ${err.message.split('\n')[0]}`));
		void reschedulePass(pb, config).catch((err) => log(`reschedule pass failed: ${err.message.split('\n')[0]}`));
		void requestPass(pb, config).catch((err) => log(`request pass failed: ${err.message.split('\n')[0]}`));
		void archivePass(pb).catch((err) => log(`project rename failed: ${err.message.split('\n')[0]}`));
		void nudgeMain(pb, config).catch(() => {});
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
		await sleepMain(config.pollSeconds * 1000);
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
		await sayOnScreen(`The flock worker has stopped.\n\n${message}`);
		process.exit(1);
	});
