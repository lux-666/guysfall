import test from 'node:test';
import assert from 'node:assert/strict';
import { World, replay } from '../src/world.mjs';
import { FixtureAgent, runRound } from '../src/agents.mjs';
import { COMPONENT_TYPES } from '../src/content.mjs';
import { route, fixtureBuildEvent, validateRoutes, recoveredModuleFollowUp } from '../src/builds.mjs';
import { eventGenerationRequest, validateGeneratedEvents } from '../src/event-generation.mjs';
import { taskActions, displayedVerb, placeCrew, GameStore } from '../client/model.ts';

const decision={approach:'work',share:true,delivery:'direct',reveal_ids:[],claims:[],accuse:'none',note:'取证。',memory:'',message:{to:'none',content:''},covert:{kind:'none',asset:'oxygen',amount:0,target:'none'}};
const task=(actor,slot,card=null)=>({actor,slot,card,verb:'inspect',attend:false});
function scene(types=['evidence_protocol','investigation_supply','access_recovery']) {
  const w=new World({seed:42});w.state.host='cook';w.state.duty=['engineer','security','scientist','clerk'];w.state.resources.supplies=30;
  w.state.components=types.map(type=>({type,...COMPONENT_TYPES[type],installedDay:0}));
  // Visitors are intentionally ambiguous; the protocol must preserve the forged candidate.
  w.state.assets.oxygen.history=[{day:1,amount:4,visitors:['cook','medic'],incident:'anomaly-one',erased:false}];
  const e=w.event('反复核对的故障','故障修复前可以调查。','oxygen','repair');w.state.events=[e];return {w,e};
}
const commit=(w,id)=>w.call(id,'complete_assignment',decision,`${w.state.day}:${id}`);

test('investigation grants ordinary handcards once, without a processing task or suspect records',()=>{
  const {w,e}=scene([]);w.state.hand=[];
  w.begin({assignments:[task('engineer',e.id),task('security',e.id)]});commit(w,'engineer');commit(w,'security');
  assert.equal(w.state.resources.supplies,30);assert.equal(w.state.items.length,0);assert.equal(w.state.pendingEvents.length,0);
  assert.deepEqual(w.state.hand.map(c=>c.type),['oxygen']);assert.deepEqual(w.state.evidence,[]);
  assert(!JSON.stringify(w.context('world')).includes('visitors'));assert(!JSON.stringify(w.project()).includes('suspects'));
  w.state.day++;w.state.phase='planning';w.begin({assignments:[task('clerk',e.id)]});commit(w,'clerk');
  assert.equal(w.state.hand.length,1);assert.equal(w.state.resources.supplies,30);
});

test('permission handles the inspected problem immediately and makes room for its reward in a full hand',()=>{
  const {w,e}=scene([]),card=w.state.hand.find(c=>c.type==='access').id;w.state.assets.oxygen.damage=2;
  w.begin({assignments:[task('engineer',e.id,card)]});commit(w,'engineer');
  assert(!w.state.hand.some(c=>c.id===card));assert(w.state.hand.some(c=>c.type==='oxygen'));
  assert.equal(w.state.hand.length,w.rules.handLimit);assert.equal(w.state.assets.oxygen.damage,1);
  assert.equal(w.state.events.length,0);assert.deepEqual(w.state.isolations,{});assert.equal(w.state.pendingEvents.length,0);
});

test('isolation trades maintenance output for protection; attendance protects without an identity clue',()=>{
  const a=scene([]).w,b=scene([]).w;for(const w of [a,b])w.state.resources.oxygen=20;
  b.state.isolations.oxygen={until:2,source:'test'};
  for(const w of [a,b]){w.begin({assignments:[{...task('engineer','pressure:oxygen'),verb:'repair',attend:true}]});commit(w,'engineer');}
  assert.equal(a.state.resources.oxygen,38);assert.equal(b.state.resources.oxygen,29);
  const before=a.state.resources.oxygen;a.hiddenAction('cook',{asset:'oxygen',amount:4,kind:'damage',target:'none'});
  assert.equal(a.state.resources.oxygen,before);assert.deepEqual(a.project().evidence,[]);
});

function processing(types=[]) {
  const {w}=scene(types);w.state.resources.power=20;
  w.grantItem('recovered_module','oxygen','physical-source',[]);
  const e=w.event('总成处理','使用之前留下的总成。','oxygen','build');e.routes=recoveredModuleFollowUp('oxygen').routes;w.state.events=[e];return {w,e};
}
const selected=(actor,e,id)=>({...task(actor,e.id),verb:e.routes.find(r=>r.id===id).verb,route:id});

test('testing and dismantling consume the same object in mutually exclusive ways; apparatus only improves the operation',()=>{
  for(const choice of ['test','dismantle','retain']) {
    const {w,e}=processing(['evidence_protocol','investigation_supply']);
    const people=choice==='dismantle'?['engineer']:['engineer','security'];
    w.begin({assignments:people.map(id=>selected(id,e,choice))});people.forEach(id=>commit(w,id));
    assert.equal(w.state.resources.power,choice==='test'?19:20);
    assert.equal(w.state.resources.supplies,choice==='test'?34:choice==='dismantle'?46:32);
    assert.deepEqual(w.state.items.map(i=>i.type),choice==='test'?['spare_line']:choice==='retain'?['recovered_module']:[]);
    assert.equal(w.state.buildHistory[0].consumedItem,choice==='retain'?null:'item-1');
    assert.deepEqual(w.project().evidence,[]);
  }
  const {w,e}=processing(['evidence_protocol']);w.state.components[0].installedDay=1;
  w.begin({assignments:['engineer','security'].map(id=>selected(id,e,'test'))});commit(w,'engineer');commit(w,'security');assert.equal(w.state.resources.power,16);
});

test('objects cannot be double reserved or used for another system; late shortages spend nothing',()=>{
  const {w,e}=processing();const other=w.event('第二项','抢用同一总成。','oxygen','build');other.routes=e.routes;w.state.events.push(other);
  assert.throws(()=>w.begin({assignments:[selected('engineer',e,'dismantle'),selected('security',other,'dismantle')]}),/item_unavailable_or_reused/);
  other.asset='power';assert.throws(()=>w.begin({assignments:[selected('security',other,'dismantle')]}),/item_unavailable/);
  w.begin({assignments:['engineer','security'].map(id=>selected(id,e,'test'))});commit(w,'engineer');w.state.resources.power=0;
  const before=structuredClone(w.state.resources);commit(w,'security');assert.deepEqual(w.state.resources,before);assert.equal(w.state.items.length,1);assert(w.state.events.includes(e));
});

test('physical operation schema rejects invented inputs, free isolation and uncosted tests before mutation',()=>{
  const {w,e}=processing();validateRoutes(e.routes,w.state,{asset:'oxygen'});
  for(const mutate of [r=>r[0].consumeItem='none',r=>r[0].powerCost=0,r=>r[0].operation='isolate']) {
    const routes=structuredClone(e.routes);mutate(routes);assert.throws(()=>validateRoutes(routes,w.state,{asset:'oxygen'}));
  }
  assert.throws(()=>validateRoutes(e.routes,w.state,{asset:'power'}),/item_not_in_context/);
  w.state.items=[];assert.throws(()=>validateRoutes(e.routes,w.state,{asset:'oxygen'}),/item_not_in_context/);
});

test('new events have two simple choices, standard rewards, and replay across days',async()=>{
  const w=new World({seed:42}),agent=new FixtureAgent(),cold=w.state.events.find(e=>e.kind==='cold_storage');
  await runRound(w,agent,{assignments:[selected(w.state.duty[0],cold,'take')]});
  assert.equal(w.state.items.length,0);assert.equal(w.state.components.length,0);assert.equal(w.state.pendingEvents.length,0);
  assert.equal(replay(w.export()).hash,w.hash());w.nextDay();
  await runRound(w,agent,{assignments:[]});assert.equal(replay(w.export()).hash,w.hash());
  for(const e of w.state.events.filter(e=>['build','cold_storage'].includes(e.kind))) {
    assert.equal(e.routes.length,2);assert(e.routes.every(r=>r.workers<=2&&r.specialty==='none'&&r.rewardComponent==='none'&&r.rewardItem==='none'&&r.operation==='none'));
  }
});

test('new generated choices must differ in commitment and cannot reintroduce machinery or extra routes',()=>{
  const w=new World({seed:42});w.begin({assignments:[]});w.prepareSettlement();const request=eventGenerationRequest(w);
  const event=fixtureBuildEvent(request.context),args={summary:'公开结算。',source_ids:event.source_ids,events:[event]};
  validateGeneratedEvents(args,request);validateRoutes(event.routes,w.state);
  for(const mutate of [e=>e.routes.push({...e.routes[0],id:'third'}),e=>e.routes[0].rewardComponent='maintenance_link',e=>e.routes[0].rewardItem='spare_line',e=>e.routes[0].workers=3,e=>e.routes[0].specialty='oxygen',e=>e.routes[0].operation='test']) {
    const invalid=structuredClone(args);mutate(invalid.events[0]);assert.throws(()=>validateGeneratedEvents(invalid,request));
  }
  const same=structuredClone(args);same.events[0].routes[1]={...same.events[0].routes[0],id:'different-name',label:'换个标题',restore:{oxygen:3,power:0,supplies:0}};
  assert.throws(()=>validateGeneratedEvents(same,request),/route_tradeoff/);
});

test('UI collapses equivalent actions while preserving old drafts and replay command compatibility',async()=>{
  const w=new World({seed:42}),view={id:'legacy-draft',mode:'fixture',status:'idle',...w.project()},actor=w.state.duty[0];
  const pressure=view.slots.find(s=>s.kind==='pressure'),talk=view.slots.find(s=>s.kind==='talk'),event=view.slots.find(s=>s.eventKind==='repair');
  assert.deepEqual(taskActions(pressure),[['repair','维护'],['inspect','调查']]);assert.deepEqual(taskActions(event),[['repair','处置'],['inspect','调查']]);assert.deepEqual(taskActions(talk),[['talk','谈话']]);
  assert.equal(placeCrew(view,[],actor,pressure.id)[0].verb,'repair');
  const store=new GameStore();store.accept(view);const plan=[{...task(actor,pressure.id),verb:'escort'}];assert(store.edit(plan));assert.equal(displayedVerb(pressure,store.plan[0].verb),'repair');
  await runRound(w,new FixtureAgent(),{assignments:plan});assert.equal(replay(w.export()).hash,w.hash());
  const old=w.export();old.runtime='event-builds-v2';const restored=World.restore(old);
  assert.equal(replay(old).verified,false);assert.deepEqual(restored.state.resources,w.state.resources);
  restored.nextDay();await runRound(restored,new FixtureAgent(),{assignments:[]});assert.equal(restored.export().runtime,'event-opportunities-v9');assert.equal(replay(restored.export()).hash,restored.hash());
});

test('v4 imports cash out equipment, retire complex tasks and character meters, then replay new actions',async()=>{
  const {w,e}=processing(['evidence_protocol']);w.state.crew.engineer.fatigue=4;w.state.crew.engineer.morale=-2;
  const old=w.export();old.runtime='event-objects-v4';const {createHash}=await import('node:crypto');
  const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');old.hash=hash(old.state);old.runtimeHash=hash({state:old.state,rng:old.rng,rotation:old.rotation,seq:old.seq,plan:old.plan,ledger:old.ledger});
  const migrated=World.restore(old);
  assert.equal(migrated.state.resources.supplies,34);assert.deepEqual(migrated.state.items,[]);assert.deepEqual(migrated.state.components,[]);
  assert(Object.values(migrated.state.crew).every(c=>!('fatigue' in c)&&!('morale' in c)));
  const event=migrated.state.events.find(x=>x.id===e.id);assert.equal(event.routes.length,2);assert(event.routes.every(r=>r.consumeItem==='none'&&r.rewardComponent==='none'));
  assert(migrated.ledger.some(e=>e.kind==='rules_update'));
  assert(!migrated.publicRecords().some(e=>e.kind==='rules_update'));
  await runRound(migrated,new FixtureAgent(),{assignments:[selected('engineer',event,'handle')]});
  assert.equal(replay(migrated.export()).hash,migrated.hash());
});

test('test bench discounts have daily limits; preflight and execution agree on aggregate power',()=>{
  const {w}=scene(['evidence_protocol']);w.state.resources.power=5;
  w.state.events=['oxygen','power','supplies'].map(asset=>{w.grantItem('recovered_module',asset,'test',[]);const e=w.event('测试总成',asset,asset,'build');e.routes=recoveredModuleFollowUp(asset).routes;e.routes[0].workers=1;return e;});
  const people=['engineer','security','clerk'],plan={assignments:w.state.events.map((e,i)=>selected(people[i],e,'test'))};
  assert.throws(()=>w.begin(plan),/route_power_insufficient/);w.state.resources.power=6;w.begin(plan);people.forEach(id=>commit(w,id));
  assert.equal(w.state.resources.power,0);assert.equal(w.state.componentUsage['1:evidence_protocol'],2);assert.equal(w.state.items.length,3);
});
