import assert from 'node:assert/strict';
import test from 'node:test';
import * as playwright from 'playwright';

let resolveBrowserEngine;
try {
  ({resolveBrowserEngine} = await import('./browser-engine.js'));
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

test('selects Chromium and Firefox and rejects unsupported browser engines', () => {
  assert.equal(typeof resolveBrowserEngine, 'function', 'browser-engine resolver must exist');
  assert.equal(resolveBrowserEngine('chromium'), playwright.chromium);
  assert.equal(resolveBrowserEngine('firefox'), playwright.firefox);
  assert.throws(
    () => resolveBrowserEngine('webkit'),
    /Unsupported browser engine "webkit"\. Expected chromium or firefox\./,
  );
  assert.throws(
    () => resolveBrowserEngine('constructor'),
    /Unsupported browser engine "constructor"\. Expected chromium or firefox\./,
  );
});
