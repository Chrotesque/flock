<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		title = '',
		subtitle = '',
		width = '640px',
		header,
		children,
		footer
	}: {
		open?: boolean;
		title?: string;
		subtitle?: string;
		width?: string;
		header?: Snippet;
		children?: Snippet;
		footer?: Snippet;
	} = $props();

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') open = false;
	}
</script>

<svelte:window on:keydown={onKeydown} />

{#if open}
	<!-- Closing is driven by target identity rather than stopPropagation on the
	     sheet, so the sheet itself needs no click handler and stays a plain,
	     keyboard-reachable dialog. -->
	<div
		class="backdrop"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) open = false;
		}}
	>
		<div
			class="sheet scroll"
			style="max-width: {width}"
			role="dialog"
			aria-modal="true"
			aria-label={title}
			tabindex="-1"
		>
			<header>
				{#if header}
					{@render header()}
				{:else}
					<div>
						<h2>{title}</h2>
						{#if subtitle}<p>{subtitle}</p>{/if}
					</div>
				{/if}
				<button class="close" onclick={() => (open = false)} aria-label="Close">
					<svg viewBox="0 0 16 16" width="16" height="16"
						><path
							d="M4 4l8 8M12 4l-8 8"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
						/></svg
					>
				</button>
			</header>

			<div class="body">
				{@render children?.()}
			</div>

			{#if footer}
				<footer>{@render footer()}</footer>
			{/if}
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: rgba(6, 5, 12, 0.72);
		backdrop-filter: blur(6px);
		display: grid;
		place-items: center;
		padding: 24px;
		animation: fade 0.14s ease;
	}

	.sheet {
		width: 100%;
		max-height: min(84vh, 860px);
		overflow-y: auto;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-lg);
		box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
		animation: rise 0.18s cubic-bezier(0.2, 0.8, 0.3, 1);
	}

	header {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		padding: 20px 22px 16px;
		background: linear-gradient(var(--surface) 78%, transparent);
		border-bottom: 1px solid var(--border);
	}

	h2 {
		font-size: 17px;
	}

	header p {
		margin: 3px 0 0;
		font-size: 12.5px;
		color: var(--text-dim);
	}

	.close {
		flex: none;
		width: 30px;
		height: 30px;
		border-radius: 8px;
		display: grid;
		place-items: center;
		color: var(--text-dim);
	}

	.close:hover {
		background: var(--surface-3);
		color: var(--text);
	}

	.body {
		padding: 20px 22px;
	}

	footer {
		position: sticky;
		bottom: 0;
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		padding: 14px 22px;
		background: var(--surface);
		border-top: 1px solid var(--border);
	}

	@keyframes fade {
		from {
			opacity: 0;
		}
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(10px) scale(0.985);
		}
	}
</style>
