// Automated tests of Paraph, run in a phone-sized Chrome.
//   npm test              all tests (builds the app first)
//   npm run test:ui       interactive window: pick a test, watch it step by step
//   npm run test:voir     tests one by one in a visible phone window, slowed down, each one filmed
//   npm run test:report   last results as a web page (with the videos of test:voir)
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
export default defineConfig({
  testDir: 'tests',
  timeout: 120_000,            // photos: text recognition can take a while
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'on-failure' }]],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Pixel 7'],
    locale: 'fr-FR',
    acceptDownloads: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: process.env.PW_NOVIDEO ? 'off' : 'retain-on-failure',
    // a Chrome already installed can be used instead of the one Playwright downloads
    launchOptions: process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME, args: ['--no-sandbox'] } : {}
  },
  projects: [
    { name: 'android-phone' },
    // same tests, watched: slowed down so each tap can be followed, and filmed
    {
      name: 'voir',
      use: {
        video: process.env.PW_NOVIDEO ? 'off' : { mode: 'on', size: { width: 412, height: 915 } },
        launchOptions: { slowMo: 350, ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME, args: ['--no-sandbox'] } : {}) }
      }
    }
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000
  }
});
