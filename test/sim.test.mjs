import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, playerPolicies, hostPolicies } from '../src/sim.mjs';
test('batch policies are reproducible, cover every pairing and measure resource floors without models',async()=>{
  const a=await simulate({runs:2}),b=await simulate({runs:2});assert.deepEqual(a,b);
  assert.equal(a.modelRequests,0);assert.equal(a.rows.length,playerPolicies.length*hostPolicies.length);
  for(const row of a.rows) {for(const metric of ['survivalRate','truthRate','lockRate','correctLockRate','falseExileRate','falseKillRate'])assert(row[metric]>=0&&row[metric]<=1);assert(row.truthRate<=row.survivalRate);assert(row.correctLockRate<=row.lockRate);assert(row.minimum<=row.medianMinimum);assert.equal(row.minimum,Math.min(...Object.values(row.resourceMinimum)));}
  await assert.rejects(simulate({runs:0}),/--runs/);
});
