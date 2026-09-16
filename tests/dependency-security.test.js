import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('ws/package.json');

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }

  return 0;
}

test('installed ws version includes the 8.21.0 security fixes', () => {
  assert.ok(
    compareVersions(version, '8.21.0') >= 0,
    `installed ws ${version} is below secure minimum 8.21.0`,
  );
});
