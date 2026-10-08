import test from 'node:test';
import assert from 'node:assert/strict';
import { World, replay } from '../src/world.mjs';
import { LiveAgent } from '../src/agents.mjs';
import { route, validateRoutes } from '../src/builds.mjs';
import { eventGenerationRequest, validateGeneratedEvents } from '../src/event-generation.mjs';
import { GameStore, routeBlock, planReview, timelineEntry } from '../client/model.ts';

const finding='接头只是松了；用备件更换，或派两个人固定，都能恢复供电。';
const routes=()=>[
  route({id:'rush',label:'停通风，先接上电',suppliesCost:0,loss:{oxygen:6,power:0,supplies:0},restore:{oxygen:0,power:8,supplies:0}}),
  route({id:'inspect',label:'先检查接头',verb:'inspect',suppliesCost:0,discovery:{finding,routes:[
    route({id:'replace',label:'换备件恢复供电',card:'parts',suppliesCost:0,repair:1,restore:{oxygen:0,power:12,supplies:0}}),
    route({id:'hold',label:'两人固定接头',workers:2,suppliesCost:0,repair:1,restore:{oxygen:0,power:10,supplies:0}})
  ]}})
];
const crewArgs={approach:'work',share:false,delivery:'direct',reveal_ids:[],claims:[],accuse:'none',note:'执行派遣。',memory:'',message:{to:'none',content:''},covert:{kind:'none',asset:'power',amount:0,target:'none'}};
const task=(w,e,id,card=null)=>({actor:w.state.duty[0],slot:e.id,route:id,verb:e.routes.find(r=>r.id===id).verb,card,attend:false});
function proposal(w,choices=routes()) {
  const refs=w.context('world').public_results.slice(-2).map(e=>e.id);
  return {summary:'公开工作已经结算。',source_ids:refs,events:[{title:'备用电源接不上',description:'通风与接电都需要人手；可先接电，也可以检查接头。',asset:'power',prototype:'build',duration:3,penalty:9,source_ids:refs,routes:choices}]};
}
function scene() {
  const w=new World({seed:42});w.begin({assignments:[]});w.prepareSettlement();
  const args=proposal(w);validateGeneratedEvents(args,eventGenerationRequest(w));
  const result=w.call('world','settle_round',args,'offer');w.finishDay();w.nextDay();
  return {w,e:w.state.events.find(e=>e.id===result.accepted[0].id)};
}
function finish(w) {
  w.prepareSettlement();const refs=w.publicRecords().slice(-1).map(e=>e.id);
  w.call('world','settle_round',{summary:'本日结束。',source_ids:refs,events:[]},'finish');w.finishDay();
}

test('live World can compose a costly shortcut and a private investigation without executing either',async t=>{
  const w=new World({seed:42});w.begin({assignments:[]});w.prepareSettlement();const before=w.hash();
  let count=0;t.mock.method(globalThis,'fetch',async(_url,opts)=>{
    count++;const body=JSON.parse(opts.body),schema=body.tools[0].function.parameters.properties.events.items.properties.routes;
    assert(schema.items.properties.loss);assert(schema.items.properties.discovery);
    return new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'world-play',type:'function',function:{name:'settle_round',arguments:JSON.stringify(proposal(w))}}]}}]}),{headers:{'content-type':'application/json'}});
  });
  const decision=await new LiveAgent({base:'https://fixture.invalid/v1',model:'test-only',apiKey:'test-only',wireApi:'chat_completions'}).decide('world',w);
  assert.equal(count,1);assert.equal(w.hash(),before);w.call('world',decision.name,decision.args,decision.key);
  assert(!JSON.stringify(w.project()).includes(finding));assert(!JSON.stringify(w.context('world')).includes(finding));
  assert.equal(replay(w.export()).hash,w.hash());
});

test('investigation preserves the event, reveals new choices once, then spends a handcard to resolve it with exact replay',()=>{
  const {w,e}=scene(),id=e.id,oldDeadline=e.deadline,view={id:'play',status:'idle',...w.project()};
  const store=new GameStore();store.accept(view);store.place(w.state.duty[0],id);assert(store.selectRoute(id,'inspect'));
  assert(planReview(view,store.plan).some(entry=>entry[0]==='先调查的事件'));
  const first=task(w,e,'inspect');w.begin({assignments:[first]});w.call(first.actor,'complete_assignment',crewArgs,'investigate');
  assert.equal(e.id,id);assert(w.state.events.includes(e));assert(e.description.includes(finding));assert(e.deadline>=Math.max(oldDeadline,w.state.day+1));
  assert.deepEqual(e.routes.map(r=>r.id),['replace','hold']);assert.equal(w.ledger.filter(e=>e.kind==='investigation').length,1);
  assert(JSON.stringify(w.project()).includes(finding));assert(!JSON.stringify(w.project()).includes('discovery'));
  assert.equal(w.state.buildHistory.at(-1).investigated,true);
  finish(w);w.nextDay();
  const restored=World.restore(w.export()),event=restored.state.events.find(e=>e.id===id),card=restored.state.hand.find(c=>c.type==='parts').id;
  assert.throws(()=>restored.validatePlan({assignments:[{...task(restored,event,'replace',card),route:'inspect',verb:'inspect'}]}),/invalid_(intent|event_route)/);
  const second=task(restored,event,'replace',card);restored.begin({assignments:[second]});
  const result=restored.call(second.actor,'complete_assignment',crewArgs,'repair');
  assert.deepEqual(restored.call(second.actor,'complete_assignment',crewArgs,'repair'),result);
  assert(!restored.state.events.some(e=>e.id===id));assert(!restored.state.hand.some(c=>c.id===card));
  assert.equal(restored.ledger.filter(e=>e.kind==='investigation').length,1);
  assert(restored.context('world').public_results.some(e=>e.kind==='investigation'));
  assert.equal(replay(restored.export()).hash,restored.hash());
});

test('same opening branches into a real resource loss or an unresolved discovery and carries each choice forward',()=>{
  const {w,e}=scene(),other=World.restore(w.export()),otherEvent=other.state.events.find(x=>x.id===e.id),oxygen=w.state.resources.oxygen;
  const a=task(w,e,'rush');w.begin({assignments:[a]});w.call(a.actor,'complete_assignment',crewArgs,'rush');
  assert(w.state.results.at(-1).outcome.includes('电力 +8'));assert.equal(w.state.buildHistory.at(-1).restore.power,8);
  const b=task(other,otherEvent,'inspect');other.begin({assignments:[b]});other.call(b.actor,'complete_assignment',crewArgs,'inspect');
  assert.equal(w.state.resources.oxygen,oxygen-6);assert.equal(other.state.resources.oxygen,oxygen);
  assert(!w.state.events.some(x=>x.id===e.id));assert(other.state.events.some(x=>x.id===e.id));
  for(const game of [w,other]){finish(game);game.nextDay();assert.equal(replay(game.export()).hash,game.hash());}
  assert.equal(w.context('world').buildHistory.at(-1).route,'停通风，先接上电');
  assert.equal(other.context('world').buildHistory.at(-1).finding,finding);
  assert(w.context('world').public_results.some(x=>x.kind==='build_choice'&&x.data.loss.oxygen===6));
  assert(other.context('world').public_results.some(x=>x.kind==='investigation'));
});

test('accepting losses without a reward is valid; losses cannot buy excess rewards or disguise identical choices',()=>{
  const w=new World({seed:42});w.begin({assignments:[]});w.prepareSettlement();
  const choices=[route({id:'abandon',label:'放弃这批供电',suppliesCost:0,loss:{oxygen:0,power:5,supplies:0}}),route({id:'repair',label:'花物资修好',suppliesCost:3,repair:1})];
  validateRoutes(choices,w.state);validateGeneratedEvents(proposal(w,choices),eventGenerationRequest(w));
  const excess=structuredClone(choices);excess[0].restore={oxygen:16,power:16,supplies:16};assert.throws(()=>validateRoutes(excess,w.state),/route_reward_budget/);
  const empty=structuredClone(choices);delete empty[0].loss;assert.throws(()=>validateRoutes(empty,w.state),/route_reward_budget/);
  const same=structuredClone(choices);same[1]={...same[0],id:'other',label:'换个名字'};assert.throws(()=>validateGeneratedEvents(proposal(w,same),eventGenerationRequest(w)),/tradeoff/);
});

test('unlocked choices stay bounded; final-day investigations and late shortages cannot spend materials',()=>{
  const {w,e}=scene();
  for(const mutate of [r=>r[1].verb='repair',r=>r[1].followUp='repair',r=>r[1].discovery.routes[0].restore={oxygen:16,power:16,supplies:16},r=>r[1].discovery.routes[0].id='rush',r=>r[1].discovery.routes[0].discovery={finding,routes:[]},r=>r[1].discovery.routes[0].loss={oxygen:-1,power:0,supplies:0}]) {
    const invalid=routes();mutate(invalid);assert.throws(()=>validateRoutes(invalid,w.state));
  }
  w.state.day=w.rules.days;const view={...w.project(),id:'last'};
  assert.match(routeBlock(view,[],e.id,view.slots.find(s=>s.id===e.id).routes[1]),/最后一天/);
  const before=w.hash();assert.throws(()=>w.begin({assignments:[task(w,e,'inspect')]}),/investigation_too_late/);assert.equal(w.hash(),before);
  w.state.day=2;e.routes[1].suppliesCost=3;e.routes[1].card='parts';const card=w.state.hand.find(c=>c.type==='parts').id;
  w.begin({assignments:[task(w,e,'inspect',card)]});w.state.resources.supplies=0;
  w.call(w.state.duty[0],'complete_assignment',crewArgs,'shortage');
  assert(w.state.hand.some(c=>c.id===card));assert.equal(e.routes[1].id,'inspect');assert(!e.inspected);
});

test('v5 snapshots preserve a playable baseline and new choices replay in v7',()=>{
  const {w}=scene(),old=w.export();old.runtime='event-simple-v5';const restored=World.restore(old);
  assert.equal(replay(old).verified,false);assert.equal(restored.export().runtime,'event-opportunities-v9');
  const e=restored.state.events.find(e=>e.kind==='build'),a=task(restored,e,'rush');restored.begin({assignments:[a]});restored.call(a.actor,'complete_assignment',crewArgs,'new');
  assert.equal(replay(restored.export()).hash,restored.hash());
});

test('hidden damage and daily upkeep leave public pressure for World without spawning fixed event cards',()=>{
  const w=new World({seed:42}),before=w.state.events.map(e=>e.id);w.begin({assignments:[]});
  w.call(w.state.host,'complete_assignment',{...crewArgs,covert:{kind:'damage',asset:'power',amount:4,target:'none'}},'host');
  w.resolveHidden();w.prepareSettlement();
  assert.deepEqual(w.state.events.map(e=>e.id),before);assert(w.state.assets.power.damage>0);
  assert(w.context('world').public_results.some(e=>e.kind==='anomaly'));assert(!JSON.stringify(w.context('world')).includes('visitors'));
  const args=proposal(w);validateGeneratedEvents(args,eventGenerationRequest(w));
  assert.equal(w.call('world','settle_round',args,'world').accepted.length,1);assert.equal(replay(w.export()).hash,w.hash());
});

test('group investigation reveals once and late offers must be handled by the voyage end',()=>{
  const {w,e}=scene();e.routes[1].workers=2;
  const assignments=w.state.duty.slice(0,2).map(actor=>({...task(w,e,'inspect'),actor}));w.begin({assignments});
  w.call(assignments[0].actor,'complete_assignment',crewArgs,'one');assert.equal(e.routes[1].id,'inspect');
  w.call(assignments[1].actor,'complete_assignment',crewArgs,'two');assert.equal(e.routes[0].id,'replace');assert.equal(w.ledger.filter(e=>e.kind==='investigation').length,1);
  const late=new World({seed:42});late.state.day=5;late.begin({assignments:[]});late.prepareSettlement();
  late.call('world','settle_round',proposal(late),'late');assert.equal(late.state.events.at(-1).deadline,7);
});

test('authored windows count playable days; missed opportunities close without a resource penalty',()=>{
  for(const opening of [true,false]) {
    const w=new World({seed:42,opening});if(!opening){w.begin({assignments:[]});w.prepareSettlement();}
    const args=proposal(w);Object.assign(args.events[0],{title:'补给艇交接窗口',duration:1,penalty:0});
    const normalized=validateGeneratedEvents(args,eventGenerationRequest(w));w.call('world','settle_round',normalized,'window');
    if(opening)w.finishOpening();else{w.finishDay();w.nextDay();}
    const e=w.state.events.find(e=>e.title==='补给艇交接窗口');assert.equal(e.deadline,w.state.day);assert.equal(e.duration,1);
    const view={id:'window',...w.project()},slot=view.slots.find(s=>s.id===e.id);
    assert.match(slot.description,/错过不扣资源/);assert(!slot.description.includes('−0'));
    assert(planReview(view,[]).flat().some(s=>s.includes('错过不扣资源')));
    const power=w.state.resources.power;w.begin({assignments:[]});w.prepareSettlement();
    assert.equal(w.state.resources.power,power-w.rules.dailyLoss-Math.floor((w.state.day-1)/2));
    assert(!w.state.events.some(x=>x.id===e.id));assert.equal(w.state.pendingEvents.length,0);
    assert(!w.ledger.some(e=>e.kind==='deadline'&&e.summary.includes('补给艇交接窗口')));
    const missed=w.project().timeline.find(e=>e.kind==='opportunity_missed');assert(missed);
    assert.equal(timelineEntry(missed,w.project()).title,'机会已错过');
    assert.equal(replay(w.export()).hash,w.hash());
  }
});

test('crisis expiration uses the authored penalty and invalid or omitted live window fields are rejected',()=>{
  const w=new World({seed:42,opening:true}),args=proposal(w);Object.assign(args.events[0],{duration:1,penalty:6});
  const request=eventGenerationRequest(w);assert(request.tool.function.parameters.properties.events.items.required.includes('penalty'));
  for(const mutate of [e=>delete e.duration,e=>delete e.penalty,e=>e.duration=0,e=>e.duration=4,e=>e.penalty=-1,e=>e.penalty=13]) {
    const bad=structuredClone(args);mutate(bad.events[0]);assert.throws(()=>validateGeneratedEvents(bad,request));
  }
  w.call('world','settle_round',args,'crisis');w.finishOpening();const before=w.state.resources.power;
  w.begin({assignments:[]});w.prepareSettlement();assert.equal(w.state.resources.power,before-6-w.rules.dailyLoss);
  assert.match(w.ledger.find(e=>e.kind==='deadline').summary,/PWR −6/);assert.equal(replay(w.export()).hash,w.hash());
});

test('a generated dispatch reward replaces spent material and really enables a fifth worker next day',()=>{
  const w=new World({seed:42,opening:true}),args=proposal(w,[
    route({id:'reserve',label:'用备件换调遣令',card:'parts',suppliesCost:0,rewardCard:'dispatch'}),
    route({id:'unload',label:'两人搬回补给',workers:2,suppliesCost:0,restore:{oxygen:0,power:0,supplies:12}})
  ]);Object.assign(args.events[0],{title:'补给艇交接窗口',duration:2,penalty:0});
  w.call('world','settle_round',validateGeneratedEvents(args,eventGenerationRequest(w)),'window');w.finishOpening();
  const e=w.state.events[0],oldCards=new Set(w.state.hand.map(c=>c.id)),part=w.state.hand.find(c=>c.type==='parts');
  w.begin({assignments:[task(w,e,'reserve',part.id)]});w.call(w.state.duty[0],'complete_assignment',crewArgs,'reserve');
  assert(!w.state.hand.some(c=>c.id===part.id));assert.equal(w.state.hand.length,w.rules.handLimit);
  const dispatch=w.state.hand.find(c=>c.type==='dispatch'&&!oldCards.has(c.id));assert(dispatch);
  w.prepareSettlement();w.call('world','settle_round',{summary:'补给交接完成。',source_ids:w.publicRecords().slice(-1).map(e=>e.id),events:[]},'finish');w.finishDay();w.nextDay();
  const off=w.project().crew.find(c=>c.alive&&!c.onDuty).id,duty=w.state.duty;
  const plan={assignments:[
    {actor:off,slot:'pressure:power',verb:'repair',card:dispatch.id,attend:false},
    ...duty.map((actor,i)=>({actor,slot:['pressure:oxygen','pressure:supplies','talk','talk'][i],verb:i<2?'repair':'talk',card:null,attend:false}))
  ]};
  assert.throws(()=>w.validatePlan({assignments:plan.assignments.map(a=>a.actor===off?{...a,card:null}:a)}),/off_duty_needs_dispatch/);
  w.begin(plan);for(const a of plan.assignments)w.call(a.actor,'complete_assignment',crewArgs,`worker-${a.actor}`);
  assert.equal(w.state.results.length,5);assert(!w.state.hand.some(c=>c.id===dispatch.id));
  assert(w.state.results.find(r=>r.actor===off).delta.power>0);assert.equal(replay(w.export()).hash,w.hash());
});

test('v8 saves import intact as a validated baseline and continue with replayable new commands',()=>{
  const old=new World({seed:42}).export();old.runtime='voyage-log-v8';const restored=World.restore(old);
  assert.deepEqual(restored.state,old.state);assert.equal(replay(old).verified,false);
  restored.begin({assignments:[]});restored.prepareSettlement();
  assert.equal(restored.export().runtime,'event-opportunities-v9');assert.equal(replay(restored.export()).hash,restored.hash());
  const damaged=structuredClone(old);damaged.state.resources.power--;assert.throws(()=>World.restore(damaged),/replay_hash_mismatch/);
});
