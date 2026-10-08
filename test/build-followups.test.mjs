import test from 'node:test';
import assert from 'node:assert/strict';
import { World, replay } from '../src/world.mjs';
import { FixtureAgent, runRound } from '../src/agents.mjs';
import { route, validateRoutes, projectRoute } from '../src/builds.mjs';
import { buildPlan, simulateBuilds } from '../src/build-sim.mjs';
import { GameStore, routeIssues, placeCrew } from '../client/model.ts';

const cash=()=>route({id:'cash',label:'拆取',suppliesCost:0,restore:{oxygen:0,power:0,supplies:6}});
const next=()=>({title:'旁路负载测试',description:'新旁路需要测试，或拆走测试余料。',asset:'power',duration:3,penalty:7,
  routes:[route({id:'stabilize',label:'稳固连接',suppliesCost:3,repair:1,restore:{oxygen:0,power:8,supplies:0}}),cash()]});
const routes=()=>[route({id:'fit',label:'改装',suppliesCost:4,rewardComponent:'maintenance_link',followUp:'generated',followUpEvent:next()}),cash()];
const task=(actor,e,routeId='fit',card=null)=>({actor,slot:e.id,route:routeId,verb:'repair',card,attend:false});
const args=(over={})=>({approach:'work',share:true,delivery:'direct',reveal_ids:[],claims:[],accuse:'none',note:'执行方案。',memory:'',message:{to:'none',content:''},covert:{kind:'none',asset:'oxygen',amount:0,target:'none'},...over});
function setup(){const w=new World({seed:42});w.state.duty=['engineer','medic','security','clerk'];w.state.resources={oxygen:40,power:40,supplies:50};const e=w.event('新回路','公开改装机会。','oxygen','build');e.routes=routes();w.state.events=[e];return {w,e};}
const commit=(w,id,over={})=>w.call(id,'complete_assignment',args(over),id);

test('build work is a public contract for humans and host; covert remains separate',()=>{
  for(const host of [false,true]){
    const {w,e}=setup();if(host)w.state.host='engineer';else w.state.host='scientist';
    w.begin({assignments:[task('engineer',e)]});assert.deepEqual(w.tool('engineer').function.parameters.properties.approach.enum,['work']);
    const before=w.hash();for(const approach of ['defer','fast','careful'])assert.throws(()=>commit(w,'engineer',{approach}),/approach/);assert.equal(w.hash(),before);
    commit(w,'engineer',host?{covert:{kind:'consume',asset:'oxygen',amount:2,target:'none'}}:{});
    assert.equal(w.state.components.length,1);assert.equal(w.state.resources.supplies,46);
    if(host)assert.equal(w.state.hiddenPending.length,1);
  }
});

test('duplicate rewards are blocked before spending across installed and same-day choices',()=>{
  const {w,e}=setup();const second=w.event('另一个机会','公开事件。','power','build');second.routes=routes();w.state.events.push(second);
  const both=[task('engineer',e),task('medic',second)],before=w.hash();
  assert.throws(()=>w.begin({assignments:both}),/component_already/);assert.equal(w.hash(),before);
  assert(routeIssues(w.project(),both).some(m=>m.includes('同名组件')));
  w.begin({assignments:[task('engineer',e)]});commit(w,'engineer');
  w.state.phase='planning';const view={id:'test',mode:'fixture',status:'idle',error:null,...w.project()};
  const store=new GameStore();store.accept(view);store.place('medic',second.id);
  assert.equal(store.plan[0].route,'cash');assert.equal(store.selectRoute(second.id,'fit'),false);
  assert.throws(()=>w.validatePlan({assignments:[task('medic',second)]}),/component_already/);
});

test('late duplicate safeguard retains the event, fee and material',()=>{
  const {w,e}=setup();e.routes[0].card='parts';const card=w.state.hand.find(c=>c.type==='parts');
  w.begin({assignments:[task('engineer',e,'fit',card.id)]});w.state.components.push({type:'maintenance_link',installedDay:1});
  commit(w,'engineer');assert.equal(w.state.resources.supplies,50);assert(w.state.hand.some(c=>c.id===card.id));assert(w.state.events.some(x=>x.id===e.id));assert.equal(w.state.pendingEvents.length,0);
});

test('generated follow-ups validate one level of mechanical choices before any mutation',()=>{
  const {w}=setup();validateRoutes(routes(),w.state);
  for(const mutate of [r=>delete r[0].followUpEvent,r=>r[0].followUpEvent.routes[0].restore={oxygen:16,power:16,supplies:16},r=>r[0].followUpEvent.routes[0].rewardComponent='maintenance_link',r=>r[0].followUpEvent.routes[0].followUp='generated',r=>r[0].followUpEvent.routes[0].followUpEvent=next(),r=>r[1].followUpEvent=next(),r=>r[0].followUpEvent.source='private']){
    const value=routes();mutate(value);assert.throws(()=>validateRoutes(value,w.state));
  }
  const preview=projectRoute(routes()[0]).followUpEvent;assert.equal(preview.routes.length,2);assert(preview.routes[0].outcome.includes('电力 +8'));assert.equal(preview.routes[1].card,'none');
});

test('only chosen consequences queue; capacity delays preserve content, attribution and duration',()=>{
  for(const selected of ['fit','cash']) {
    const {w,e}=setup();w.begin({assignments:[task('engineer',e,selected)]});commit(w,'engineer');
    assert.equal(w.state.pendingEvents.length,selected==='fit'?1:0);if(selected==='cash')continue;
    const choice=w.ledger.find(e=>e.kind==='build_choice');w.rules.eventLimit=1;
    w.state.events=[w.event('占位','未完成。','oxygen','repair')];w.state.day=2;w.flushFollowUps();assert.equal(w.state.pendingEvents.length,1);
    w.state.events=[];w.state.day=4;w.flushFollowUps();const follow=w.state.events[0];
    assert.equal(follow.title,next().title);assert.equal(follow.deadline,6);assert.equal(follow.penalty,7);assert.deepEqual(follow.routes,next().routes);assert.deepEqual(follow.sources,[choice.id]);
    w.state.phase='planning';w.state.duty=['medic'];w.begin({assignments:[task('medic',follow,'cash')]});commit(w,'medic');
    assert.equal(w.state.events.length,0);assert.equal(w.state.pendingEvents.length,0);assert.equal(w.state.resources.supplies,52);
  }
});

test('simple v1 snapshots preserve prior choices; new commands replay in v7',async()=>{
  const oldWorld=new World({seed:42});await runRound(oldWorld,new FixtureAgent(),buildPlan(oldWorld.project(),'维护联动'));
  const old=oldWorld.export();old.runtime='event-builds-v1';const w=World.restore(old);
  assert.deepEqual(w.state.components,old.state.components);assert.deepEqual(w.state.events,old.state.events);assert.deepEqual(w.state.pendingEvents,old.state.pendingEvents);assert.equal(replay(old).verified,false);
  w.nextDay();await runRound(w,new FixtureAgent(),buildPlan(w.project(),'维护联动'));
  assert.equal(w.export().runtime,'event-opportunities-v9');assert.equal(replay(w.export()).hash,w.hash());
});

test('build reasoning uses public evidence, reserves the exile target and respects worker/card budgets',()=>{
  const {w}=setup();w.state.day=4;const view=w.project();view.evidence=Array.from({length:3},(_,i)=>({id:`public-${i}`,kind:'sighting',day:i+1,window:'aftermath',location:'engine',incident:`incident-${i}`,suspects:['engineer'],credibility:2}));
  const plan=buildPlan(view,'调查补给',{reasoning:true});assert.equal(plan.assignments[0].slot,'airlock');assert.equal(plan.assignments[0].actor,'engineer');
  assert.equal(plan.assignments.filter(a=>a.actor==='engineer').length,1);w.validatePlan(plan);
  assert(!buildPlan(view,'调查补给').assignments.some(a=>a.slot==='airlock'));
  assert.deepEqual(plan,buildPlan({...view,host:'medic'},'调查补给',{reasoning:true}));
});

test('new voyages offer no textual inference target; legacy inference option still replays',async()=>{
  const control=await simulateBuilds({runs:2}),reasoning=await simulateBuilds({runs:2,reasoning:true,verifyReplay:true});
  assert(control.rows.every(r=>r.truthRate===0&&r.falseExileRate===0));assert.equal(reasoning.reasoning,true);assert.equal(reasoning.modelRequests,0);
  assert(reasoning.rows.every(r=>r.truthRate===0&&r.falseExileRate===0));for(const r of reasoning.rows)for(const key of ['truthRate','falseExileRate','falseKillRate','correctLockRate'])assert(r[key]>=0&&r[key]<=1);
});
