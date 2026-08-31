import { defineConfig } from 'vitest/config';

// Standalone config on purpose: the unit tests are pure logic and must not
// pull in the SvelteKit plugin (same split as cortex).
export default defineConfig({
	test: {
		include: ['src/lib/**/*.test.ts']
	}
});
