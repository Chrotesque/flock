import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOLD_SECONDS, coverArgs, coverTimestamp, placementOf, probeFor, readProbe, toolCandidates } from './tiktokcover.mjs';

test('the image goes at the end unless the post says the beginning', () => {
	assert.equal(placementOf({}), 'end');
	assert.equal(placementOf({ coverImageAt: 'end' }), 'end');
	assert.equal(placementOf({ coverImageAt: 'start' }), 'start');
	assert.equal(placementOf(undefined), 'end');
});

test('ffmpeg is looked for where it is set, beside the config, then on the PATH', () => {
	assert.deepEqual(toolCandidates({ config: { ffmpegPath: '/opt/ffmpeg' }, configPath: '/config/.worker-config.json', platform: 'linux' }), [
		'/opt/ffmpeg',
		'/config/ffmpeg',
		'ffmpeg'
	]);
	assert.deepEqual(toolCandidates({ env: { FLOCK_FFMPEG: 'C:\\tools\\ffmpeg.exe' }, platform: 'win32' })[0], 'C:\\tools\\ffmpeg.exe');
	assert.deepEqual(toolCandidates({ platform: 'win32' }), ['ffmpeg.exe']);
	assert.equal(probeFor('/config/ffmpeg'), '/config/ffprobe');
	assert.equal(probeFor('ffmpeg.exe'), 'ffprobe.exe');
	assert.equal(probeFor('ffmpeg'), 'ffprobe');
});

const stream = (extra) => ({ codec_type: 'video', width: 1080, height: 1920, r_frame_rate: '30/1', ...extra });

test("ffprobe's answer: the size shown, the rate, the audio and the length", () => {
	const probe = readProbe({
		streams: [stream(), { codec_type: 'audio', sample_rate: '48000', channels: 2, channel_layout: 'stereo' }],
		format: { duration: '27.433' }
	});
	assert.deepEqual(probe, { width: 1080, height: 1920, rate: '30/1', audio: { sampleRate: 48000, layout: 'stereo' }, duration: 27.433 });
});

test("a phone's rotation turns the size, and a silent video has no audio", () => {
	const turned = readProbe({ streams: [stream({ width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] })], format: { duration: '5' } });
	assert.equal(turned.width, 1080);
	assert.equal(turned.height, 1920);
	assert.equal(turned.audio, null);
	const mono = readProbe({ streams: [stream({ r_frame_rate: '0/0' }), { codec_type: 'audio', channels: 1 }], format: {} });
	assert.equal(mono.rate, '30');
	assert.deepEqual(mono.audio, { sampleRate: 44100, layout: 'mono' });
	assert.throws(() => readProbe({ streams: [] }), /no video stream/);
});

test('the image is joined after the video for the end, before it for the beginning', () => {
	const probe = { width: 1080, height: 1920, rate: '30000/1001', audio: { sampleRate: 48000, layout: 'stereo' }, duration: 20 };
	const end = coverArgs({ input: 'in', image: 'pic.jpg', out: 'out.mp4', probe, at: 'end' });
	const graph = end[end.indexOf('-filter_complex') + 1];
	assert.match(graph, /\[vid\]\[va\]\[img\]\[ia\]concat=n=2:v=1:a=1\[v\]\[a\]/);
	assert.match(graph, /scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920/);
	assert.ok(end.includes('anullsrc=r=48000:cl=stereo'));
	assert.equal(end[end.indexOf('-t') + 1], String(HOLD_SECONDS));
	assert.equal(end.at(-1), 'out.mp4');
	const start = coverArgs({ input: 'in', image: 'pic.jpg', out: 'out.mp4', probe, at: 'start' });
	assert.match(start[start.indexOf('-filter_complex') + 1], /\[img\]\[ia\]\[vid\]\[va\]concat/);
	const silent = coverArgs({ input: 'in', image: 'pic.jpg', out: 'out.mp4', probe: { ...probe, audio: null }, at: 'end' });
	assert.match(silent[silent.indexOf('-filter_complex') + 1], /\[vid\]\[img\]concat=n=2:v=1:a=0\[v\]/);
	assert.ok(!silent.some((a) => a.startsWith('anullsrc')));
});

test('the cover time is the middle of the image: 0.1 s in, or 0.1 s before the end', () => {
	assert.equal(coverTimestamp(20.2, 'start'), 100);
	assert.equal(coverTimestamp(20.2, 'end'), 20100);
	assert.equal(coverTimestamp(0.05, 'end'), 0);
});
