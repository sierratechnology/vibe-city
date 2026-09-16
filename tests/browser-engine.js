import {chromium, firefox} from 'playwright';

const browserEngines = {chromium, firefox};

export function resolveBrowserEngine(name) {
  const browserEngine = Object.hasOwn(browserEngines, name) ? browserEngines[name] : undefined;
  if (!browserEngine) {
    throw new Error(`Unsupported browser engine "${name}". Expected chromium or firefox.`);
  }
  return browserEngine;
}

export function launchBrowser(name) {
  const browserEngine = resolveBrowserEngine(name);
  const options = name === 'chromium'
    ? {
        headless: true,
        executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        args: ['--use-angle=metal'],
      }
    : {headless: true};
  return browserEngine.launch(options);
}
