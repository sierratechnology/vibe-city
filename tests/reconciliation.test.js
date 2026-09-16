import assert from 'node:assert/strict';
import test from 'node:test';

let createInputReconciler;
try {
  ({createInputReconciler} = await import('../client/reconciliation.js'));
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

test('bounds pending inputs and applies acknowledged soft or hard correction', () => {
  assert.equal(typeof createInputReconciler, 'function', 'input reconciler must exist');
  const reconciler = createInputReconciler();
  for (let index = 0; index < 40; index++) reconciler.queue({x: 1, z: 0});
  assert.equal(reconciler.pendingCount, 32);
  assert.deepEqual(reconciler.pendingSequences, Array.from({length: 32}, (_, index) => index + 8));

  const soft = reconciler.reconcile({x: 1, z: 0}, {x: 0, z: 0}, 20);
  assert.ok(Math.abs(soft.x-.75)<1e-9);assert.equal(soft.z,0);assert.equal(soft.hardCorrected,false);
  assert.equal(reconciler.pendingCount, 19);
  assert.equal(reconciler.latestAck, 20);

  const hard = reconciler.reconcile({x: 3, z: 0}, {x: 0, z: 0}, 39);
  assert.deepEqual(hard, {x: 0, z: 0, hardCorrected: true});
  assert.equal(reconciler.pendingCount, 0);

  reconciler.reset();
  assert.equal(reconciler.queue({x: 0, z: 1}).sequence, 0);
  reconciler.reconcile({x: 0, z: 0}, {x: 0, z: 0}, 39);
  assert.equal(reconciler.latestAck, null, 'an acknowledgement from the prior connection epoch must be ignored');
  assert.deepEqual(reconciler.pendingSequences, [0]);
});

 test('soft corrections take the short path across longitude and pole seams', async()=>{
 const {CIRCUMFERENCE,travel,planetDistance}=await import('../shared/planet.js');
 for(const predicted of [{x:CIRCUMFERENCE/2-.1,z:0},{x:0,z:CIRCUMFERENCE/4-.1}]){
  const authoritative=travel(predicted,.3,.3),r=createInputReconciler();r.queue({x:1,z:1});
  const corrected=r.reconcile(predicted,authoritative,0);
  assert.equal(corrected.hardCorrected,false);assert.ok(planetDistance(corrected,authoritative)<planetDistance(predicted,authoritative));
 }
});
