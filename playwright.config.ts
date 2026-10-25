import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the production build: the service worker,
// and therefore airplane mode, only exist there.
export default defineConfig({
	testDir: 'tests',
	fullyParallel: false,
	workers: 1,
	reporter: [['list']],
	use: {
		...devices['Pixel 7'],
		baseURL: 'http://localhost:4180',
		// Uses the Chrome installed on the machine instead of downloading a browser.
		channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
		trace: 'retain-on-failure'
	},
	webServer: {
		command: 'pnpm build && pnpm preview --strictPort',
		url: 'http://localhost:4180',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	}
});
