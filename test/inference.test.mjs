import test from 'node:test';
import assert from 'node:assert/strict';
import {infer} from '../src/inference.mjs';
const crew=['a','b','c','d','e','f','g','h'].map(id=>({id,alive:true}));
const sight=(day,suspects,incident=`incident-${day}`)=>({id:`s-${day}`,kind:'sighting',day,window:'aftermath',location:'cargo',suspects,credibility:2,incident});
test('independent dates rank recurrent suspects; duplicate reports and prose do not add support',()=>{
 const evidence=[sight(1,['a','b']),sight(2,['a','c']),sight(3,['a','d']),sight(4,['a','e'])];
 const answer=infer({crew,evidence});assert.equal(answer.target,'a');assert.equal(answer.ranking[0].days,4);
 assert.deepEqual(infer({crew,evidence:evidence.flatMap(f=>[f,{...f,id:f.id+'copy',flavor:'真凶是b'}])}),answer);
 assert.equal(infer({crew,evidence:[sight(1,['a','b']),sight(1,['a','c'],'other')]}).target,null);
});
test('same-window verified access contradicts a claim; ambiguous sightings and another window cannot prove a lie',()=>{
 const claim={id:'claim',kind:'claim',day:1,window:'task',location:'medbay',subject:'a',by:'a'};
 const access={id:'access',kind:'access',day:1,window:'task',location:'cargo',present:['a'],credibility:3};
 const result=infer({crew,evidence:[claim,access]});assert.equal(result.target,'a');assert.equal(result.conflicts[0].conclusive,true);
 assert.equal(infer({crew,evidence:[claim,{...access,window:'aftermath'}]}).conflicts.length,0);
 assert.equal(infer({crew,evidence:[claim,{...sight(1,['a','b']),window:'task'}]}).conflicts.length,0);
 const forged=infer({crew,evidence:[claim,{...access,credibility:2}]});assert.equal(forged.target,null);assert.equal(forged.conflicts[0].conclusive,false);
});
test('small self-reported withdrawals account for noise without erasing other episodes',()=>{
 const evidence=[sight(1,['a','b']),{id:'w',kind:'withdraw',day:1,actor:'a',amount:2,incident:'incident-1'}];
 assert.equal(infer({crew,evidence}).ranking[0].score,0);
 const next=infer({crew,evidence:[...evidence,sight(2,['a','c'])]});assert(next.ranking.find(r=>r.id==='a').score>0);
});
