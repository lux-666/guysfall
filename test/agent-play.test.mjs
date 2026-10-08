import test from 'node:test';
import assert from 'node:assert/strict';
import { World,replay } from '../src/world.mjs';
import { LiveAgent,initializeVoyage,FixtureAgent,runRound } from '../src/agents.mjs';
import { route } from '../src/builds.mjs';
import { eventGenerationRequest,validateGeneratedEvents } from '../src/event-generation.mjs';
import { infer } from '../src/inference.mjs';
import { RULES } from '../src/content.mjs';

const decision=(covert={kind:'none',asset:'power',amount:0,target:'none'})=>({approach:'work',share:true,delivery:'direct',reveal_ids:[],claims:[],accuse:'none',note:'执行派遣。',memory:'',message:{to:'none',content:''},covert});
const task=(actor,asset,verb='inspect',attend=false)=>({actor,slot:`pressure:${asset}`,verb,card:null,attend});
const offer=(w,title='供电接头松动')=>{
  const source_ids=w.publicRecords().slice(-1).map(e=>e.id);
  return {summary:'按当前船况安排。',source_ids,events:[{title,description:'可以放弃这段供电，或投入物资修好。',asset:'power',prototype:'build',duration:3,penalty:9,source_ids,routes:[
    route({id:'abandon',label:'放弃这段供电',suppliesCost:0,loss:{oxygen:0,power:2,supplies:0}}),
    route({id:'repair',label:'修好接头',suppliesCost:2,repair:1,restore:{oxygen:0,power:8,supplies:0}})
  ]}]};
};
const finish=w=>{w.prepareSettlement();w.call('world','settle_round',{summary:'本日结束。',source_ids:w.publicRecords().slice(-1).map(e=>e.id),events:[]},'finish');w.finishDay();};
const config={base:'https://mock.invalid',model:'test-only',apiKey:'test-only',wireApi:'chat_completions'};

test('live opening has one authored event, no prefab or daily charge, and replays through reload',async t=>{
  const w=new World({seed:42,opening:true}),before={...w.state.resources};let requests=0;
  assert.equal(w.state.events.length,0);assert.equal(w.state.eventSeq,0);
  t.mock.method(globalThis,'fetch',async(_url,opts)=>{
    requests++;const ctx=JSON.parse(JSON.parse(opts.body).messages[1].content);
    assert(ctx.opening);assert.equal(ctx.generationTask.mode,'opening_event');assert(!Object.hasOwn(ctx,'host'));
    const schema=JSON.parse(opts.body).tools[0].function.parameters.properties.events.items.properties.routes.items;
    assert(!Object.hasOwn(schema.properties,'specialty'));assert(!Object.hasOwn(schema.properties,'rewardComponent'));
    const args=offer(w);for(const r of args.events[0].routes)for(const key of ['specialty','rewardComponent','consumeItem','rewardItem','operation','permanent','powerCost'])delete r[key];
    return new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'opening',function:{name:'settle_round',arguments:JSON.stringify(args)}}]}}]}));
  });
  const agent=new LiveAgent(config);await initializeVoyage(w,agent);await initializeVoyage(w,agent);
  assert.equal(requests,1);assert.equal(w.state.phase,'planning');assert.equal(w.state.lastResolved,0);
  assert.deepEqual(w.state.resources,before);assert.equal(w.state.events.length,1);assert.equal(w.state.events[0].kind,'build');
  assert(w.state.events[0].routes.every(r=>r.specialty==='none'&&r.rewardComponent==='none'&&r.powerCost===0));
  assert(!w.ledger.some(e=>['orders','upkeep','covert'].includes(e.kind)));
  assert.equal(replay(w.export()).hash,w.hash());assert.equal(World.restore(w.export()).state.phase,'planning');
});

test('failed real opening stays empty and never falls back to prefab content',async t=>{
  const w=new World({seed:42,opening:true}),before=w.hash();
  t.mock.method(globalThis,'fetch',async()=>new Response('',{status:401}));
  await assert.rejects(initializeVoyage(w,new LiveAgent(config)),/HTTP 401/);
  assert.equal(w.hash(),before);assert.equal(w.state.phase,'opening');assert.equal(w.state.events.length,0);
});

test('fixture playback of an authored opening does not offer a second event on its first day',async()=>{
  const w=new World({seed:42,opening:true});w.call('world','settle_round',offer(w),'opening');w.finishOpening();
  const e=w.state.events[0];await runRound(w,new FixtureAgent(),{assignments:[{actor:w.state.duty[0],slot:e.id,route:'repair',verb:'repair',card:null,attend:false}]});
  assert.equal(w.state.events.length,0);assert.equal(w.state.phase,'review');assert.equal(replay(w.export()).hash,w.hash());
});

test('compact investigation leaves keep real costs, hide the finding, and cannot restore retired mechanics',()=>{
  const w=new World({seed:42,opening:true}),args=offer(w);
  args.events[0].routes[0]=route({id:'inspect',label:'先查接头',verb:'inspect',suppliesCost:0,discovery:{finding:'接头松脱，需要固定。',routes:offer(w).events[0].routes.map(r=>({...r,id:`found_${r.id}`}))}});
  const strip=rs=>{for(const r of rs){for(const key of ['specialty','rewardComponent','consumeItem','rewardItem','operation','permanent','powerCost'])delete r[key];if(r.discovery)strip(r.discovery.routes);}};strip(args.events[0].routes);
  const request=eventGenerationRequest(w),normalized=validateGeneratedEvents(args,request);w.validateDecision('world','settle_round',normalized);
  assert.equal(normalized.events[0].routes[0].discovery.routes[1].suppliesCost,2);
  w.call('world','settle_round',normalized,'opening');w.finishOpening();assert(!JSON.stringify(w.project()).includes('接头松脱'));
  const bad=structuredClone(args);bad.events[0].routes[0].discovery.routes[1].rewardComponent='maintenance_link';assert.throws(()=>validateGeneratedEvents(bad,request),/retired mechanic/);
  for(const events of [null,[null],[{title:'缺少来源'}]])assert.throws(()=>validateGeneratedEvents({events},request),/required/);
});

test('closed choices cannot reopen by title or by renaming a descendant source; independent new pressure remains valid',()=>{
  const w=new World({seed:42,opening:true});w.call('world','settle_round',offer(w),'opening');w.finishOpening();
  const e=w.state.events[0],actor=w.state.duty[0];
  w.begin({assignments:[{actor,slot:e.id,verb:'repair',route:'repair',card:null,attend:false}]});w.call(actor,'complete_assignment',decision(),'repair');finish(w);w.nextDay();
  const choice=w.ledger.find(e=>e.kind==='build_choice'),assignment=w.ledger.find(e=>e.kind==='assignment');
  w.record('summary','world','安排已办完。',{sources:[choice.id]});
  w.begin({assignments:[]});w.prepareSettlement();const request=eventGenerationRequest(w),args=offer(w,'接头修好后的供电安排');
  assert(request.context.resolvedEvents.some(e=>e.title==='供电接头松动'));
  assert(request.context.closedSourceIds.includes(choice.id));
  assert(request.context.closedSourceIds.includes(w.ledger.find(e=>e.summary==='安排已办完。').id));
  args.events[0].source_ids=[choice.id];assert.throws(()=>validateGeneratedEvents(args,request),/event_already_closed/);
  args.events[0].source_ids=[assignment.id];assert.throws(()=>validateGeneratedEvents(args,request),/event_already_closed/);
  args.events[0].source_ids=w.publicRecords().filter(e=>e.kind==='upkeep').slice(-1).map(e=>e.id);validateGeneratedEvents(args,request);
  args.events[0].title='供电接头松动';assert.throws(()=>validateGeneratedEvents(args,request),/duplicate_event/);
});

test('one explicit queued consequence survives closure and its leaf ends without another task',()=>{
  const w=new World({seed:42,opening:true}),args=offer(w),next={title:'搬离临时线缆',description:'临时线缆需要收好。',asset:'power',duration:2,penalty:4,routes:offer(w).events[0].routes};
  Object.assign(args.events[0].routes[1],{followUp:'generated',followUpEvent:next});
  validateGeneratedEvents(args,eventGenerationRequest(w));w.call('world','settle_round',args,'opening');w.finishOpening();
  const execute=e=>{const actor=w.state.duty[0];w.begin({assignments:[{actor,slot:e.id,verb:'repair',route:'repair',card:null,attend:false}]});w.call(actor,'complete_assignment',decision(),`repair-${w.state.day}`);};
  const first=w.state.events[0];execute(first);assert.equal(w.state.pendingEvents.length,1);finish(w);w.nextDay();
  const follow=w.state.events[0];assert.equal(follow.thread,first.id);execute(follow);assert.equal(w.state.pendingEvents.length,0);assert.equal(w.state.events.length,0);
  assert.equal(replay(w.export()).hash,w.hash());
});

test('dispatch defines host access; supervision blocks that system and produces no successful host trace',()=>{
  const w=new World({seed:42}),host=w.state.host;
  const beforePlan=w.hash();assert.throws(()=>w.begin({assignments:[task(host,'oxygen','repair',true),task(w.state.duty[1],'power','repair',true)]}),/energy_exceeded/);assert.equal(w.hash(),beforePlan);
  w.begin({assignments:[task(host,'oxygen','repair',true)]});
  const ctx=w.context(host).privateObjective;assert.deepEqual(ctx.accessibleAssets,['oxygen']);assert.deepEqual(ctx.protectedAssets,['oxygen']);
  const before=w.hash();assert.throws(()=>w.call(host,'complete_assignment',decision({kind:'damage',asset:'power',amount:4,target:'none'}),'inaccessible'),/covert_asset_inaccessible/);assert.equal(w.hash(),before);
  w.call(host,'complete_assignment',decision({kind:'damage',asset:'oxygen',amount:4,target:'none'}),'blocked');w.resolveHidden();
  assert(w.ledger.some(e=>e.kind==='isolation_block'));assert(!w.ledger.some(e=>e.kind==='covert'));assert(!w.state.assets.oxygen.history.some(t=>t.actor===host));
  assert.equal(replay(w.export()).hash,w.hash());
});

test('next-day investigation exposes only actual access opportunities, costs a maintenance worker, and reveals each trace once',()=>{
  const w=new World({seed:42}),host=w.state.host;w.begin({assignments:[]});
  w.call(host,'complete_assignment',decision({kind:'damage',asset:'power',amount:4,target:'none'}),'host');w.resolveHidden();
  const trace=w.state.assets.power.history.find(t=>t.actor===host);assert(trace);
  assert.deepEqual(w.project().evidence,[]);assert(!JSON.stringify(w.context('world')).includes('accessibleAssets'));finish(w);w.nextDay();
  const actor=w.state.duty[0],before={...w.state.resources};w.begin({assignments:[task(actor,'power')]});w.call(actor,'complete_assignment',decision(),'inspect');
  assert.deepEqual(w.state.resources,before);const fact=w.project().evidence.find(f=>f.incident===trace.incident);
  assert.equal(fact.actor,null);assert.deepEqual(fact.present,trace.access);assert(fact.present.includes(host));assert.equal(fact.day,1);assert.equal(fact.revealedDay,2);assert.equal(fact.method,'非标准拆卸');
  assert(!Object.hasOwn(fact,'kindOfCovert'));assert(!Object.hasOwn(w.project().state,'host'));assert.deepEqual(w.context('world').facts,w.project().evidence);
  finish(w);w.nextDay();const count=w.project().evidence.length,reader=w.state.duty[0];w.begin({assignments:[task(reader,'power')]});w.call(reader,'complete_assignment',decision(),'repeat');assert.equal(w.project().evidence.length,count);
  assert.equal(replay(w.export()).hash,w.hash());
});

test('ordinary conversation confirms only the speaker’s real past withdrawals',async()=>{
  const w=new World({seed:42,rules:{...RULES,noiseChance:1}});await runRound(w,new FixtureAgent(),{assignments:[]});
  const actor=Object.values(w.state.crew).find(c=>c.id!==w.state.host&&c.memory.some(m=>m.kind==='withdraw')).id;
  const memories=w.state.crew[actor].memory.filter(m=>m.kind==='withdraw');w.nextDay();
  w.begin({assignments:[{actor,slot:'talk',verb:'talk',card:null,attend:false}]});w.call(actor,'complete_assignment',decision(),'talk');
  const confirmations=w.project().evidence.filter(f=>f.kind==='withdraw');assert.equal(confirmations.length,memories.length);
  for(const fact of confirmations){assert.equal(fact.actor,actor);assert(memories.some(m=>m.incident===fact.incident&&m.amount===fact.amount));}
  assert.equal(replay(w.export()).hash,w.hash());
});

test('forged low-credibility registrations cannot exclude outsiders or drive intersection conviction',()=>{
  const w=new World({seed:42}),host=w.state.host,target='medic';w.begin({assignments:[]});
  w.call(host,'complete_assignment',decision({kind:'frame',asset:'power',amount:4,target}),'frame');w.resolveHidden();finish(w);w.nextDay();
  const actor=w.state.duty[0];w.begin({assignments:[task(actor,'power')]});w.call(actor,'complete_assignment',decision(),'inspect');
  const forged=w.project().evidence.find(f=>f.method==='不一致的出入记录');assert.equal(forged.credibility,1);assert(forged.present.includes(target));
  const view=w.project();view.evidence=[forged,{...forged,id:'other',incident:'other',day:2,present:[target]}];
  const result=infer(view,{mode:'intersection'});assert.equal(result.target,null);assert.equal(result.intersection.length,8);
});
