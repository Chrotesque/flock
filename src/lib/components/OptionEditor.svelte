<script lang="ts">
	import TagInput from './TagInput.svelte';
	import Checkbox from './Checkbox.svelte';
	import type { OptionField, OptionValues } from '$lib/types';

	// Renders a platform's option set from its field descriptors. Every option
	// in the registry is a placeholder until the real APIs are known, so this
	// stays fully generic — adding an option means adding one entry to
	// platforms.ts, never touching a component.
	let {
		fields,
		values = $bindable<OptionValues>({}),
		onchange
	}: { fields: OptionField[]; values?: OptionValues; onchange?: () => void } = $props();

	function set(key: string, value: unknown) {
		values[key] = value as OptionValues[string];
		onchange?.();
	}
</script>

<div class="grid">
	{#each fields as field (field.key)}
		<div class="row" class:inline={field.type === 'bool'}>
			{#if field.type === 'bool'}
				<Checkbox
					checked={Boolean(values[field.key])}
					label={field.label}
					onchange={(next) => set(field.key, next)}
				/>
			{:else}
				<label class="label" for="opt-{field.key}">{field.label}</label>

				{#if field.type === 'select'}
					<select
						id="opt-{field.key}"
						class="select"
						value={String(values[field.key] ?? '')}
						onchange={(e) => set(field.key, e.currentTarget.value)}
					>
						{#each field.choices as choice}
							<option value={choice}>{choice}</option>
						{/each}
					</select>
				{:else if field.type === 'tags'}
					<TagInput
						value={(values[field.key] as string[]) ?? []}
						placeholder={field.placeholder ?? ''}
						onchange={(next) => set(field.key, next)}
					/>
				{:else if field.type === 'number'}
					<div class="numwrap">
						<input
							id="opt-{field.key}"
							class="input"
							type="number"
							min={field.min}
							max={field.max}
							step={field.step}
							value={Number(values[field.key] ?? 0)}
							oninput={(e) => set(field.key, Number(e.currentTarget.value))}
						/>
						{#if field.unit}<span class="unit">{field.unit}</span>{/if}
					</div>
				{:else}
					<input
						id="opt-{field.key}"
						class="input"
						type="text"
						placeholder={field.placeholder ?? ''}
						value={String(values[field.key] ?? '')}
						oninput={(e) => set(field.key, e.currentTarget.value)}
					/>
				{/if}
			{/if}

			{#if field.hint}<p class="hint">{field.hint}</p>{/if}
		</div>
	{/each}
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 16px 18px;
	}

	.row.inline {
		align-self: center;
		padding-top: 4px;
	}

	.hint {
		margin: 6px 0 0;
		font-size: 11.5px;
		color: var(--text-faint);
		line-height: 1.45;
	}

	.numwrap {
		position: relative;
	}

	.unit {
		position: absolute;
		right: 12px;
		top: 50%;
		transform: translateY(-50%);
		font-size: 12px;
		color: var(--text-faint);
		pointer-events: none;
	}

	@media (max-width: 700px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
</style>
