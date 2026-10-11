import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { askToStop, holdInstance, pipeName } from './instance.mjs';

// A name of its own per run, so a real worker on this machine is never touched.
const name = pipeName('test', `-${process.pid}-${Date.now()}`);

describe('holdInstance', { skip: process.platform !== 'win32' && 'named pipes are Windows-only' }, () => {
	let stops = 0;

	it('takes the pipe for the first worker', async () => {
		assert.equal(await holdInstance('test', () => stops++, { name }), true);
	});

	it('refuses a second worker of the same role', async () => {
		assert.equal(await holdInstance('test', () => stops++, { name }), false);
	});

	it('stops the running worker when asked', async () => {
		assert.equal(await askToStop('test', { name }), 'the test worker is stopping');
		assert.equal(stops, 1);
	});

	it('says so when nothing is running', async () => {
		assert.equal(
			await askToStop('test', { name: pipeName('test', '-nobody-here') }),
			'no test worker is running on this machine'
		);
	});
});

describe('holdInstance elsewhere', () => {
	it('holds nothing outside Windows', async () => {
		assert.equal(await holdInstance('test', () => {}, { name, platform: 'linux' }), true);
	});
});
