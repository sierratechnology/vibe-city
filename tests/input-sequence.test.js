import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {WebSocket} from 'ws';
import {startServer} from '../server/index.js';
import {apiAccount} from './auth-helper.js';

function inbox(ws) {
  const queued = [];
  const waiting = [];
  ws.on('message', raw => {
    const message = JSON.parse(raw);
    const match = waiting.findIndex(waiter => waiter.predicate(message));
    if (match >= 0) waiting.splice(match, 1)[0].resolve(message);
    else queued.push(message);
  });
  return predicate => {
    const match = queued.findIndex(predicate);
    if (match >= 0) return Promise.resolve(queued.splice(match, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiting.findIndex(waiter => waiter.resolve === resolve);
        if (index >= 0) waiting.splice(index, 1);
        reject(new Error('Timed out waiting for WebSocket message'));
      }, 2000);
      waiting.push({predicate, resolve: message => { clearTimeout(timer); resolve(message); }});
    });
  };
}

async function connect(base, account) {
  const ws = new WebSocket(base.replace('http:', 'ws:'), {headers: {Cookie: account.cookie}});
  const next = inbox(ws);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({type: 'join', character: account.character}));
  await next(message => message.type === 'welcome');
  return {ws, next};
}

test('state acknowledges only the receiving connection input sequence', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-sequence-'));
  const app = startServer({port: 0, host: '127.0.0.1', saveFile: path.join(directory, 'world.json')});
  await new Promise(resolve => app.server.once('listening', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const sockets = [];
  try {
    const first = await connect(base, await apiAccount(base, 'sequence-a'));
    const second = await connect(base, await apiAccount(base, 'sequence-b'));
    sockets.push(first.ws, second.ws);
    first.ws.send(JSON.stringify({type: 'input', sequence: 7, x: 1, z: 0}));
    const firstState = await first.next(message => message.type === 'state' && message.inputAck === 7);
    const secondState = await second.next(message => message.type === 'state');
    assert.equal(firstState.inputAck, 7);
    assert.equal(secondState.inputAck, null);
    assert.equal(Object.hasOwn(firstState.state, 'inputAck'), false);
    assert.equal(Object.hasOwn(secondState.state, 'inputAck'), false);
  } finally {
    for (const ws of sockets) ws.terminate();
    await app.close();
    fs.rmSync(directory, {recursive: true});
  }
});
