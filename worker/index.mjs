#!/usr/bin/env node
// The publishing worker.
//
//   pnpm worker         poll forever
//   pnpm worker:once    one pass, then exit
//   pnpm worker:dry     one pass, reporting what it would do, uploading nothing
//   pnpm worker:vidiq   check the vidIQ key, spending no credits
//
// Belongs on the NAS beside PocketBase, not in the SPA: it holds an OAuth
// client secret, and it has to keep running when no browser is open.

import { requireConfig } from './config.mjs';
import { makeClient } from './pb.mjs';
import { publishToYouTube } from './youtube.mjs';
import { copyToDestination } from './archive.mjs';
import { scanWatchFolder } from './watch.mjs';
import { scoreTitle, listTools } from './vidiq.mjs';

// One entry per platform that can actually publish. The loop iterates this
// rather than picking up everything `pending`, so the three platforms without
// an adapter are left alone instead of being marked failed.
const ADAPTERS = { youtube: publishToYouTube };

const once = process.argv.includes('--once');
const dry = process.argv.includes('--dry');
const checkVidiq = process.argv.includes('--vidiq');

function stamp() {
	return new Date().toLocaleTimeString();
}

function log(message) {
	console.log(`[${stamp()}] ${message}`);
}

async function handle(pb, config, platform, target) {
	const label = `${platform} "${target.title || target.description?.slice(0, 40) || target.id}"`;

	if (dry) {
		log(`would publish ${label}, scheduled ${target.scheduled_at}`);
		return;
	}

	// Claim before starting, so a second pass cannot pick up the same row while
	// its upload is in flight.
	await pb.updateTarget(target.id, { status: 'publishing', error: '' });
	log(`claimed ${label}`);

	try {
		const job = await pb.getJob(target.job);
		const result = await ADAPTERS[platform]({
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
 * Publishes what is sitting in the watch folder so the compose screen can list
 * it. The folder is configured in the SPA, so it is read back out of settings
 * each pass rather than duplicated into the worker's own config.
 */
async function watchPass(pb) {
	const row = await pb.getSetting('general');
	const folder = row?.value?.watchFolder?.trim() ?? '';
	if (!folder) return;

	const index = await scanWatchFolder(folder);
	if (!index) return;

	await pb.setSetting('watch_index', index);
	if (index.error) log(`watch folder: ${index.error}`);
	else log(`watch folder: ${index.files.length} video(s) in ${index.folder}`);
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

async function pass(pb, config) {
	await watchPass(pb);
	await copyPass(pb);

	for (const platform of Object.keys(ADAPTERS)) {
		const targets = await pb.pendingTargets(platform);
		if (targets.length === 0) continue;
		log(`${targets.length} pending for ${platform}`);
		for (const target of targets) {
			await handle(pb, config, platform, target);
		}
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

	const config = requireConfig({ needToken: !dry, needGoogle: !dry });
	const pb = makeClient(config.pocketbaseUrl);

	await pb.health();
	log(`PocketBase ok at ${config.pocketbaseUrl}`);
	log(`adapters: ${Object.keys(ADAPTERS).join(', ')}`);

	if (!dry) await recoverStale(pb);

	if (once || dry) {
		await scorePass(pb, config);
		await pass(pb, config);
		log('single pass complete');
		return;
	}

	log(`polling every ${config.pollSeconds}s, scoring every ${config.scoreSeconds}s — ctrl-c to stop`);

	// Its own interval rather than a counter inside the main loop: an upload can
	// hold that loop for many minutes, and a score request must not queue behind
	// one.
	setInterval(() => {
		void scorePass(pb, config).catch((err) => log(`score pass failed: ${err.message}`));
	}, Math.max(1, config.scoreSeconds) * 1000);
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
