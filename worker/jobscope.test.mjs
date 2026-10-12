import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentJob, inJob } from './jobscope.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test('outside a job there is none', () => {
	assert.equal(currentJob(), '');
});

test('the job holds across awaits and ends with the call', async () => {
	const seen = await inJob('job1', async () => {
		await tick();
		return currentJob();
	});
	assert.equal(seen, 'job1');
	assert.equal(currentJob(), '');
});

test('two jobs running side by side keep their own ids', async () => {
	const lane = (job) =>
		inJob(job, async () => {
			const out = [];
			for (let i = 0; i < 3; i++) {
				await tick();
				out.push(currentJob());
			}
			return out;
		});
	const [a, b] = await Promise.all([lane('a'), lane('b')]);
	assert.deepEqual(a, ['a', 'a', 'a']);
	assert.deepEqual(b, ['b', 'b', 'b']);
});

test('no id runs the function untagged', async () => {
	assert.equal(await inJob('', async () => currentJob()), '');
});
