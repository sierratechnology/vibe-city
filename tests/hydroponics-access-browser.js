import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apiAccount, startTestServer} from './auth-helper.js';
import {launchBrowser, resolveBrowserEngine} from './browser-engine.js';

const engine = process.argv[2] || 'chromium';
const mode = process.argv[3] || 'desktop';
resolveBrowserEngine(engine);
if (!['desktop', 'touch'].includes(mode)) throw Error(`Unknown hydroponics access browser mode: ${mode}`);
if (mode === 'touch' && engine !== 'chromium') throw Error('CDP real-touch mode requires Chromium.');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-hydroponics-access-'));
const saveFile = path.join(directory, 'world.json');
const app = startTestServer({port: 0, host: '127.0.0.1', saveFile});
await new Promise(resolve => app.server.once('listening', resolve));
const browser = await launchBrowser(engine);
const contexts = [];
const errors = [];
const options = mode === 'touch'
  ? {viewport: {width: 390, height: 844}, screen: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2}
  : {viewport: {width: 1440, height: 900}};
let accountIndex = 0;

async function touch(page, session, locator) {
  const box = await locator.evaluate(element => {
    element.scrollIntoView({block: 'center'});
    const rect = element.getBoundingClientRect();
    return {x: rect.x, y: rect.y, width: rect.width, height: rect.height, visible: element.isConnected && getComputedStyle(element).visibility === 'visible' && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === element};
  });
  assert.ok(box.visible && box.y >= 0 && box.y + box.height <= 844, 'touch target is visible inside phone viewport');
  const point = {id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2, radiusX: 2, radiusY: 2};
  await session.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [point]});
  await session.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
}

async function explorer(name) {
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const account = await apiAccount(base, accountIndex++);
  const context = await browser.newContext(options);
  contexts.push(context);
  const [cookie] = account.cookie.split('=');
  await context.addCookies([{name: cookie, value: account.cookie.slice(cookie.length + 1), url: base}]);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.locator('#accountGate').waitFor({state: 'attached'});
  await page.locator('#findGame').waitFor({state: 'visible'});
  await page.locator('#findGame').click();
  await page.locator('#character').selectOption(account.character);
  await page.locator('#enter').click();
  await page.waitForFunction(() => window.vibeDiagnostics?.connected);
  const session = mode === 'touch' ? await context.newCDPSession(page) : null;
  if (session) await session.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 1});
  return {page, session, id: await page.evaluate(() => window.vibeDiagnostics.id)};
}

const activate = (actor, locator) => mode === 'touch' ? touch(actor.page, actor.session, locator) : locator.click();
async function openHabitat(actor) {
  await activate(actor, actor.page.locator('#terminalAction'));
  await activate(actor, actor.page.getByRole('button', {name: 'Habitat', exact: true}));
}

try {
  const owner = await explorer('Hydroponics Owner');
  const collaborator = await explorer('Hydroponics Collaborator');
  const stranger = await explorer('Hydroponics Stranger');
  const ownerPlayer = app.game.world.players[owner.id];
  const collaboratorPlayer = app.game.world.players[collaborator.id];
  const strangerPlayer = app.game.world.players[stranger.id];
  for (const player of [ownerPlayer, collaboratorPlayer, strangerPlayer]) Object.assign(player, {x: 0, z: 3});
  app.game.world.time = 10;
  app.game.world.structures.push({id: 'browser-bed', type: 'garden', x: 0, z: 3, rotation: 0, health: 200, owner: owner.id, readyAt: 10});
  await Promise.all([owner, collaborator, stranger].map(actor => actor.page.waitForFunction(() => window.vibeDiagnostics.state.structures.some(structure => structure.id === 'browser-bed'))));
  await Promise.all([openHabitat(owner), openHabitat(collaborator), openHabitat(stranger)]);

  assert.equal(await collaborator.page.getByRole('button', {name: 'Harvest', exact: true}).count(), 0);
  assert.match(await collaborator.page.locator('#structureControls-browser-bed').innerText(), /Only the builder or an authorized collaborator may plant or harvest/);
  assert.equal(await stranger.page.getByRole('button', {name: 'Harvest', exact: true}).count(), 0);

  const candidate = owner.page.locator('#hydroponicsAccessCandidate-browser-bed');
  await candidate.selectOption(collaborator.id);
  const grant = owner.page.getByRole('button', {name: 'Grant hydroponic access', exact: true});
  if (mode === 'desktop') { await grant.focus(); await owner.page.keyboard.press('Enter'); } else await activate(owner, grant);
  await owner.page.waitForFunction(id => window.vibeDiagnostics.state.structures.find(structure => structure.id === 'browser-bed')?.hydroponicsGrantedTo?.some(character => character.id === id), collaborator.id);
  await collaborator.page.waitForFunction(() => window.vibeDiagnostics.state.structures.find(structure => structure.id === 'browser-bed')?.canUseHydroponics === true);

  const harvestButton = collaborator.page.getByRole('button', {name: 'Harvest', exact: true});
  assert.equal(await harvestButton.isEnabled(), true);
  await activate(collaborator, harvestButton);
  await collaborator.page.waitForFunction(() => window.vibeDiagnostics.player.inventory.ration === 1);
  assert.equal(collaboratorPlayer.inventory.fiber, 2);
  assert.equal(collaboratorPlayer.inventory.ration, 1);
  assert.equal(ownerPlayer.inventory.fiber, 0);
  assert.equal(ownerPlayer.inventory.ration, 0);

  const revoke = owner.page.getByRole('button', {name: `Revoke hydroponic access for ${collaboratorPlayer.name}`, exact: true});
  if (mode === 'desktop') {
    await revoke.focus();
    await owner.page.keyboard.press('Enter');
    await owner.page.waitForTimeout(300);
    assert.equal(await owner.page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Grant hydroponic access');
  } else await activate(owner, revoke);
  await collaborator.page.waitForFunction(() => window.vibeDiagnostics.state.structures.find(structure => structure.id === 'browser-bed')?.canUseHydroponics !== true);
  app.game.world.structures.find(structure => structure.id === 'browser-bed').readyAt = app.game.world.time;
  await collaborator.page.waitForTimeout(250);
  assert.equal(await collaborator.page.getByRole('button', {name: 'Harvest', exact: true}).count(), 0);
  const before = structuredClone(collaboratorPlayer.inventory);
  assert.equal(app.game.action(collaborator.id, {type: 'garden', id: 'browser-bed'}).ok, false);
  assert.deepEqual(collaboratorPlayer.inventory, before);
  assert.equal(app.game.action(stranger.id, {type: 'garden', id: 'browser-bed'}).ok, false);
  assert.deepEqual(errors, []);
  console.log(`${engine}: ${mode} private owner controls, keyboard/touch grant, collaborator harvest, stranger denial, immediate revoke, and focus restoration passed`);
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
  await app.close();
  fs.rmSync(directory, {recursive: true, force: true});
}
