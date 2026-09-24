import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {browserAccount, startTestServer} from './auth-helper.js';
import {launchBrowser} from './browser-engine.js';
import {createAcquisitionTracker, createCleanupSession, runWithCleanup} from './frame-time-cleanup.js';
import {MAX_FRAME_TIMESTAMPS, summarizeFrameTimes} from './frame-time-sampler.js';

const WARMUP_MS = 3_000;
const MEASUREMENT_MS = 10_000;
const REFERENCE_BUDGET_MS = 1_000 / 60;
const MIN_FRAME_INTERVALS = 30;
const JOURNEY_TIMEOUT_MS = 180_000;
const ACQUISITION_TIMEOUT_MS = 15_000;
const CLOSE_TIMEOUT_MS = 5_000;
const CLEANUP_TIMEOUT_MS = 20_000;
const viewports = [
  {name: 'desktop', viewport: {width: 1440, height: 900}, hasTouch: false},
  {name: 'phone-sized-emulation', viewport: {width: 390, height: 844}, hasTouch: true},
];

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-frame-time-'));
const app = startTestServer({port: 0, host: '127.0.0.1', saveFile: path.join(directory, 'world.json')});
const browsers = [];
const contexts = [];
const pages = [];
const acquisitions = createAcquisitionTracker({closeTimeoutMs: CLOSE_TIMEOUT_MS});
const cleanupSession = createCleanupSession();
let appClosed = false;

function bounded(promise, milliseconds, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds} ms`)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function closeAll() {
  let trackedBrowsers = [];

  await cleanupSession.cleanup({
    acquisitions,
    resources: () => {
      trackedBrowsers = [...browsers];
      const resources = [
        ...contexts.map((context, index) => ({
          label: `browser context ${index + 1} close`,
          close: async () => {
            await context.close();
            const trackedIndex = contexts.indexOf(context);
            if (trackedIndex !== -1) contexts.splice(trackedIndex, 1);
            for (let pageIndex = pages.length - 1; pageIndex >= 0; pageIndex -= 1) {
              if (pages[pageIndex].context === context) pages.splice(pageIndex, 1);
            }
          },
        })),
        ...browsers.map((browser, index) => ({
          label: `browser ${index + 1} close`,
          close: async () => {
            await browser.close();
            const trackedIndex = browsers.indexOf(browser);
            if (trackedIndex !== -1) browsers.splice(trackedIndex, 1);
          },
        })),
      ];
      if (!appClosed) resources.push({
        label: 'server/listener/timer/socket close',
        close: async () => {
          await app.close();
          appClosed = true;
        },
      });
      return resources;
    },
    timeoutMs: CLEANUP_TIMEOUT_MS,
    removeTemporaryState: {
      label: 'temporary state remove',
      run: async () => fs.rmSync(directory, {recursive: true, force: true}),
    },
    postconditions: [
      {label: 'server stopped', check: async () => !app.server.listening},
      {label: 'tracked browser contexts released', check: async () => contexts.length === 0},
      {label: 'tracked browsers released', check: async () => browsers.length === 0},
      {label: 'tracked pages released', check: async () => pages.length === 0},
      {label: 'in-flight acquisitions released', check: async () => acquisitions.size === 0},
      {label: 'launched browsers disconnected', check: async () => trackedBrowsers.every(browser => !browser.isConnected())},
      {label: 'temporary directory removed', check: async () => !fs.existsSync(directory)},
    ],
  });
}

async function waitForListening() {
  if (app.server.listening) return;
  await bounded(new Promise((resolve, reject) => {
    app.server.once('listening', resolve);
    app.server.once('error', reject);
  }), 5_000, 'server listen');
}

async function captureFrameTimestamps(page) {
  return page.evaluate(async ({warmupMs, measurementMs, maximum}) => {
    async function framesFor(milliseconds, collect) {
      return new Promise((resolve, reject) => {
        const timestamps = [];
        let animationFrame;
        const deadline = setTimeout(() => {
          cancelAnimationFrame(animationFrame);
          reject(new Error(`requestAnimationFrame window exceeded ${milliseconds + 2000} ms`));
        }, milliseconds + 2_000);
        let startedAt;
        const onFrame = timestamp => {
          if (startedAt === undefined) startedAt = timestamp;
          if (collect) {
            if (timestamps.length >= maximum) {
              clearTimeout(deadline);
              reject(new Error(`frame timestamp capture exceeded ${maximum} samples`));
              return;
            }
            timestamps.push(timestamp);
          }
          if (timestamp - startedAt >= milliseconds) {
            clearTimeout(deadline);
            resolve(timestamps);
            return;
          }
          animationFrame = requestAnimationFrame(onFrame);
        };
        animationFrame = requestAnimationFrame(onFrame);
      });
    }

    await framesFor(warmupMs, false);
    return framesFor(measurementMs, true);
  }, {warmupMs: WARMUP_MS, measurementMs: MEASUREMENT_MS, maximum: MAX_FRAME_TIMESTAMPS});
}

async function measureScenario(browserName, browser, base, scenario) {
  const externalRequests = [];
  const pageErrors = [];
  const requestFailures = [];
  const context = await acquisitions.acquire({
    label: `${browserName} ${scenario.name} context`,
    timeoutMs: ACQUISITION_TIMEOUT_MS,
    acquire: () => browser.newContext({
      viewport: scenario.viewport,
      screen: scenario.viewport,
      hasTouch: scenario.hasTouch,
      deviceScaleFactor: scenario.hasTouch ? 2 : 1,
      reducedMotion: 'reduce',
    }),
    track: acquiredContext => contexts.push(acquiredContext),
    closeLate: acquiredContext => acquiredContext.close(),
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
      externalRequests.push(route.request().url());
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  const page = await acquisitions.acquire({
    label: `${browserName} ${scenario.name} page`,
    timeoutMs: ACQUISITION_TIMEOUT_MS,
    acquire: () => context.newPage(),
    track: acquiredPage => pages.push({page: acquiredPage, context}),
    closeLate: acquiredPage => acquiredPage.close(),
  });
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(10_000);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) externalRequests.push(request.url());
  });
  page.on('requestfailed', request => requestFailures.push(`${request.url()}: ${request.failure()?.errorText || 'failed'}`));

  await page.goto(base, {waitUntil: 'domcontentloaded', timeout: 10_000});
  await browserAccount(page, `Frame ${browserName} ${scenario.name}`);
  await page.locator('#enter').click();
  await page.waitForFunction(() => {
    const diagnostics = window.vibeDiagnostics;
    const canvas = document.querySelector('canvas');
    return diagnostics?.connected
      && diagnostics.player
      && diagnostics.drawCalls > 0
      && diagnostics.triangles > 0
      && canvas?.clientWidth > 0
      && canvas?.clientHeight > 0;
  }, null, {timeout: 10_000});

  const timestamps = await bounded(captureFrameTimestamps(page), WARMUP_MS + MEASUREMENT_MS + 4_000, 'frame capture');
  const summary = summarizeFrameTimes(timestamps, {
    budgetMs: REFERENCE_BUDGET_MS,
    minSamples: MIN_FRAME_INTERVALS,
  });
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('; ')}`);
  assert.deepEqual(requestFailures, [], `request failures: ${requestFailures.join('; ')}`);
  assert.deepEqual(externalRequests, [], `external requests: ${externalRequests.join('; ')}`);

  await bounded(context.close(), CLOSE_TIMEOUT_MS, 'browser context close');
  contexts.splice(contexts.indexOf(context), 1);
  pages.splice(pages.findIndex(entry => entry.page === page), 1);
  return {
    browser: browserName,
    browserVersion: browser.version(),
    scenario: scenario.name,
    viewport: scenario.viewport,
    touchEmulated: scenario.hasTouch,
    warmupMs: WARMUP_MS,
    measurementWindowMs: MEASUREMENT_MS,
    timestampCount: timestamps.length,
    ...summary,
    pageErrors: pageErrors.length,
    requestFailures: requestFailures.length,
    externalRequests: externalRequests.length,
  };
}

async function run() {
  await waitForListening();
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const results = [];
  for (const browserName of ['chromium', 'firefox']) {
    const browser = await acquisitions.acquire({
      label: `${browserName} launch`,
      timeoutMs: ACQUISITION_TIMEOUT_MS,
      acquire: () => launchBrowser(browserName),
      track: acquiredBrowser => browsers.push(acquiredBrowser),
      closeLate: acquiredBrowser => acquiredBrowser.close(),
    });
    for (const scenario of viewports) {
      results.push(await measureScenario(browserName, browser, base, scenario));
    }
    await bounded(browser.close(), CLOSE_TIMEOUT_MS, `${browserName} close`);
    browsers.splice(browsers.indexOf(browser), 1);
  }
  return results;
}

const results = await runWithCleanup(
  () => bounded(run(), JOURNEY_TIMEOUT_MS, 'complete browser journey'),
  closeAll,
);
console.log(JSON.stringify({
  referenceThreshold: '16.666666666666668 ms measurement reference; not a product acceptance budget',
  results,
}, null, 2));
