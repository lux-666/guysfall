import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES } from '../src/content.mjs';
import { World,replay,CREW } from '../src/world.mjs';
import { FixtureAgent,runRound,suggestedPlan } from '../src/agents.mjs';
const task=(actor,slot='pressure:oxygen',card=null,attend=false,verb='assign')=>({actor,slot,card,attend,verb});
const decision=(over={})=>({delivery:'direct',reveal_ids:[],claims:[],accuse:'none',approach:'work',share:false,note:'按职责完成任务。',memory:'保留观察。',message:{to:'none',content:''},covert:{kind:'none',asset:'oxygen',amount:0,target:'none'},...over});
function commit(w,id,args=decision()){return w.call(id,'complete_assignment',args,id);}
function publicFinish(w){w.call('world','settle_round',{summary:'本轮结果已汇总。',source_ids:w.publicRecords().map(e=>e.id).slice(-2),events:[]},'world');w.finishDay();}

test('eight crew, random reproducible host, seven days, independent budgets',()=>{
  const a=new World({seed:42}),b=new World({seed:42});assert.equal(Object.keys(a.state.crew).length,8);assert.equal(a.state.host,b.state.host);assert.equal(a.state.duty.length,4);assert.equal(a.state.hand.length,6);assert.equal(a.state.energy,3);assert.deepEqual(a.state.resources,{oxygen:75,power:75,supplies:75});
});
test('plan rejects duplicate people/cards, off-duty misuse and Energy overspend without effects',()=>{
  const w=new World({seed:42}),d=w.state.duty,p=JSON.stringify(w.state),off=CREW.find(id=>!d.includes(id));
  assert.throws(()=>w.begin({assignments:[task(d[0]),task(d[0],'pressure:power')]}),/reused/);
  assert.throws(()=>w.begin({assignments:[task(off)]}),/dispatch/);
  assert.throws(()=>w.begin({assignments:[task(d[0],'pressure:oxygen',w.state.hand[0].id),task(d[1],'pressure:power',w.state.hand[0].id)]}),/card_unavailable/);
  assert.throws(()=>w.begin({assignments:d.map((id,i)=>task(id,['pressure:oxygen','pressure:power','pressure:supplies','talk'][i],null,true,i===3?'talk':'assign'))}),/energy_exceeded/);
  assert.equal(JSON.stringify(w.state),p);
});
test('authority card enables off-duty dispatch and is consumed only once',()=>{
  const w=new World({seed:42}),actor=CREW.find(id=>!w.state.duty.includes(id)&&id!==w.state.host),card=w.state.hand.find(c=>c.type==='dispatch');
  w.begin({assignments:[task(actor,'pressure:oxygen',card.id)]});commit(w,actor);assert(!w.state.hand.some(c=>c.id===card.id));const resources=structuredClone(w.state.resources);commit(w,actor);assert.deepEqual(w.state.resources,resources);
});
test('multiple workers on same removed event still resolve from the shared task snapshot',()=>{
  const w=new World({seed:42}),ids=w.state.duty.slice(0,2),slot=w.state.events[0].id;w.state.resources.oxygen=50;
  w.begin({assignments:ids.map(id=>task(id,slot,null,false,'repair'))});commit(w,ids[0]);commit(w,ids[1]);assert.equal(w.state.results.length,2);assert(w.state.results[1].delta.oxygen<w.state.results[0].delta.oxygen);assert(!w.state.events.some(e=>e.id===slot));
});
test('attendance consumes Energy but never increases resource gain',()=>{
  const w1=new World({seed:42}),w2=new World({seed:42});for(const w of [w1,w2])w.state.resources.oxygen=40;
  const id=w1.state.duty[0];w1.begin({assignments:[task(id)]});w2.begin({assignments:[task(id,'pressure:oxygen',null,true)]});commit(w1,id);commit(w2,id);assert.equal(w1.state.resources.oxygen,w2.state.resources.oxygen);assert.equal(w2.state.energy,1);assert.equal(w2.state.evidence.length,0);
});
test('covert budget is capped, none produces no trace, identity absent from all public projections',()=>{
  const w=new World({seed:42});w.begin({assignments:[]});
  assert.throws(()=>commit(w,w.state.host,decision({covert:{kind:'damage',asset:'power',amount:13,target:'none'}})),/integer|budget/);
  commit(w,w.state.host,decision());assert.equal(w.ledger.filter(e=>e.kind==='covert').length,0);
  const p=w.project(),ctx=w.context('world');assert(!Object.hasOwn(p.state,'host'));assert(!JSON.stringify(ctx).includes('privateObjective'));assert(!JSON.stringify(p).includes('private_intent'));
});
test('damage creates internal traces while public anomalies remain anonymous before investigation',()=>{
  const w=new World({seed:42});w.begin({assignments:[]});commit(w,w.state.host,decision({covert:{kind:'damage',asset:'power',amount:4,target:'none'}}));
  w.resolveHidden();const anomaly=w.publicRecords().find(e=>e.kind==='anomaly');assert.equal(anomaly.actor,'system');assert(!anomaly.fact.includes(w.state.crew[w.state.host].name));assert.equal(w.state.assets.power.damage,1);assert.equal(w.state.resources.power,RULES.startingReserve-w.state.assets.power.history.reduce((n,t)=>n+t.amount,0));
  assert(w.state.assets.power.history.some(t=>t.actor===w.state.host));assert.equal(w.project().evidence.length,0);assert(!JSON.stringify(w.context('world')).includes('随后出现额外损耗；仍需'));
});
test('private messages and observations enter only recipient context and require publication',()=>{
  const w=new World({seed:42}),id=w.state.duty[0],recipient=CREW.find(x=>x!==id);w.begin({assignments:[task(id)]});
  commit(w,id,decision({message:{to:recipient,content:'定向消息标记'}}));assert(!JSON.stringify(w.context('world')).includes('定向消息标记'));assert(!JSON.stringify(w.context(recipient)).includes('定向消息标记'));
  publicFinish(w);w.nextDay();w.begin({assignments:[]});assert(JSON.stringify(w.context(recipient)).includes('定向消息标记'));assert(!JSON.stringify(w.project()).includes('定向消息标记'));
});
test('talk is a single resource assignment, grants only one first-time reward',()=>{
  const w=new World({seed:42}),id=w.state.duty[0];w.state.hand=[];w.observe(id,{kind:'sighting',day:1,window:'aftermath',location:'cargo',suspects:CREW.slice(0,2),credibility:1},id);
  w.begin({assignments:[task(id,'talk',null,false,'talk')]});commit(w,id,decision({reveal_ids:[w.state.crew[id].memory[0].id]}));assert.equal(w.state.evidence.length,0);assert.equal(w.state.hand.length,1);assert.equal(w.state.crew[id].talks,1);
});
test('world card sources cannot reference internal memory or covert facts',()=>{
  const w=new World({seed:42});w.begin({assignments:[]});commit(w,w.state.host,decision({covert:{kind:'consume',asset:'power',amount:4,target:'none'}}));w.resolveHidden();const covert=w.ledger.find(e=>e.kind==='covert');
  assert.throws(()=>w.call('world','settle_round',{summary:'未知。',source_ids:[covert.id],events:[]},'bad'),/source_not_public/);
});
test('wrong ejection kills crew permanently, truth ejection ends immediately without model calls',async()=>{
  const w=new World({seed:42}),wrong=w.state.duty.find(id=>id!==w.state.host);w.begin({assignments:[task(wrong,'airlock')]});assert.equal(w.state.crew[wrong].alive,false);assert(!('morale' in w.state.crew[w.state.host]));assert.equal(w.state.energy,2);
  const good=new World({seed:42});good.state.duty[0]=good.state.host;const agent=new FixtureAgent();await runRound(good,agent,{assignments:[task(good.state.host,'airlock')]});assert.equal(good.state.ending.kind,'truth');assert.equal(agent.calls.length,0);
});
test('unhandled deadline and ongoing damage both incur explicit costs',()=>{
  const w=new World({seed:42});w.state.events[0].deadline=1;w.begin({assignments:[]});publicFinish(w);assert(w.ledger.some(e=>e.kind==='deadline'));assert.equal(w.state.resources.oxygen,RULES.startingReserve-RULES.eventPenalty-RULES.dailyLoss-RULES.damageLeak);assert.equal(w.state.phase,'review');
});
test('seven days complete, duty rotates, cards/deaths persist and restart restores exact state',async()=>{
  const w=new World({seed:42}),first=[...w.state.duty];const agent=new FixtureAgent();
  for(let day=1;day<=7;day++){await runRound(w,agent,suggestedPlan(w));assert.equal(replay(w.export()).hash,w.hash());assert.equal(World.restore(w.export()).hash(),w.hash());if(day<7){w.nextDay();if(day===1)assert(first.every(id=>!w.state.duty.includes(id)));}}
  assert.equal(w.state.day,7);assert(['survival','failure'].includes(w.state.ending.kind));assert.throws(()=>w.nextDay(),/not_ready/);
});
test('zero resources gives failure, terminal result includes factual record only',()=>{
  const w=new World({seed:42});w.state.resources.oxygen=1;w.begin({assignments:[]});publicFinish(w);assert.equal(w.state.ending.kind,'failure');assert.equal(w.state.resources.oxygen,0);
});

test('hidden aftermath follows every public assignment and corrupted stored state is rejected',async()=>{
  const w=new World({seed:42});await runRound(w,new FixtureAgent(),suggestedPlan(w));
  const records=w.publicRecords(),anomaly=records.findIndex(e=>e.kind==='anomaly');
  assert(anomaly>records.findLastIndex(e=>e.kind==='assignment'));
  const r=w.export();r.state.resources.oxygen--;assert.throws(()=>World.restore(r),/replay_hash_mismatch/);
});

test('World summary receives final resources after upkeep and deadlines, charged once',async()=>{
 const w=new World({seed:42}),agent=new FixtureAgent();let seen;const decide=agent.decide.bind(agent);
 agent.decide=async(actor,world)=>{if(actor==='world')seen=structuredClone(world.context(actor).resources);return decide(actor,world);};
 await runRound(w,agent,suggestedPlan(w));assert.deepEqual(seen,w.state.resources);
});

test('unscheduled host cannot publish memories, speech or first-hand evidence',()=>{
  const w=new World({seed:42}),host=w.state.host;
  w.observe(host,'私有观察，不能凭空公开。','private');
  w.begin({assignments:[]});
  commit(w,host,decision({share:true,claims:[]}));
  assert.equal(w.project().evidence.length,0);
  assert.equal(w.project().results.length,0);
  assert(!w.project().timeline.some(e=>e.actor===host));
});
test('exiled people are excluded from access records, witnesses and host schedule',()=>{
  const w=new World({seed:42}),dead=w.state.duty.find(id=>id!==w.state.host);
  w.begin({assignments:[task(dead,'airlock')]});
  commit(w,w.state.host,decision({covert:{kind:'damage',asset:'power',amount:4,target:'none'}}));
  w.resolveHidden();
  for(const asset of Object.values(w.state.assets))for(const trace of asset.history)assert(!trace.visitors.includes(dead));
  assert.equal(w.state.crew[dead].memory.length,0);
  assert(!w.context(w.state.host).privateObjective.schedule.locations.some(c=>c.id===dead));
});
test('legacy claims validate ownership but no longer become public deduction clues',()=>{
  const w=new World({seed:42}),human=w.state.duty.find(id=>id!==w.state.host);
  w.observe(human,{kind:'claim',day:1,window:'aftermath',subject:human,location:'cargo',by:human},human,'position');
  const memory=w.state.crew[human].memory[0];w.state.day=2;
  w.begin({assignments:[task(human,'talk',null,false,'talk')]});
  const claim={memory_id:memory.id,day:1,window:'aftermath',location:'medbay'};
  assert.throws(()=>commit(w,human,decision({claims:[claim]})),/claim_not_supported/);
  assert.throws(()=>commit(w,human,decision({reveal_ids:['invented']})),/memory_not_owned/);
  commit(w,human,decision({claims:[{...claim,location:'cargo'}]}));
  assert.deepEqual(w.project().evidence,[]);assert(!w.context(human).self.memory.some(m=>m.kind==='claim'));
  const host=new World({seed:42}),id=host.state.host;host.state.duty[0]=id;host.state.day=2;
  host.begin({assignments:[task(id,'talk',null,false,'talk')]});
  commit(host,id,decision({claims:[{...claim,memory_id:''}]}));
  assert.deepEqual(host.project().evidence,[]);
});
test('frame creates physical loss with unpublished traces; benign losses stay anonymous',()=>{
  const w=new World({seed:42}),host=w.state.host,target=CREW.find(id=>id!==host&&id!=='security');
  w.begin({assignments:[]});
  commit(w,host,decision({covert:{kind:'frame',asset:'power',amount:4,target}}));
  w.resolveHidden();
  const witness=w.state.crew.security.memory.filter(m=>m.category==='witness').at(-1);
  assert.equal(witness,undefined);assert.equal(w.state.assets.power.history.at(-1).amount,4);assert.deepEqual(w.project().evidence,[]);
  const benign=new World({seed:42}),actor=CREW.find(id=>id!==benign.state.host);
  benign.begin({assignments:[]});benign.incident(actor,{asset:'power',amount:2,kind:'consume',target:'none'},false);
  assert(benign.ledger.some(e=>e.kind==='benign'&&!e.audience.includes('public')));
  assert(benign.publicRecords().some(e=>e.kind==='anomaly'&&e.actor==='system'));
});
test('retired morale and fatigue have no effect; maintenance still pays supplies with declining gains',()=>{
  const a=new World({seed:42}),b=new World({seed:42}),id=a.state.duty[0];
  for(const w of [a,b]) {w.state.resources.oxygen=20;w.state.resources.supplies=50;}
  b.state.crew[id].morale=2;b.state.crew[id].fatigue=9;
  for(const w of [a,b]) {w.begin({assignments:[task(id)]});commit(w,id);}
  assert.equal(b.state.resources.oxygen,a.state.resources.oxygen);
  assert.equal(a.state.resources.supplies,50-RULES.maintenanceCost);
  const late=new World({seed:42});late.state.day=RULES.days;late.state.resources.oxygen=20;late.begin({assignments:[task(id)]});commit(late,id);
  assert(late.state.resources.oxygen<a.state.resources.oxygen);
});
test('RULES control horizon, Energy, resource cap and host budget in server and projection',()=>{
  const rules={...RULES,days:1,energy:5,initial:80,startingReserve:80,hostBudget:6};
  const w=new World({seed:42,rules});assert.equal(w.context(w.state.host).daysLeft,1);assert.equal(w.state.energy,5);assert.equal(w.state.resources.oxygen,80);
  w.begin({assignments:[]});assert.equal(w.state.energy,5);assert.equal(w.context(w.state.host).privateObjective.budget,6);
  assert.throws(()=>commit(w,w.state.host,decision({covert:{kind:'consume',asset:'power',amount:7,target:'none'}})),/integer|budget/);
  publicFinish(w);assert.equal(w.state.ending.kind,'survival');assert.equal(w.project().rules.energy,5);
});
test('event prototypes enforce actual collaborators/card, grant rewards without character meters',()=>{
  const w=new World({seed:42}),ids=w.state.duty.slice(0,2);
  const event=w.event('协作抢修','需要两人。','power','cooperation');w.state.events=[event];
  w.begin({assignments:ids.map(id=>task(id,event.id,null,false,'repair'))});commit(w,ids[0]);assert(w.state.events.includes(event));commit(w,ids[1]);assert(!w.state.events.includes(event));
  const material=new World({seed:42}),id=material.state.duty[0],e=material.event('材料故障','需要备件。','power','material');material.state.events=[e];
  material.begin({assignments:[task(id,e.id,null,false,'repair')]});commit(material,id);assert(material.state.events.includes(e));
  const reward=new World({seed:42}),worker=reward.state.duty[0],cache=reward.event('权限回收','完成奖励。','power','cache');reward.state.events=[cache];reward.state.hand=[];
  reward.begin({assignments:[task(worker,cache.id,null,false,'repair')]});commit(reward,worker);assert.equal(reward.state.hand[0].type,'access');
  const morale=new World({seed:42}),m=morale.event('协商','士气问题。','supplies','morale');morale.state.events=[m];morale.begin({assignments:[]});publicFinish(morale);assert(Object.values(morale.state.crew).every(c=>!('morale' in c)&&!('fatigue' in c)));
});
test('World accepts distinct prototypes on occupied systems and all producers obey eventLimit',()=>{
  assert.equal(new World({seed:42,rules:{...RULES,eventLimit:1}}).state.events.length,1);
  const w=new World({seed:42,rules:{...RULES,eventLimit:3}});w.begin({assignments:[]});
  const args={summary:'需要后续协作。',source_ids:w.publicRecords().map(e=>e.id).slice(-1),events:[{title:'协作','description':'需要配合。',asset:'oxygen',prototype:'cooperation',source_ids:w.publicRecords().map(e=>e.id).slice(-1)}]};
  w.call('world','settle_round',args,'world');assert(w.state.events.some(e=>e.kind==='cooperation'));assert.equal(w.state.events.length,3);
  w.incident(w.state.host,{asset:'power',kind:'consume',amount:2,target:'none'},true);w.prepareSettlement();assert.equal(w.state.events.length,3);
});
test('replay reconstructs commands, rejects changed plans/decisions/rng and stores compact checkpoints',async()=>{
  const w=new World({seed:42});await runRound(w,new FixtureAgent(),suggestedPlan(w));
  const recording=w.export();assert.equal(recording.version,3);assert(recording.ledger.filter(e=>e.kind==='checkpoint').every(e=>!e.data.state));
  const changed=structuredClone(recording);changed.commands.find(c=>c.op==='call'&&c.args[0]!== 'world').args[2].memory+='伪造';
  assert.throws(()=>replay(changed),/replay_hash_mismatch/);
  const badRng=structuredClone(recording);badRng.rng++;assert.throws(()=>World.restore(badRng),/replay_runtime_mismatch/);
  const restored=World.restore(recording);restored.nextDay();await runRound(restored,new FixtureAgent(),suggestedPlan(restored));assert.equal(replay(restored.export()).hash,restored.hash());
  const alternative=replay(recording,{rules:{...recording.rules,dailyLoss:recording.rules.dailyLoss+1}});assert.equal(alternative.verified,false);assert.notEqual(alternative.hash,recording.hash);
});
test('legacy v2 is explicitly a checkpoint baseline and subsequent commands replay',async()=>{
  const w=new World({seed:42}),old={version:2,initial:structuredClone(w.state),state:structuredClone(w.state),rng:w.rng,rotation:w.rotation,seq:1,plan:[],hash:w.hash(),ledger:[{id:'e1',kind:'checkpoint',day:1,actor:'system',summary:'',audience:['internal'],sources:[],data:{state:structuredClone(w.state),rng:w.rng}}]};
  assert.equal(replay(old).verified,false);
  const restored=World.restore(old);await runRound(restored,new FixtureAgent(),suggestedPlan(restored));assert.equal(replay(restored.export()).hash,restored.hash());assert(restored.export().baseline);
});

test('legacy ordinary investigation still produces a usable reward without processing tasks or blame',()=>{
 const w=new World({seed:42}),event=w.state.events[0];event.kind='investigation';
 const actor=w.state.duty[0];
 w.begin({assignments:[task(actor,event.id,null,true,'inspect')]});
 commit(w,actor,decision({share:true}));
 assert.equal(w.project().items.length,0);assert.equal(w.project().pendingEvents.length,0);assert(w.state.results.some(r=>/取得|手牌/.test(r.outcome)));assert.deepEqual(w.project().evidence,[]);
 assert(!JSON.stringify(w.project().items).includes('suspects'));
});
test('old runtime imports an explicitly unverified baseline; new commands can be replayed',async()=>{
 const w=new World({seed:42}),old=w.export();old.runtime='seven-days-v2';
 assert.equal(replay(old).verified,false);assert.throws(()=>replay(old,{rules:RULES}),/legacy_runtime/);
 const restored=World.restore(old);await runRound(restored,new FixtureAgent(),suggestedPlan(restored));assert.equal(replay(restored.export()).hash,restored.hash());assert(restored.export().baseline);
});

test('new reports contain no canned testimony and player projection preserves replay',()=>{
  const w=new World({seed:42}),actor=w.state.duty[0];
  w.begin({assignments:[{actor,slot:'talk',verb:'talk',card:null,attend:false}]});
  w.call(actor,'complete_assignment',decision(),'copy-check');
  const before=w.export();
  assert.equal(w.state.results[0].testimony,'');
  const v=w.project();
  assert.equal(v.results[0].testimony,'');
  assert(!JSON.stringify(v.slots).includes('Energy'));
  assert(!v.slots.find(s=>s.kind==='talk').description.includes('不展开聊天'));
  assert(v.timeline.find(e=>e.kind==='orders').summary.includes('精力'));
  assert(!v.timeline.find(e=>e.kind==='orders').summary.includes('Energy'));
  assert.equal(v.timeline.find(e=>e.kind==='assignment').summary,`${w.state.crew[actor].role} · ${w.state.crew[actor].name}：${v.results[0].outcome}`);
  assert.deepEqual(w.export(),before);
  assert.deepEqual(World.restore(before).export(),before);
  w.record('covert',actor,'隐藏操作',{audience:['internal'],data:{asset:'oxygen',kind:'damage',amount:2}});
  w.end('failure','航程终止。');
  assert(w.project().state.ending.history[0].text.includes('破坏'));
  assert(w.state.ending.history[0].text.includes('damage'));
});

test('planning upkeep uses public damage and configured rules without mutating or exposing private state',()=>{
  const w=new World({seed:42,rules:{...RULES,dailyLoss:5,damageLeak:2}});
  w.state.day=3;w.state.assets.oxygen.damage=2;const before=w.hash(),v=w.project();
  assert.deepEqual(v.planning,{upkeep:{oxygen:10,power:6,supplies:6}});
  assert.equal(w.hash(),before);assert(!JSON.stringify(v.planning).includes(w.state.host));
});
