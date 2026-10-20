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
	import BrandEditor from '$lib/components/BrandEditor.svelte';
	import DashColumnsEditor from '$lib/components/DashColumnsEditor.svelte';
	import { shownColumns } from '$lib/dashcolumns';
	import { PLATFORMS, isPlatformId } from '$lib/platforms';
	import { settings } from '$lib/stores/settings.svelte';
	import { brands } from '$lib/stores/brands.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { general } from '$lib/stores/general.svelte';
	import { templates } from '$lib/stores/templates.svelte';
	import { tagSets } from '$lib/stores/tagsets.svelte';
	import DeviceGate from '$lib/components/DeviceGate.svelte';
	import TodoIcon from '$lib/components/TodoIcon.svelte';
	import { VERSION } from '$lib/version';
	import { DEVTEST_ICON, devtestActive, devtestDashboardSettings, devtestModules } from '$lib/devtest';
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
	// Fresh, so an account the worker has just listed can be chosen at once.
	accounts.load(true);

	type Section = 'general' | 'brands' | 'templates' | 'dashboard' | 'other' | 'devtest' | PlatformId;

	// The list's table icon, for the Dashboard section.
	const COLUMNS_ICON = 'M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13ZM4 9.5h16M9.5 9.5V20M14.5 9.5V20';
	const shownCount = $derived(shownColumns(general.value.dashboardColumns, { jestr: general.value.jestrIntegration }).length);

	// The DevTest section lists only while a local-devtest module has settings;
	// one bringing just a page (a sidebar link) has nothing to show here.
	const devtestSettings = devtestModules.filter((mod) => mod.Settings);

	let active = $state<Section>('general');
	let tab = $state<'defaults' | 'tags' | 'filters' | 'profiles'>('defaults');

	// Narrowed once here rather than guarded at every use site below.
	let platform = $derived<PlatformId | null>(isPlatformId(active) ? active : null);
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
			if (
				section === 'templates' ||
				section === 'general' ||
				section === 'other' ||
				section === 'brands' ||
				section === 'dashboard' ||
				(section === 'devtest' && devtestSettings.length > 0)
			) {
				active = section;
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
				<h1>Settings <span class="ver" title="flock's version">v{VERSION}</span></h1>
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
					<p class="note">Shared by every brand.</p>

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
						<li class:active={active === 'brands'}>
							<button class="pick" onclick={() => (active = 'brands')}>
								<span class="ic">
									<svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
										<path
											d="M12 4.5 19.5 8 12 11.5 4.5 8 12 4.5Z"
											stroke="currentColor"
											stroke-width="1.6"
											stroke-linejoin="round"
										/>
										<path
											d="m4.5 12 7.5 3.5 7.5-3.5M4.5 16l7.5 3.5 7.5-3.5"
											stroke="currentColor"
											stroke-width="1.6"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
								</span>
								<span class="who">
									<span class="name">Brands</span>
									<span class="sub">
										{brands.list.length}
										{brands.list.length === 1 ? 'brand' : 'brands'}
									</span>
								</span>
							</button>
						</li>
						<li class:active={active === 'dashboard'}>
							<button class="pick" onclick={() => (active = 'dashboard')}>
								<span class="ic">
									<svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
										<path d={COLUMNS_ICON} stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
									</svg>
								</span>
								<span class="who">
									<span class="name">Dashboard</span>
									<span class="sub">{shownCount} columns in the list</span>
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
										{general.value.complianceBranding ? 'compliance on' : 'compliance off'}{general.value.showTodo
											? ''
											: ' · To finish hidden'}
									</span>
								</span>
							</button>
						</li>
						{#if devtestSettings.length > 0}
							<li class:active={active === 'devtest'}>
								<button class="pick" onclick={() => (active = 'devtest')}>
									<span class="ic">
										<svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
											<path
												d={DEVTEST_ICON}
												stroke="currentColor"
												stroke-width="1.6"
												stroke-linecap="round"
												stroke-linejoin="round"
											/>
										</svg>
									</span>
									<span class="who">
										<span class="name">DevTest</span>
										<span class="sub">
											{devtestActive().length > 0 ? 'overriding' : 'nothing overridden'} · local only
										</span>
									</span>
								</button>
							</li>
						{/if}
					</ul>

					<!--
						Everything from here down belongs to the brand in view. The switch is
						the same choice as the upload wizard's: what is edited here is what
						the next upload for that brand starts from.
					-->
					<h3 class="second">{brands.multiple ? 'Brand' : (brands.current?.name ?? 'Brand')}</h3>
					{#if brands.multiple}
						<div class="brands" role="radiogroup" aria-label="Brand in view">
							{#each brands.ordered as brand (brand.id)}
								<button
									class="brandchip"
									class:on={brand.id === brands.currentId}
									role="radio"
									aria-checked={brand.id === brands.currentId}
									onclick={() => brands.select(brand.id)}
								>
									{brand.name}
								</button>
							{/each}
						</div>
					{/if}
					<p class="note">
						Everything below belongs to {brands.current?.name ?? 'this brand'}.
					</p>

					<ul class="plain">
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
					</ul>

					<h4 class="platformshead">Platforms</h4>
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
						Unticked platforms start switched off on a new upload. They are still listed there, and
						can be ticked for that upload. Their defaults and rules are kept.
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

							<Checkbox
								checked={general.value.showTodo}
								label="Show the To finish Indicator"
								onchange={(next) => general.setShowTodo(next)}
							/>
							<p class="otherhint">
								The box in the sidebar; the number under it counts what is on the list. Off, it is
								hidden on every computer, and nothing on the list is lost.
							</p>
							<!-- The sidebar box's states, drawn small (TodoIcon). -->
							<ul class="todolegend">
								<li><TodoIcon state="idle" /><span>Nothing left to finish.</span></li>
								<li><TodoIcon state="due" /><span>Something to do by hand, like a step in Studio.</span></li>
								<li><TodoIcon state="failed" /><span>A post did not go out. Pulses until retried or dismissed.</span></li>
								<li><TodoIcon state="open" /><span>The list is open. Click the box again to close it.</span></li>
							</ul>

							<TimeZoneList />
						</div>
					{:else if active === 'dashboard'}
						<header class="panelhead">
							<div class="ident">
								<span class="ic big">
									<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
										<path d={COLUMNS_ICON} stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
									</svg>
								</span>
								<div>
									<h2>Dashboard</h2>
									<p>The columns of the Dashboard's list of videos: which are shown, and in what order.</p>
								</div>
							</div>
						</header>

						{#if general.loading}
							<p class="banner">Loading…</p>
						{:else}
							<DashColumnsEditor />
						{/if}
						{#each devtestDashboardSettings as mod (mod.title)}
							<section class="devtestmod dashlocal">
								<h3>{mod.title} <span class="localtag">local only</span></h3>
								{#if mod.DashboardSettings}
									<mod.DashboardSettings />
								{/if}
							</section>
						{/each}
					{:else if active === 'devtest'}
						<header class="panelhead">
							<div class="ident">
								<span class="ic big">
									<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
										<path
											d={DEVTEST_ICON}
											stroke="currentColor"
											stroke-width="1.6"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
								</span>
								<div>
									<h2>DevTest</h2>
									<p>
										Test extensions built in from the <code>src/local-devtest/</code> folder of
										the machine that deployed flock. They are not part of flock's repository.
									</p>
								</div>
							</div>
						</header>

						<div class="otherbody">
							{#each devtestSettings as mod (mod.title)}
								<section class="devtestmod">
									<h3>{mod.title}</h3>
									{#if mod.Settings}
										<mod.Settings />
									{/if}
								</section>
							{/each}
						</div>
					{:else if active === 'brands'}
						<header class="panelhead">
							<div class="ident">
								<span class="ic big">
									<svg viewBox="0 0 24 24" width="21" height="21" fill="none" aria-hidden="true">
										<path
											d="M12 4.5 19.5 8 12 11.5 4.5 8 12 4.5Z"
											stroke="currentColor"
											stroke-width="1.6"
											stroke-linejoin="round"
										/>
										<path
											d="m4.5 12 7.5 3.5 7.5-3.5M4.5 16l7.5 3.5 7.5-3.5"
											stroke="currentColor"
											stroke-width="1.6"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
								</span>
								<div>
									<h2>Brands</h2>
									<p>The brands you publish as, and the order they are offered in.</p>
								</div>
							</div>
						</header>

						<BrandEditor />
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
									<h2>Templates{brands.multiple ? ` · ${brands.current?.name ?? ''}` : ''}</h2>
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
									<h2>{def.label}{brands.multiple ? ` · ${brands.current?.name ?? ''}` : ''}</h2>
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
										{#if def.fields.length > 0}
											<button class="btn sm" onclick={resetDefaults}>Reset</button>
										{/if}
									</div>

									{#if def.fields.length > 0}
										<OptionEditor
											fields={def.fields}
											values={entry.defaults}
											onchange={() => onDefaultsChanged(entry.defaults)}
										/>
									{:else}
										<p class="footnote">{def.fieldNote}</p>
									{/if}
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
	/* Full width, as Upload: the layout's own 40px keeps it off the edges,
	   and the panel gets all the room the window has. */
	.page {
		max-width: none;
		margin: 0;
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

	/* The version lives here since it left the sidebar: first thing in view
	   once Settings is open. */
	.ver {
		margin-left: 8px;
		padding: 2px 8px;
		border: 1px solid var(--border);
		border-radius: 999px;
		font-family: var(--mono);
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0.02em;
		color: var(--text-faint);
		vertical-align: middle;
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

	.devtestmod h3 {
		margin: 0 0 12px;
	}

	.devtestmod + .devtestmod {
		margin-top: 22px;
		padding-top: 18px;
		border-top: 1px solid var(--border);
	}

	/* A local module's part of the Dashboard section: set apart from flock's
	   own by a dashed line in DevTest's purple, like the sidebar's local pages. */
	.devtestmod.dashlocal {
		margin-top: 26px;
		padding-top: 20px;
		border-top: 1px dashed rgba(168, 85, 247, 0.4);
	}

	.devtestmod.dashlocal + .devtestmod.dashlocal {
		margin-top: 22px;
		padding-top: 18px;
		border-top: 1px solid var(--border);
	}

	/* Settings → Other: the To finish box's states, an icon and a line each. */
	.todolegend {
		display: grid;
		gap: 9px;
		margin: 2px 0 0;
		padding: 0;
		list-style: none;
	}

	/* Plain lines, not the section list's boxed rows (`li` below). */
	.todolegend li {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 0;
		border: 0;
		border-radius: 0;
		background: none;
	}

	.localtag {
		margin-left: 6px;
		padding: 1px 7px;
		border: 1px dashed rgba(168, 85, 247, 0.5);
		border-radius: 999px;
		font-size: 10.5px;
		font-weight: 500;
		color: var(--purple);
		vertical-align: middle;
	}

	.ident code {
		font-family: var(--mono);
		font-size: 11.5px;
	}

	.second {
		margin-top: 20px;
		padding-top: 16px;
		border-top: 1px solid var(--border);
	}

	.platformshead {
		margin-top: 18px;
		font-size: 12.5px;
	}

	.brands {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 10px;
	}

	.brandchip {
		padding: 5px 12px;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		background: var(--bg-elev);
		font-size: 12px;
		font-weight: 560;
		color: var(--text-dim);
		transition: border-color 0.14s, background 0.14s, color 0.14s;
	}

	.brandchip:hover {
		border-color: var(--pink-soft);
		color: var(--text);
	}

	.brandchip.on {
		border-color: var(--pink);
		background: var(--accent-grad-soft);
		color: var(--text);
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
