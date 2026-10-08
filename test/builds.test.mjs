import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { World, replay } from '../src/world.mjs';
import { FixtureAgent, LiveAgent, runRound } from '../src/agents.mjs';
import { COMPONENT_TYPES, RULES } from '../src/content.mjs';
import { route, validateRoutes, coldStorageRoutes, fixtureBuildEvent } from '../src/builds.mjs';
import { buildPlan, simulateBuilds } from '../src/build-sim.mjs';
import { GameStore, placeCrew, validateDraft, routeIssues } from '../client/model.ts';

const args=(over={})=>({approach:'work',share:true,delivery:'direct',reveal_ids:[],claims:[],accuse:'none',note:'按方案执行。',memory:'',message:{to:'none',content:''},covert:{kind:'none',asset:'oxygen',amount:0,target:'none'},...over});
const commit=(w,id,over={})=>w.call(id,'complete_assignment',args(over),id);
const task=(actor,slot,card=null,routeId)=>({actor,slot,card,attend:false,verb:routeId?'repair':'assign',...(routeId?{route:routeId}:{})});
const supplyRoute=()=>route({id:'cash',label:'拆取',suppliesCost:0,restore:{oxygen:0,power:0,supplies:12}});
const basicRoutes=()=>[route({id:'fit',label:'改装',rewardComponent:'maintenance_link'}),supplyRoute()];
function setup(routes=basicRoutes()) {
  const w=new World({seed:42});w.state.duty=['engineer','medic','security','clerk'];w.state.resources={oxygen:40,power:40,supplies:50};
  const e=w.event('构筑测试','公开故障。','oxygen','build');e.routes=routes;w.state.events=[e];return {w,e};
}
function install(w,...types){for(const type of types)w.state.components.push({type,...COMPONENT_TYPES[type],installedDay:0,source:'test'});}
function finish(w){w.resolveHidden();w.prepareSettlement();w.call('world','settle_round',{summary:'公开结果。',source_ids:w.publicRecords().slice(-2).map(e=>e.id),events:[]},'world');w.finishDay();}

test('fixed cold-storage contracts fit budget, have a material-free exit, and expose full route outcomes',()=>{
  const w=new World({seed:42});assert.doesNotThrow(()=>validateRoutes(coldStorageRoutes(),w.state,{coldStorage:true,asset:'supplies'}));
  const e=w.project().slots.find(e=>e.eventKind==='cold_storage');assert.equal(e.routes.length,2);
  for(const r of e.routes)for(const field of ['requirements','outcome','consequence'])assert(r[field]);
});
test('route plans reject missing, conflicting and injected routes without mutating state',()=>{
  const {w,e}=setup(),before=w.hash();
  for(const plan of [[{...task('engineer',e.id),verb:'repair'}], [task('engineer',e.id,null,'missing')], [task('engineer',e.id,null,'fit'),task('medic',e.id,null,'cash')], [task('engineer','pressure:oxygen',null,'fit')]])assert.throws(()=>w.validatePlan({assignments:plan}),/route/);
  assert.equal(w.hash(),before);
});
test('server preflights actual workers, specialty, material and rejects irrelevant card overrides',()=>{
  const {w,e}=setup([route({id:'fit',label:'修复',workers:2,specialty:'oxygen',card:'parts',rewardComponent:'maintenance_link'}),supplyRoute()]);
  const card=w.state.hand.find(c=>c.type==='parts').id;
  assert.throws(()=>w.validatePlan({assignments:[task('engineer',e.id,card,'fit')]}),/workers/);
  assert.throws(()=>w.validatePlan({assignments:[task('medic',e.id,card,'fit'),task('clerk',e.id,null,'fit')]}),/specialty/);
  assert.throws(()=>w.validatePlan({assignments:[task('engineer',e.id,null,'fit'),task('clerk',e.id,null,'fit')]}),/material/);
  assert.throws(()=>w.validatePlan({assignments:[task('engineer',e.id,w.state.hand.find(c=>c.type==='access').id,'cash')]}),/unexpected_material/);
});
test('group consumes material and pays once only after all reports, with idempotent retry',()=>{
  const {w,e}=setup([route({id:'fit',label:'修复',workers:2,card:'parts',suppliesCost:3,restore:{oxygen:10,power:0,supplies:0},rewardComponent:'maintenance_link'}),supplyRoute()]);
  const card=w.state.hand[0].id;
  w.begin({assignments:[task('engineer',e.id,card,'fit'),task('medic',e.id,null,'fit'),task('security',e.id,null,'fit')]});
  commit(w,'engineer');assert(w.state.hand.some(c=>c.id===card));assert.equal(w.state.resources.oxygen,40);
  commit(w,'medic');assert.equal(w.state.components.length,0);
  commit(w,'security');assert.equal(w.state.resources.oxygen,50);assert.equal(w.state.resources.supplies,47);assert.equal(w.state.components.length,1);
  assert(!w.state.hand.some(c=>c.id===card));assert(!w.state.events.length);assert.equal(w.state.buildHistory.length,1);
  const hash=w.hash();commit(w,'security');assert.equal(w.hash(),hash);
});
test('contract workers cannot defer; exhausted supplies leave route costs and material unspent',()=>{
  for(const deferred of [true,false]) {
    const {w,e}=setup([route({id:'fit',label:'协作',workers:2,card:'parts',suppliesCost:8,rewardComponent:'maintenance_link'}),supplyRoute()]);const card=w.state.hand[0].id;
    w.begin({assignments:[task('engineer',e.id,card,'fit'),task('medic',e.id,null,'fit')]});commit(w,'engineer');
    if(!deferred)w.state.resources.supplies=2;
    const before={...w.state.resources};
    if(deferred)assert.throws(()=>commit(w,'medic',{approach:'defer'}),/approach/);else commit(w,'medic');
    assert.deepEqual(w.state.resources,before);assert(w.state.hand.some(c=>c.id===card));assert.equal(w.state.components.length,0);assert.equal(w.state.events.length,1);
  }
});
test('maintenance components wait until next day; then produce logged, daily-capped real gains',()=>{
  const {w,e}=setup();w.begin({assignments:[task('engineer',e.id,null,'fit'),task('security','pressure:oxygen')]});commit(w,'engineer');commit(w,'security');
  assert.equal(w.state.resources.power,40);assert.equal(w.ledger.filter(e=>e.kind==='build_trigger').length,0);
  finish(w);w.nextDay();const actor=w.state.duty[0],before=w.state.resources.power;
  w.begin({assignments:[task(actor,'pressure:oxygen')]});commit(w,actor);
  assert.equal(w.state.resources.power,before+3);assert.equal(w.ledger.filter(e=>e.kind==='build_trigger').length,1);
  const x={asset:'oxygen',actor,out:[]};for(let i=0;i<6;i++)w.triggerComponents('maintenance',x);
  assert.equal(w.state.componentUsage['2:maintenance_link'],3);
});
test('distinct maintenance components stack but failed or deferred maintenance never triggers',()=>{
  const {w}=setup();install(w,'maintenance_saver','reserve_cell');w.begin({assignments:[task('engineer','pressure:oxygen')]});commit(w,'engineer');
  assert.equal(w.state.resources.supplies,49);assert.equal(w.state.resources.power,45);
  for(const approach of ['work','defer']){const {w}=setup();install(w,'maintenance_link');w.state.resources.supplies=0;w.begin({assignments:[task('engineer','pressure:oxygen')]});commit(w,'engineer',{approach});assert.equal(w.state.resources.power,40);assert(!w.ledger.some(e=>e.kind==='build_trigger'));}
});
test('material recycling grants medicine and parts once, and cannot trigger itself recursively',()=>{
  const {w,e}=setup([route({id:'fit',label:'培养',card:'medicine',suppliesCost:0,restore:{oxygen:0,power:0,supplies:8},rewardComponent:'maintenance_link'}),supplyRoute()]);
  install(w,'salvage_loop','medical_recycler','scrap_exchange');const card=w.state.hand.find(c=>c.type==='medicine').id;
  w.begin({assignments:[task('medic',e.id,card,'fit')]});commit(w,'medic');
  assert.equal(w.state.hand.length,RULES.handLimit);assert(w.state.hand.some(c=>c.type==='medicine'&&c.id!==card));
  assert.equal(w.state.resources.supplies,64); // 8 route + 4 rebate + full-hand parts converted to 2.
  assert.equal(w.ledger.filter(e=>e.kind==='build_trigger').length,3);
});
test('recycling also supports the daily medical supply loop without requiring another event offer',()=>{
  const {w}=setup();install(w,'salvage_loop','medical_recycler','scrap_exchange');const medicine=w.state.hand.find(c=>c.type==='medicine');
  w.begin({assignments:[task('medic','pressure:supplies',medicine.id)]});commit(w,'medic');
  assert(!w.state.hand.some(c=>c.id===medicine.id));assert.equal(w.state.hand.filter(c=>c.type==='medicine').length,1);
  assert.equal(w.state.componentUsage['1:medical_recycler'],1);assert.equal(w.state.componentUsage['1:salvage_loop'],1);
  assert(w.state.results[0].outcome.includes('无菌回收箱'));assert(w.state.resources.supplies>50);
});
test('cash route awards no component, permanently closes its alternatives without inventing a compulsory follow-up',()=>{
  const {w,e}=setup(coldStorageRoutes());const plan=['engineer','medic','security'].map(id=>task(id,e.id,null,'rescue'));
  w.begin({assignments:plan});for(const a of plan)commit(w,a.actor);
  assert.equal(w.state.resources.supplies,62);assert.deepEqual(w.state.flags,[]);assert.equal(w.state.components.length,0);
  assert.equal(w.state.pendingEvents.length,0);assert.equal(w.state.events.length,0);assert.equal(w.state.items.length,0);
});
test('full event desk queues rather than loses follow-ups; they receive their full deadline when admitted',()=>{
  const {w}=setup();w.rules.eventLimit=1;w.state.pendingEvents.push({title:'后续',description:'来源。',kind:'repair',asset:'oxygen',availableDay:2,source:'public-test'});w.state.day=2;w.flushFollowUps();assert.equal(w.state.pendingEvents.length,1);
  w.state.events=[];w.state.day=4;w.flushFollowUps();assert.equal(w.state.events[0].deadline,5);assert.equal(w.state.pendingEvents.length,0);
});
test('generated mechanical contracts reject excess budget, missing exit, duplicate routes, dead specialty and arbitrary fields',()=>{
  const w=new World({seed:42});
  for(const mutate of [r=>{r[0].restore={oxygen:16,power:16,supplies:16};},r=>{r[1].card='parts';},r=>{r[1]=structuredClone(r[0]);},r=>{r[0].effects=[{resource:'oxygen',amount:999}];},r=>{r[0].permanent='cold_storage_closed';}]){const r=basicRoutes();mutate(r);assert.throws(()=>validateRoutes(r,w.state));}
  w.state.crew.engineer.alive=false;const r=basicRoutes();r[0].specialty='oxygen';assert.throws(()=>validateRoutes(r,w.state),/living/);
  install(w,'maintenance_link');assert.throws(()=>validateRoutes(basicRoutes(),w.state),/already_installed/);
});
test('world tool accepts generated route structure with public sources, and rejects regeneration and cap bypass',()=>{
  const w=new World({seed:42});w.begin({assignments:[]});const generated=fixtureBuildEvent(w.context('world'));
  const settlement={summary:'改装机会。',source_ids:w.publicRecords().slice(-1).map(e=>e.id),events:[generated]};
  w.validateDecision('world','settle_round',settlement);assert.throws(()=>w.validateDecision('world','settle_round',{...settlement,events:[generated,generated]}),/one_build/);
  assert.throws(()=>w.validateDecision('world','settle_round',{...settlement,events:[{...generated,prototype:'cold_storage'}]}),/choice|regenerable/);
  w.call('world','settle_round',settlement,'world');const event=w.state.events.at(-1);assert.deepEqual(event.routes,generated.routes);assert.equal(event.deadline,4);
  const context=w.context('world');assert.equal(context.buildRules.components,undefined);assert(!JSON.stringify(context).includes('privateObjective'));
  assert.equal(replay(w.export()).hash,w.hash());
});
test('LiveAgent can request and validate model-composed routes without executing them; uses only a local mocked response',async t=>{
  const w=new World({seed:42});w.begin({assignments:[]});const event=fixtureBuildEvent(w.context('world'));
  const reply={summary:'可用改装机会。',source_ids:w.publicRecords().slice(-1).map(e=>e.id),events:[event]};let request;
  t.mock.method(globalThis,'fetch',async(_url,options)=>{request=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'mock-world',function:{name:'settle_round',arguments:JSON.stringify(reply)}}]}}]}),{headers:{'content-type':'application/json'}});});
  const agent=new LiveAgent({base:'http://mock.invalid',model:'test-only',apiKey:'test-only',wireApi:'chat_completions'});
  const before=w.hash(),decision=await agent.decide('world',w);assert.equal(w.hash(),before);assert.equal(request.max_tokens,6000);
  assert(request.tools[0].function.parameters.properties.events.items.properties.routes);
  w.call('world',decision.name,decision.args,decision.key);assert(w.state.events.some(e=>e.kind==='build'));
});
test('model-generated component-free situations execute distinct costs and only the chosen consequence, with replay',async t=>{
  for(const selected of ['drain','scrap']) {
    const w=new World({seed:42});
    const followUp={title:'排水后的绝缘检查',description:'积水排出后，暴露的接头需要复检，也可以拆走停用线路。',asset:'power',duration:2,penalty:5,routes:[
      route({id:'seal',label:'封住接头',suppliesCost:2,repair:1,restore:{oxygen:0,power:6,supplies:0}}),
      route({id:'recover',label:'回收停用线路',suppliesCost:0,restore:{oxygen:0,power:0,supplies:4}})
    ]};
    const scenarioRoutes=[
      route({id:'drain',label:'排水恢复供电',suppliesCost:3,restore:{oxygen:0,power:10,supplies:0},followUp:'generated',followUpEvent:followUp}),
      route({id:'scrap',label:'拆走备用缆线',workers:2,suppliesCost:0,restore:{oxygen:0,power:0,supplies:8}})
    ];
    t.mock.method(globalThis,'fetch',async(_url,options)=>{
      const input=JSON.parse(options.body),ctx=JSON.parse(input.messages[1].content);
      const output=ctx.self?args():{summary:'维修后仍有舱底积水待处理。',source_ids:ctx.public_results.slice(-1).map(e=>e.id),events:[
        {title:'舱底积水浸过备用线路',description:'积水使备用线路无法接通，可排水保留供电能力，或取走未浸水的缆线。',asset:'power',prototype:'build',duration:3,penalty:9,source_ids:ctx.public_results.slice(-1).map(e=>e.id),routes:scenarioRoutes}
      ]};
      return new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'scenario',function:{name:ctx.self?'complete_assignment':'settle_round',arguments:JSON.stringify(output)}}]}}]}),{headers:{'content-type':'application/json'}});
    });
    await runRound(w,new LiveAgent({base:'http://mock.invalid',model:'test-only',apiKey:'test-only'}),{assignments:[]});
    w.nextDay();const event=w.state.events.find(e=>e.title==='舱底积水浸过备用线路');assert(event);
    assert(event.routes.every(r=>r.rewardComponent==='none'));const count=selected==='drain'?1:2;
    const workers=w.state.duty.slice(0,count),before={...w.state.resources};
    w.begin({assignments:workers.map(actor=>task(actor,event.id,null,selected))});for(const actor of workers)commit(w,actor);
    assert.equal(w.state.resources.power,Math.min(w.rules.initial,before.power+(selected==='drain'?10:0)));
    assert.equal(w.state.resources.supplies,Math.min(w.rules.initial,before.supplies+(selected==='drain'?-3:8)));
    assert.equal(w.state.components.length,0);assert.equal(w.state.pendingEvents.length,selected==='drain'?1:0);
    assert(!w.state.events.some(e=>e.id===event.id));assert.equal(replay(w.export()).hash,w.hash());
    finish(w);w.nextDay();const consequence=w.state.events.find(e=>e.title===followUp.title);
    assert.equal(Boolean(consequence),selected==='drain');
    if(consequence){assert.deepEqual(consequence.routes,followUp.routes);assert.equal(consequence.deadline,4);assert.equal(consequence.penalty,5);}
    assert.equal(replay(w.export()).hash,w.hash());
  }
});
test('client supports incomplete drafting, synchronizes group routes and restores route choices',()=>{
  const {w,e}=setup(coldStorageRoutes()),v={id:'build-client',mode:'fixture',status:'idle',error:null,...w.project()};
  let plan=placeCrew(v,[],'engineer',e.id);assert.equal(validateDraft(v,plan),null);assert(routeIssues(v,plan).some(s=>s.includes('人')));
  plan=placeCrew(v,plan,'medic',e.id);const store=new GameStore();store.accept(v);store.edit(plan);store.selectRoute(e.id,'rescue');
  assert(store.plan.every(a=>a.route==='rescue'));assert.deepEqual(routeIssues(v,store.plan),[]);w.validatePlan({assignments:store.plan});
  const draft=structuredClone(store.plan);store.accept({...v,status:'running'});assert.deepEqual(store.plan,draft);assert.equal(store.selectRoute(e.id,'rewire'),false);
  store.accept({...v,error:'rollback'});assert.deepEqual(store.plan,draft);
});
test('fact-cards-v1 saves migrate as verified snapshots, preserve private facts and replay new commands',async()=>{
  const w=new World({seed:42});const old=w.export();old.runtime='fact-cards-v1';
  for(const key of ['components','componentUsage','flags','buildHistory','pendingEvents','buildOfferedDay','buildWork'])delete old.state[key];
  old.state.events=old.state.events.filter(e=>e.kind!=='cold_storage');
  const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');old.hash=hash(old.state);old.runtimeHash=hash({state:old.state,rng:old.rng,rotation:old.rotation,seq:old.seq,plan:old.plan,ledger:old.ledger});
  const migrated=World.restore(old);assert.deepEqual(migrated.state.components,[]);assert.equal(migrated.state.host,old.state.host);assert.equal(replay(old).verified,false);
  await runRound(migrated,new FixtureAgent(),buildPlan(migrated.project(),'维护联动'));assert.equal(replay(migrated.export()).hash,migrated.hash());
});
test('simple event policies complete reproducible voyages with choices and no new inventory or model calls',async()=>{
  const a=await simulateBuilds({runs:2,verifyReplay:true}),b=await simulateBuilds({runs:2});
  assert.deepEqual(a,b);assert.equal(a.modelRequests,0);assert.equal(a.rows.length,15);
  assert(a.rows.every(r=>r.averageChoices>0&&Object.keys(r.componentInstalls).length===0&&r.averageTriggers===0));
  assert(a.rows.filter(r=>r.family==='先调查').every(r=>r.averageInvestigations>0&&r.averageDiscoveryResolutions>0));
});
