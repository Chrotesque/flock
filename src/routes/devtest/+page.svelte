<script lang="ts">
	import { page } from '$app/state';
	import { devtestPages, shownDevtestPages } from '$lib/devtest';

	/**
	 * A page a local-devtest module brings (devtest.ts), picked by `?page=`;
	 * with none named, or one this build does not have or has switched off,
	 * the first switched on. A build without the folder has no link here and
	 * shows only the note below.
	 */
	const pages = $derived(shownDevtestPages());
	let current = $derived(pages.find((p) => p.id === page.url.searchParams.get('page')) ?? pages[0]);
</script>

{#if current}
	<current.Page />
{:else}
	<div class="page">
		<header class="head">
			<h1>DevTest</h1>
			{#if devtestPages.length > 0}
				<p>No local page is switched on right now; the module that brings it says when it shows.</p>
			{:else}
				<p>
					No local pages in this build. They come from the <code>src/local-devtest/</code> folder of
					the machine that deployed flock, which is not part of flock's repository.
				</p>
			{/if}
		</header>
	</div>
{/if}

<style>
	.page {
		max-width: 1180px;
		margin: 0 auto;
	}

	.head {
		margin-bottom: 20px;
	}

	h1 {
		font-size: 23px;
	}

	.head p {
		margin: 5px 0 0;
		font-size: 13px;
		color: var(--text-dim);
	}

	code {
		font-family: var(--mono);
		font-size: 11.5px;
	}
</style>
