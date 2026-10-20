// A cover image for TikTok. Its Direct Post API takes no picture — only a
// moment in the video (`video_cover_timestamp_ms`) — so the image is put
// into the video itself: held for a fraction of a second at the end (the
// default) or the beginning, and the cover time pointed at the middle of
// it. Held, not one frame, because TikTok re-encodes uploads and could drop
// or merge a lone frame. The end leaves the opening seconds — where TikTok
// judges whether people stay — untouched; viewers who reach the end see it
// flash before the loop.
//
// It needs ffmpeg and ffprobe: `ffmpegPath` in the config or FLOCK_FFMPEG,
// else an `ffmpeg` beside the config (the NAS container's /config), else the
// PATH. Without them, or on any failure, the post goes out as before — the
// frame at the cover time — and says why.

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, posix, win32 } from 'node:path';
import { pipeline } from 'node:stream/promises';

/** How long the image is held, in seconds. */
export const HOLD_SECONDS = 0.2;

/** Where the image goes: TikTok's end of the video by default. */
export function placementOf(options) {
	return options?.coverImageAt === 'start' ? 'start' : 'end';
}

/** The ffmpeg binaries to try, first that answers wins. */
export function toolCandidates({ config = {}, env = {}, configPath = '', platform = process.platform } = {}) {
	const exe = platform === 'win32' ? '.exe' : '';
	const path = platform === 'win32' ? win32 : posix;
	const out = [];
	const given = config.ffmpegPath || env.FLOCK_FFMPEG;
	if (given) out.push(given);
	if (configPath) out.push(path.join(path.dirname(configPath), `ffmpeg${exe}`));
	out.push(`ffmpeg${exe}`);
	return [...new Set(out)];
}

/** ffprobe beside a given ffmpeg (same folder, same naming), or by name on the PATH. */
export function probeFor(ffmpeg) {
	const name = basename(ffmpeg);
	return ffmpeg.slice(0, ffmpeg.length - name.length) + name.replace(/^ffmpeg/i, 'ffprobe');
}

/** Runs a tool to its end: { code, stdout, stderr }; never throws for a non-zero exit. */
function run(cmd, args, { timeoutMs = 15 * 60_000 } = {}) {
	return new Promise((resolve, reject) => {
		let child;
		try {
			child = spawn(cmd, args, { windowsHide: true });
		} catch (err) {
			reject(err);
			return;
		}
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (d) => (stdout += d));
		child.stderr.on('data', (d) => {
			stderr += d;
			if (stderr.length > 20_000) stderr = stderr.slice(-10_000);
		});
		const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
		child.on('error', (err) => {
			clearTimeout(timer);
			reject(err);
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve({ code, stdout, stderr });
		});
	});
}

let found = null;
let foundAt = 0;

/** The first ffmpeg that answers `-version`, with its ffprobe; null without one. Re-looked-for every ten minutes while missing. */
export async function findTools(config, configPath) {
	if (found && found.ffmpeg) return found;
	if (found && Date.now() - foundAt < 10 * 60_000) return null;
	foundAt = Date.now();
	for (const ffmpeg of toolCandidates({ config, env: process.env, configPath })) {
		if (ffmpeg.includes('/') || ffmpeg.includes('\\')) {
			if (!existsSync(ffmpeg)) continue;
		}
		try {
			const a = await run(ffmpeg, ['-version'], { timeoutMs: 15_000 });
			const b = await run(probeFor(ffmpeg), ['-version'], { timeoutMs: 15_000 });
			if (a.code === 0 && b.code === 0) {
				found = { ffmpeg, ffprobe: probeFor(ffmpeg) };
				return found;
			}
		} catch {
			// Not there; try the next.
		}
	}
	found = { ffmpeg: null };
	return null;
}

/**
 * What the video is, from ffprobe's JSON: the size it shows (a phone's
 * rotation turns width and height), its frame rate as ffprobe writes it,
 * its audio (rate and layout, or none) and its length in seconds.
 */
export function readProbe(json) {
	const streams = Array.isArray(json?.streams) ? json.streams : [];
	const video = streams.find((s) => s.codec_type === 'video');
	if (!video || !video.width || !video.height) throw new Error('ffprobe found no video stream');
	const audio = streams.find((s) => s.codec_type === 'audio');
	const rotation = Number(
		video.tags?.rotate ?? (video.side_data_list ?? []).find((d) => d.rotation !== undefined)?.rotation ?? 0
	);
	const turned = Math.abs(rotation) % 180 === 90;
	const rate = /^\d+(\/\d+)?$/.test(String(video.r_frame_rate)) && video.r_frame_rate !== '0/0' ? video.r_frame_rate : '30';
	const channels = Number(audio?.channels) || 0;
	return {
		width: turned ? video.height : video.width,
		height: turned ? video.width : video.height,
		rate,
		audio: audio
			? {
					sampleRate: Number(audio.sample_rate) || 44100,
					layout: audio.channel_layout || (channels === 1 ? 'mono' : 'stereo')
				}
			: null,
		duration: Number(json?.format?.duration ?? video.duration) || 0
	};
}

/**
 * ffmpeg's arguments: the video, the image held `hold` seconds at the
 * chosen end (scaled into the video's frame, black around it), silence
 * under it, joined and encoded once. One encode keeps every part's format
 * the same, which a stream-copied join could not promise.
 */
export function coverArgs({ input, image, out, probe, at, hold = HOLD_SECONDS }) {
	const { width: w, height: h, rate, audio } = probe;
	const look = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${rate},format=yuv420p`;
	const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-loop', '1', '-framerate', String(rate), '-t', String(hold), '-i', image];
	const filters = [`[0:v]scale=${w}:${h},setsar=1,fps=${rate},format=yuv420p[vid]`, `[1:v]${look}[img]`];
	let parts;
	if (audio) {
		args.push('-f', 'lavfi', '-t', String(hold), '-i', `anullsrc=r=${audio.sampleRate}:cl=${audio.layout}`);
		const norm = `aresample=${audio.sampleRate},aformat=sample_fmts=fltp:channel_layouts=${audio.layout}`;
		filters.push(`[0:a]${norm}[va]`, `[2:a]${norm}[ia]`);
		parts = at === 'start' ? '[img][ia][vid][va]' : '[vid][va][img][ia]';
		filters.push(`${parts}concat=n=2:v=1:a=1[v][a]`);
		args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[a]', '-c:a', 'aac', '-b:a', '192k');
	} else {
		parts = at === 'start' ? '[img][vid]' : '[vid][img]';
		filters.push(`${parts}concat=n=2:v=1:a=0[v]`);
		args.push('-filter_complex', filters.join(';'), '-map', '[v]');
	}
	args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-movflags', '+faststart', out);
	return args;
}

/** The cover time, in ms: the middle of the image's hold, at the start or at the end of the finished video. */
export function coverTimestamp(duration, at, hold = HOLD_SECONDS) {
	return at === 'start' ? Math.round((hold / 2) * 1000) : Math.max(0, Math.round((duration - hold / 2) * 1000));
}

async function probeFile(ffprobe, file) {
	const res = await run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { timeoutMs: 60_000 });
	if (res.code !== 0) throw new Error(`ffprobe could not read it (${res.stderr.trim().split('\n').at(-1) || res.code})`);
	return readProbe(JSON.parse(res.stdout));
}

/**
 * The video with the image put in, in a temp folder: { path, size,
 * duration, coverMs, cleanup }. `video` is an open stream ({ stream }) and
 * `image` the cover's bytes. Throws with a reason in words; the caller
 * posts the original then.
 */
export async function makeCoverVideo({ tools, video, image, imageType, at }) {
	const dir = await mkdtemp(join(tmpdir(), 'flock-tiktok-'));
	const cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => {});
	try {
		const input = join(dir, 'in.video');
		const pic = join(dir, imageType === 'image/png' ? 'cover.png' : 'cover.jpg');
		const out = join(dir, 'out.mp4');
		await pipeline(video.stream, createWriteStream(input));
		await writeFile(pic, image);
		const probe = await probeFile(tools.ffprobe, input);
		const res = await run(tools.ffmpeg, coverArgs({ input, image: pic, out, probe, at }));
		if (res.code !== 0) throw new Error(`ffmpeg failed (${res.stderr.trim().split('\n').at(-1) || `exit ${res.code}`})`);
		const made = await probeFile(tools.ffprobe, out);
		const { size } = await stat(out);
		return { path: out, size, duration: made.duration, coverMs: coverTimestamp(made.duration, at), cleanup };
	} catch (err) {
		await cleanup();
		throw err;
	}
}
