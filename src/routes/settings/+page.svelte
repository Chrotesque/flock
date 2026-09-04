<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import PlatformIcon from '$lib/components/PlatformIcon.svelte';
	import Checkbox from '$lib/components/Checkbox.svelte';
	import OptionEditor from '$lib/components/OptionEditor.svelte';
	import TimeZoneList from '$lib/components/TimeZoneList.svelte';
	import FilterEditor from '$lib/components/FilterEditor.svelte';
	import GeneralSettings from '$lib/components/GeneralSettings.svelte';
	import TagSetEditor from '$lib/components/TagSetEditor.svelte';
	import ProfileEditor from '$lib/components/ProfileEditor.svelte';
	import TemplateEditor from '$lib/components/TemplateEditor.svelte';
	import { PLATFORMS, isPlatformId } from '$lib/platforms';
	import { settings } from '$lib/stores/settings.svelte';
	import { general } from '$lib/stores/general.svelte';
	import { templates } from '$lib/stores/templates.svelte';
	import { tagSets } from '$lib/stores/tagsets.svelte';
	import DeviceGate from '$lib/components/DeviceGate.svelte';
	import type {
		FilterRule,
		OptionValues,
		PlatformId,
		PlatformScheduling,
		SchedulingProfile
	} from '$lib/types';

	settings.load();
	general.load();
	templates.load();
	tagSets.load();

	type Section = 'general' | 'templates' | 'other' | PlatformId;

	let active = $state<Section>('general');
	let tab = $state<'defaults' | 'tags' | 'filters' | 'profiles'>('defaults');

	// Narrowed once here rather than guarded at every use site below.
	let platform = $derived<PlatformId | null>(
		active === 'general' || active === 'templates' || active === 'other' ? null : active
	);
	let entry = $derived(platform ? settings.get(platform) : undefined);
	let def = $derived(platform ? PLATFORMS[platform] : null);

	function onDefaultsChanged(values: OptionValues) {
		if (!entry || !platform) return;
		entry.defaults = values;
		settings.queueSave(platform);
	}

	function onFiltersChanged(next: FilterRule[]) {
		if (!entry || !platform) return;
		entry.filters = next;
		settings.queueSave(platform);
	}

	function setSchedulingMode(mode: PlatformScheduling['mode']) {
		if (!entry || !platform) return;
		entry.scheduling.mode = mode;
		settings.queueSave(platform);
	}

	function setDefaultTime(time: string) {
		if (!entry || !platform) return;
		entry.scheduling.defaultTime = time || '09:00';
		settings.queueSave(platform);
	}

	function onProfilesChanged(next: SchedulingProfile[]) {
		if (!entry || !platform) return;
		entry.scheduling.profiles = next;
		settings.queueSave(platform);
	}

	// The Profiles tab only exists in profiles mode, and each platform has its
	// own mode — so switching away from it, or to a platform that does not have
	// it, has to put the panel back on a tab that is actually rendered. Tags is
	// the same shape: only platforms with a tag budget render it.
	$effect(() => {
		if (tab === 'profiles' && entry?.scheduling.mode !== 'profiles') tab = 'defaults';
		if (tab === 'tags' && !hasTags) tab = 'defaults';
	});

	let hasTags = $derived(Boolean(platform && PLATFORMS[platform].tagBudget));

	/**
	 * Opens straight onto whatever the caller asked for.
	 *
	 * The compose screen links here with `?section=templates` or
	 * `?platform=youtube&tab=tags`, so an Edit button lands on the thing being
	 * edited rather than on the settings screen's front door. Read once from the
	 * URL rather than kept in sync with it: this is a starting point, not state.
	 */
	$effect(() => {
		const params = page.url.searchParams;
		const section = params.get('section');
		const wantPlatform = params.get('platform');
		const wantTab = params.get('tab');

		untrack(() => {
			if (section === 'templates' || section === 'general' || section === 'other') {
				active = section === 'general' ? 'general' : section;
				return;
			}
			if (wantPlatform && isPlatformId(wantPlatform)) {
				active = wantPlatform;
				if (wantTab === 'tags' || wantTab === 'filters' || wantTab === 'profiles') tab = wantTab;
			}
		});
	});

	function resetDefaults() {
		if (!entry || !platform) return;
		entry.defaults = { ...PLATFORMS[platform].defaults };
		settings.queueSave(platform);
	}
</script>

<div class="page">
<DeviceGate what="Settings">
		<header class="head">
			<div>
				<h1>Settings</h1>
				<p>Display order, per-platform defaults, and the adaptation rules.</p>
			</div>
			{#if settings.saving}
				<span class="pill saving">Saving…</span>
			{/if}
		</header>

		{#if settings.error}
			<p class="banner error">Could not reach PocketBase — {settings.error}</p>
		{/if}

		{#if settings.loading}
			<p class="banner">Loading…</p>
		{:else}
			<div class="split">
				<aside class="card list">
					<h3>General</h3>
					<p class="note">Settings that are not tied to one platform.</p>

					<ul class="plain">
						<li class:active={active === 'general'}>
							<button class="pick" onclick={() => (active = 'general')}>
								<span class="ic">
									<svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
										<path
											d="M4 7.5A2.5 2.5 0 0 1 6.5 5h3l1.8 2H17.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z"
											stroke="currentColor"
											stroke-width="1.6"
											stroke-linejoin="round"
										/>
									</svg>
								</span>
								<span class="who">
									<span class="name">Storage and defaults</span>
									<span class="sub">
										{general.value.destinations.length}
										{general.value.destinations.length === 1 ? 'destination' : 'destinations'}
									</span>
								</span>
							</button>
						</li>
						<li class:active={active === 'templates'}>
							<button class="pick" onclick={() => (active = 'templates')}>
								<span class="ic">
									<svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
										<path
											d="M6 4h9l4 4v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"
											stroke="currentColor"
											stroke-width="1.6"
											stroke-linejoin="round"
										/>
										<path
											d="M14.5 4v4.5H19M8.5 13h7M8.5 16.5h4.5"
											stroke="currentColor"
											stroke-width="1.5"
											stroke-linecap="round"
										/>
									</svg>
								</span>
								<span class="who">
									<span class="name">Templates</span>
									<span class="sub">
										{templates.items.length}
										{templates.items.length === 1 ? 'template' : 'templates'}
									</span>
								</span>
							</button>
						</li>
						<li class:active={active === 'other'}>
							<button class="pick" onclick={() => (active = 'other')}>
								<span class="ic">
									<svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
										<circle cx="12" cy="12" r="8.2" stroke="currentColor" stroke-width="1.6" />
										<path
											d="M12 8.6v.1M12 11.4v4"
											stroke="currentColor"
											stroke-width="1.8"
											stroke-linecap="round"
										/>
									</svg>
								</span>
								<span class="who">
									<span class="name">Other</span>
									<span class="sub">
										{general.value.complianceBranding ? 'compliance on' : 'compliance off'}
									</span>
								</span>
							</button>
						</li>
					</ul>

					<h3 class="second">Platforms</h3>
					<p class="note">
						This order is used everywhere — the compose rail, the schedule list and the confirmation
						screen.
					</p>

					<ul>
						{#each settings.ordered as item, index (item.platform)}
							<li class:active={active === item.platform} class:off={!item.enabled}>
								<button class="pick" onclick={() => (active = item.platform)}>
									<span class="ic"><PlatformIcon platform={item.platform} size={18} /></span>
									<span class="who">
										<span class="name">{PLATFORMS[item.platform].label}</span>
										<span class="sub">
											{item.filters.length}
											{item.filters.length === 1 ? 'rule' : 'rules'}
										</span>
									</span>
								</button>

								<div class="order">
									<button
										onclick={() => settings.move(item.platform, -1)}
										disabled={index === 0}
										aria-label="Move {PLATFORMS[item.platform].label} up"
									>
										<svg viewBox="0 0 12 12" width="10" height="10"
											><path
												d="M2.5 7.5 6 4l3.5 3.5"
												fill="none"
												stroke="currentColor"
												stroke-width="1.7"
												stroke-linecap="round"
												stroke-linejoin="round"
											/></svg
										>
									</button>
									<button
										onclick={() => settings.move(item.platform, 1)}
										disabled={index === settings.ordered.length - 1}
										aria-label="Move {PLATFORMS[item.platform].label} down"
									>
										<svg viewBox="0 0 12 12" width="10" height="10"
											><path
												d="M2.5 4.5 6 8l3.5-3.5"
												fill="none"
												stroke="currentColor"
												stroke-width="1.7"
												stroke-linecap="round"
												stroke-linejoin="round"
											/></svg
										>
									</button>
								</div>

								<Checkbox
									checked={item.enabled}
									onchange={(next) => {
										item.enabled = next;
										settings.queueSave(item.platform);
									}}
								/>
							</li>
						{/each}
					</ul>

					<p class="note foot">
						Unticking a platform removes it from new uploads entirely — it stops being listed on the
						compose screen. Its defaults and rules are kept.
					</p>
				</aside>

				<section class="card panel">
					{#if active === 'other'}
						<header class="panelhead">
							<div class="ident">
								<span class="ic big">
									<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
										<circle cx="12" cy="12" r="8.2" stroke="currentColor" stroke-width="1.6" />
										<path
											d="M12 8.6v.1M12 11.4v4"
											stroke="currentColor"
											stroke-width="1.8"
											stroke-linecap="round"
										/>
									</svg>
								</span>
								<div>
									<h2>Other</h2>
									<p>Everything that does not belong to a platform or to storage.</p>
								</div>
							</div>
						</header>

						<div class="otherbody">
							<Checkbox
								checked={general.value.complianceBranding}
								label="Compliance modifications"
								onchange={(next) => general.setComplianceBranding(next)}
							/>
							<p class="otherhint">
								Renders platform brand marks the way each platform's API branding guidelines
								require — for YouTube, its official logo in its official colours, plus a
								clickable logo linking back to YouTube in the YouTube options panel.
							</p>
							<p class="otherhint">
								Off by default because official brand colours clash with the muted palette this
								interface uses, where pink is reserved for selection state. Turn it on when the
								interface is being reviewed or screenshotted for an API audit —
								<strong>on is the compliant state</strong>, and YouTube's guidelines expect
								branding wherever its API has a presence.
							</p>

							<TimeZoneList />
						</div>
					{:else if active === 'templates'}
						<header class="panelhead">
							<div class="ident">
								<span class="ic big">
									<svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
										<path
											d="M6 4h9l4 4v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"
											stroke="currentColor"
											stroke-width="1.6"
											stroke-linejoin="round"
										/>
										<path
											d="M14.5 4v4.5H19M8.5 13h7M8.5 16.5h4.5"
											stroke="currentColor"
											stroke-width="1.5"
											stroke-linecap="round"
										/>
									</svg>
								</span>
								<div>
									<h2>Templates</h2>
									<p>Reusable text you can drop into a title or description.</p>
								</div>
							</div>
						</header>

						{#if templates.loading}
							<p class="banner">Loading…</p>
						{:else}
							<TemplateEditor />
						{/if}
					{:else if !platform || !def}
						<header class="panelhead">
							<div class="ident">
								<span class="ic big">
									<svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
										<path
											d="M4 7.5A2.5 2.5 0 0 1 6.5 5h3l1.8 2H17.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z"
											stroke="currentColor"
											stroke-width="1.6"
											stroke-linejoin="round"
										/>
									</svg>
								</span>
								<div>
									<h2>Storage and defaults</h2>
									<p>Where finished videos go, and what a new upload starts from.</p>
								</div>
							</div>
						</header>

						{#if general.loading}
							<p class="banner">Loading…</p>
						{:else}
							<GeneralSettings />
						{/if}
					{:else}
						<header class="panelhead">
							<div class="ident">
								<span class="ic big"><PlatformIcon {platform} size={22} /></span>
								<div>
									<h2>{def.label}</h2>
									<p>
										{def.fieldNote}
										{#if def.hasTitle}Title limit {def.titleLimit.toLocaleString()}, description
											limit{:else}Description limit{/if}
										{def.descriptionLimit.toLocaleString()}.
									</p>
								</div>
							</div>
						</header>

					<div class="tabs">
							<button class:active={tab === 'defaults'} onclick={() => (tab = 'defaults')}>
								Defaults
							</button>
							{#if hasTags}
								<button class:active={tab === 'tags'} onclick={() => (tab = 'tags')}>
									Tags
									{#if tagSets.items.length > 0}
										<span class="dot">{tagSets.items.length}</span>
									{/if}
								</button>
							{/if}
							<button class:active={tab === 'filters'} onclick={() => (tab = 'filters')}>
								Adaptations
								{#if entry && entry.filters.length > 0}
									<span class="dot">{entry.filters.length}</span>
								{/if}
							</button>
							{#if entry && entry.scheduling.mode === 'profiles'}
								<button class:active={tab === 'profiles'} onclick={() => (tab = 'profiles')}>
									Profiles
									{#if entry.scheduling.profiles.length > 0}
										<span class="dot">{entry.scheduling.profiles.length}</span>
									{/if}
								</button>
							{/if}
						</div>

						{#if entry}
							{#if tab === 'tags'}
								<TagSetEditor limit={PLATFORMS[platform!].tagBudget?.limit ?? 500} />
							{:else if tab === 'defaults'}
								<div class="defaults">
									<section class="timing">
										<div class="subhead">
											<div>
												<h4>Release timing</h4>
												<p>What a new upload starts from when it reaches the schedule step.</p>
											</div>
										</div>

										<div class="modes" role="radiogroup" aria-label="Release timing">
											<button
												class="mode"
												class:on={entry.scheduling.mode === 'time'}
												role="radio"
												aria-checked={entry.scheduling.mode === 'time'}
												onclick={() => setSchedulingMode('time')}
											>
												<span class="pip"></span>
												<span class="modebody">
													<span class="modename">Default time</span>
													<span class="modehint">One fixed time for every upload.</span>
												</span>
											</button>

											{#if entry.scheduling.mode === 'time'}
												<input
													class="input time"
													type="time"
													value={entry.scheduling.defaultTime}
													onchange={(e) => setDefaultTime(e.currentTarget.value)}
												/>
											{/if}

											<button
												class="mode"
												class:on={entry.scheduling.mode === 'profiles'}
												role="radio"
												aria-checked={entry.scheduling.mode === 'profiles'}
												onclick={() => setSchedulingMode('profiles')}
											>
												<span class="pip"></span>
												<span class="modebody">
													<span class="modename">Profiles</span>
													<span class="modehint"
														>Named patterns, picked per upload. Adds a Profiles tab.</span
													>
												</span>
											</button>
										</div>
									</section>

									<div class="subhead">
										<div>
											<h4>Default publish options</h4>
											<p>
												Pre-filled on every new upload. Changing them on an upload only affects that
												upload.
											</p>
										</div>
										<button class="btn sm" onclick={resetDefaults}>Reset</button>
									</div>

									<OptionEditor
										fields={def.fields}
										values={entry.defaults}
										onchange={() => onDefaultsChanged(entry.defaults)}
									/>

									<p class="footnote">
										Every option above is a placeholder invented to give the interface something real
										to show. Once the {def.label} API is connected, expect this whole set to be
										replaced.
									</p>
								</div>
							{:else if tab === 'profiles'}
								<ProfileEditor
									profiles={entry.scheduling.profiles}
									label={def.label}
									onchange={onProfilesChanged}
								/>
							{:else}
								<FilterEditor rules={entry.filters} label={def.label} onchange={onFiltersChanged} />
							{/if}
						{/if}
					{/if}
				</section>
			</div>
		{/if}
</DeviceGate>
</div>

<style>
	.page {
		max-width: 1180px;
		margin: 0 auto;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		margin-bottom: 24px;
	}

	h1 {
		font-size: 23px;
	}

	.head p {
		margin: 5px 0 0;
		font-size: 13px;
		color: var(--text-dim);
	}

	.saving {
		background: var(--accent-grad-soft);
		color: var(--pink-soft);
	}

	.banner {
		margin: 0 0 16px;
		padding: 11px 14px;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--border);
		font-size: 12.5px;
		color: var(--text-dim);
	}

	.banner.error {
		border-color: rgba(248, 113, 113, 0.4);
		color: var(--danger);
	}

	.split {
		display: grid;
		grid-template-columns: 310px minmax(0, 1fr);
		gap: 18px;
		align-items: start;
	}

	.list {
		padding: 18px 16px;
	}

	h3 {
		font-size: 14px;
	}

	.note {
		margin: 5px 0 14px;
		font-size: 11.5px;
		color: var(--text-faint);
		line-height: 1.5;
	}

	.second {
		margin-top: 20px;
		padding-top: 16px;
		border-top: 1px solid var(--border);
	}

	/* The General row has no reorder or enable controls, so its button takes
	   the full width of the row instead of sharing it. */
	.plain li {
		padding-right: 4px;
	}

	.note.foot {
		margin: 14px 0 0;
		padding-top: 12px;
		border-top: 1px solid var(--border);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}

	li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 10px 4px 4px;
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--border);
		transition: border-color 0.15s, background 0.15s, opacity 0.15s;
	}

	li.off {
		opacity: 0.5;
	}

	li.active {
		border-color: rgba(255, 77, 158, 0.45);
		background: var(--accent-grad-soft);
	}

	.pick {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 2px 8px 7px;
		text-align: left;
	}

	.ic {
		flex: none;
		width: 30px;
		height: 30px;
		display: grid;
		place-items: center;
		border-radius: 9px;
		background: var(--surface-2);
		border: 1px solid var(--border);
	}

	.ic.big {
		width: 40px;
		height: 40px;
		border-radius: 12px;
	}

	.name {
		display: block;
		font-size: 13px;
		font-weight: 570;
	}

	.sub {
		display: block;
		font-size: 10.5px;
		color: var(--text-faint);
	}

	.order {
		display: flex;
		flex-direction: column;
		gap: 1px;
		flex: none;
	}

	.order button {
		width: 20px;
		height: 15px;
		display: grid;
		place-items: center;
		border-radius: 4px;
		color: var(--text-faint);
	}

	.order button:hover:not(:disabled) {
		background: var(--surface-3);
		color: var(--text);
	}

	.panel {
		padding: 20px 22px 24px;
	}

	.panelhead {
		margin-bottom: 18px;
	}

	.ident {
		display: flex;
		align-items: center;
		gap: 13px;
	}

	h2 {
		font-size: 17px;
	}

	.ident p {
		margin: 3px 0 0;
		font-size: 12px;
		color: var(--text-dim);
		max-width: 62ch;
		line-height: 1.5;
	}

	.tabs {
		display: flex;
		gap: 4px;
		padding: 3px;
		margin-bottom: 20px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: 10px;
		width: fit-content;
	}

	.tabs button {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 6px 16px;
		border-radius: 7px;
		font-size: 12.5px;
		font-weight: 560;
		color: var(--text-dim);
		transition: background 0.15s, color 0.15s;
	}

	.tabs button:hover {
		color: var(--text);
	}

	.tabs button.active {
		background: var(--surface-3);
		color: var(--text);
	}

	.dot {
		min-width: 17px;
		height: 17px;
		padding: 0 5px;
		border-radius: 999px;
		background: var(--accent-grad);
		color: #fff;
		font-size: 10.5px;
		font-weight: 700;
		display: grid;
		place-items: center;
	}

	.timing {
		padding-bottom: 20px;
		margin-bottom: 20px;
		border-bottom: 1px solid var(--border);
	}

	.modes {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px;
	}

	.mode {
		display: flex;
		align-items: flex-start;
		gap: 9px;
		padding: 10px 13px;
		border-radius: var(--radius);
		border: 1px solid var(--border);
		background: var(--bg-elev);
		text-align: left;
		transition: border-color 0.15s, background 0.15s;
	}

	.mode:hover {
		border-color: var(--border-strong);
	}

	.mode.on {
		border-color: rgba(255, 77, 158, 0.45);
		background: var(--accent-grad-soft);
	}

	.pip {
		flex: none;
		width: 16px;
		height: 16px;
		margin-top: 1px;
		border-radius: 50%;
		border: 1.5px solid var(--border-strong);
		display: grid;
		place-items: center;
		transition: border-color 0.15s;
	}

	.mode.on .pip {
		border-color: var(--pink);
	}

	.mode.on .pip::after {
		content: '';
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent-grad);
	}

	.modename {
		display: block;
		font-size: 12.5px;
		font-weight: 570;
	}

	.modehint {
		display: block;
		font-size: 11px;
		color: var(--text-faint);
		margin-top: 1px;
		max-width: 30ch;
	}

	.modes .time {
		width: 110px;
		padding: 8px 10px;
		font-size: 12.5px;
		text-align: center;
	}

	.subhead {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 18px;
	}

	h4 {
		font-size: 13.5px;
	}

	.subhead p {
		margin: 4px 0 0;
		font-size: 11.5px;
		color: var(--text-faint);
		max-width: 54ch;
		line-height: 1.5;
	}

	.sm {
		flex: none;
		padding: 6px 12px;
		font-size: 12px;
	}

	.footnote {
		margin: 22px 0 0;
		padding-top: 14px;
		border-top: 1px solid var(--border);
		font-size: 11.5px;
		color: var(--text-faint);
		line-height: 1.55;
	}

	@media (max-width: 940px) {
		.split {
			grid-template-columns: 1fr;
		}
	}
</style>
