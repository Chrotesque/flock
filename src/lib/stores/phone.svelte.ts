import { MediaQuery } from 'svelte/reactivity';

/**
 * A phone's width, where flock is the Dashboard alone: a bar with the logo
 * and the Dashboard (+layout.svelte), and the Dashboard trimmed to its list
 * (Dashboard.svelte, DashFilter.svelte). Their `@media (max-width: 640px)`
 * rules cannot read this value: keep them one number.
 */
export const PHONE_MAX = 640;

export const phone = new MediaQuery(`max-width: ${PHONE_MAX}px`, false);
