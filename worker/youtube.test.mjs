import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	editedSnippet,
	isShortVideo,
	isoSeconds,
	playlistChanges,
	playlistNames,
	processingState,
	publicPatch,
	scopeCanEdit,
	snippetHolds,
	statusPatch,
	studioUrl
} from './youtube.mjs';

const UPLOAD = 'https://www.googleapis.com/auth/youtube.upload';
const READONLY = 'https://www.googleapis.com/auth/youtube.readonly';
const YOUTUBE = 'https://www.googleapis.com/auth/youtube';

test('the default grant cannot edit, although every scope contains "youtube"', () => {
	assert.equal(scopeCanEdit(`${READONLY} ${UPLOAD}`), false);
});

test('the --with-playlists grant can edit', () => {
	assert.equal(scopeCanEdit(`${UPLOAD} ${READONLY} ${YOUTUBE}`), true);
	assert.equal(scopeCanEdit('https://www.googleapis.com/auth/youtube.force-ssl'), true);
});

test('a post names its playlists as a list, or as the one playlist of rows from before', () => {
	assert.deepEqual(playlistNames({ playlists: ['Clips', ' Shorts ', 'clips', ''] }), ['Clips', 'Shorts']);
	assert.deepEqual(playlistNames({ playlist: 'First Peck' }), ['First Peck']);
	assert.deepEqual(playlistNames({ playlists: ['A'], playlist: 'B' }), ['A', 'B']);
	assert.deepEqual(playlistNames({ playlist: '  ' }), []);
	assert.deepEqual(playlistNames({}), []);
	assert.deepEqual(playlistNames(undefined), []);
});

test('a grant that says nothing about its scopes is unknown, not upload-only', () => {
	assert.equal(scopeCanEdit(undefined), null);
	assert.equal(scopeCanEdit(''), null);
	assert.equal(scopeCanEdit('   '), null);
});

test('processing is done only once YouTube has its own thumbnails too', () => {
	assert.equal(processingState({ processingStatus: 'succeeded', thumbnailsAvailability: 'available' }), 'done');
	assert.equal(processingState({ processingStatus: 'succeeded', thumbnailsAvailability: 'inProgress' }), 'wait');
	assert.equal(processingState({ processingStatus: 'processing', thumbnailsAvailability: 'available' }), 'wait');
});

test('a reading without processing details yet means wait', () => {
	assert.equal(processingState(undefined), 'wait');
	assert.equal(processingState({}), 'wait');
});

test('failed and terminated processing stop the wait', () => {
	assert.equal(processingState({ processingStatus: 'failed' }), 'failed');
	assert.equal(processingState({ processingStatus: 'terminated' }), 'failed');
});

test('a video length reads out of ISO 8601 as YouTube gives it', () => {
	assert.equal(isoSeconds('PT30S'), 30);
	assert.equal(isoSeconds('PT2M58S'), 178);
	assert.equal(isoSeconds('PT1H2M3S'), 3723);
	assert.equal(isoSeconds('P1DT1S'), 86401);
	assert.equal(isoSeconds('P0D'), 0);
	assert.equal(isoSeconds(''), null);
	assert.equal(isoSeconds('PT'), null);
	assert.equal(isoSeconds(undefined), null);
});

test('a Short is up to three minutes, and unknown without a length', () => {
	assert.equal(isShortVideo(30), true);
	assert.equal(isShortVideo(180), true);
	assert.equal(isShortVideo(181), false);
	assert.equal(isShortVideo(null), null);
	assert.equal(isShortVideo(0), null);
});

test('the Studio link opens the video’s edit page', () => {
	assert.equal(studioUrl('LTk4d1CwGQE'), 'https://studio.youtube.com/video/LTk4d1CwGQE/edit');
});

test('statusPatch sends the status back whole, with only the time changed', () => {
	const read = {
		uploadStatus: 'processed',
		privacyStatus: 'private',
		publishAt: '2026-11-01T17:00:00Z',
		license: 'youtube',
		embeddable: true,
		publicStatsViewable: true,
		madeForKids: false,
		selfDeclaredMadeForKids: false,
		containsSyntheticMedia: false
	};
	assert.deepEqual(statusPatch(read, '2026-11-02T18:30:00Z'), {
		license: 'youtube',
		embeddable: true,
		publicStatsViewable: true,
		selfDeclaredMadeForKids: false,
		containsSyntheticMedia: false,
		privacyStatus: 'private',
		publishAt: '2026-11-02T18:30:00.000Z'
	});
	// A field YouTube did not send is not made up.
	assert.deepEqual(statusPatch({ privacyStatus: 'private', publishAt: 'x' }, '2026-11-02T18:30:00Z'), {
		privacyStatus: 'private',
		publishAt: '2026-11-02T18:30:00.000Z'
	});
});

test('publicPatch puts a held video out now: public, its time left out', () => {
	const read = { privacyStatus: 'private', publishAt: '2026-11-01T17:00:00Z', license: 'youtube', embeddable: true, madeForKids: false };
	assert.deepEqual(publicPatch(read), { license: 'youtube', embeddable: true, privacyStatus: 'public' });
});

const read = {
	title: 'Owls',
	description: 'Old words',
	tags: ['owls'],
	categoryId: '20',
	defaultLanguage: 'en-US',
	thumbnails: { default: {} },
	channelId: 'UC1'
};

test("an edit's snippet keeps what YouTube had beside the new title, description and tags", () => {
	assert.deepEqual(editedSnippet(read, { title: 'Owls at dusk', description: 'New words', tags: ['owls', 'dusk'] }), {
		title: 'Owls at dusk',
		description: 'New words',
		tags: ['owls', 'dusk'],
		categoryId: '20',
		defaultLanguage: 'en-US'
	});
	const long = editedSnippet(read, { title: 'x'.repeat(120), description: '', tags: undefined });
	assert.equal(long.title.length, 100);
	assert.deepEqual(long.tags, []);
	assert.equal(editedSnippet(read, { title: '', description: '' }).title, 'Untitled');
});

test('a snippet that holds the edit already is left alone, tidied line ends and tag case aside', () => {
	assert.equal(snippetHolds(read, { title: 'Owls', description: 'Old words', tags: ['OWLS'] }), true);
	assert.equal(snippetHolds({ ...read, description: 'a\r\nb  ' }, { title: 'Owls', description: 'a\nb', tags: ['owls'] }), true);
	assert.equal(snippetHolds(read, { title: 'Owls', description: 'Old words', tags: [] }), false);
	assert.equal(snippetHolds(read, { title: 'Owls!', description: 'Old words', tags: ['owls'] }), false);
});

test('an edit joins the playlists newly named and leaves those dropped, case aside', () => {
	assert.deepEqual(playlistChanges({ playlists: ['Birds', 'Night'] }, { playlists: ['night', 'Cozy'] }), {
		add: ['Cozy'],
		remove: ['Birds']
	});
	assert.deepEqual(playlistChanges({ playlist: 'Birds' }, { playlists: ['Birds'] }), { add: [], remove: [] });
	assert.deepEqual(playlistChanges(undefined, { playlists: ['Birds'] }), { add: ['Birds'], remove: [] });
});
