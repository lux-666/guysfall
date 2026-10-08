import test from 'node:test';
import assert from 'node:assert/strict';
import { World, replay } from '../src/world.mjs';
import { LiveAgent,FixtureAgent,runRound,suggestedPlan } from '../src/agents.mjs';
import { fixtureBuildEvent } from '../src/builds.mjs';
const config={base:'https://fixture.invalid/v1',model:'test-model',apiKey:'test-only',wireApi:'responses'};
const args=()=>({delivery:'direct',reveal_ids:[],claims:[],accuse:'none',approach:'work',share:false,note:'按岗位处理。',memory:'',message:{to:'none',content:''},covert:{kind:'none',asset:'oxygen',amount:0,target:'none'}});
const response=(a,status='completed',name='complete_assignment')=>{const data=JSON.stringify({type:'response.completed',response:{status,output:[{type:'function_call',id:'fc',call_id:'call',name,arguments:JSON.stringify(a)}]}});const bytes=new TextEncoder().encode(`data: ${data}\n\n`);return new Response(new ReadableStream({start(c){c.enqueue(bytes.slice(0,31));c.enqueue(bytes.slice(31));c.close();}}),{headers:{'content-type':'text/event-stream'}});};
test('one Responses request submits one whole assignment, no finish request',async t=>{
  const w=new World({seed:42});w.begin(suggestedPlan(w));let count=0;
  t.mock.method(globalThis,'fetch',async(url,opts)=>{count++;assert.equal(url,config.base+'/responses');assert.equal(JSON.parse(opts.body).tools.length,1);return response(args());});
  const agent=new LiveAgent(config),d=await agent.decide(w.state.host,w);w.call(d.actor,d.name,d.args,d.key);assert.equal(count,1);assert.equal(w.state.results.length,1);
});
test('invalid parameters are corrected at most once before any effects commit',async t=>{
  const w=new World({seed:42});w.begin(suggestedPlan(w));let count=0;t.mock.method(globalThis,'fetch',async()=>{count++;return response({...args(),approach:count===1?'invented':'work'});});
  const d=await new LiveAgent(config).decide(w.state.host,w);assert.equal(count,2);assert.equal(w.state.results.length,0);w.call(d.actor,d.name,d.args,d.key);assert.equal(w.state.results.length,1);
});
test('all actor decisions see same pre-commit snapshot; host scheduled only once',async()=>{
  const w=new World({seed:42}),agent=new FixtureAgent(),seen=[];const original=agent.decide.bind(agent);agent.decide=async(id,w)=>{if(id!=='world')seen.push(w.state.results.length);return original(id,w);};
  await runRound(w,agent,suggestedPlan(w));assert(seen.every(n=>n===0));assert.equal(agent.calls.filter(c=>c.actor===w.state.host).length,1);
});
test('HTTP and incomplete response failures never fall back to a script or commit actions',async t=>{
  const w=new World({seed:42});w.begin(suggestedPlan(w));t.mock.method(globalThis,'fetch',async()=>new Response('',{status:503}));await assert.rejects(new LiveAgent(config).decide(w.state.host,w),/HTTP 503/);assert.equal(w.state.results.length,0);
  t.mock.method(globalThis,'fetch',async()=>response(args(),'incomplete'));await assert.rejects(new LiveAgent(config).decide(w.state.host,w),/未完整/);assert.equal(w.state.results.length,0);
});

test('429/5xx retries only the failed request and permanent HTTP errors stop immediately',async t=>{
  const w=new World({seed:42});w.begin(suggestedPlan(w));let count=0;
  t.mock.method(globalThis,'fetch',async()=>{count++;return count<3?new Response('',{status:count===1?429:502}):response(args());});
  const agent=new LiveAgent(config);await agent.decide(w.state.host,w);assert.equal(count,3);assert.equal(agent.calls.length,3);assert.equal(w.state.results.length,0);
  count=0;t.mock.method(globalThis,'fetch',async()=>{count++;return new Response('',{status:401});});
  await assert.rejects(new LiveAgent(config).decide(w.state.host,w),/HTTP 401/);assert.equal(count,1);
});
test('host decisions survive failed world settlement and rollback; changed plans invalidate cache',async t=>{
  const w=new World({seed:42}),plan=suggestedPlan(w),before=w.export(),agent=new LiveAgent(config);let count=0;
  t.mock.method(globalThis,'fetch',async(_url,opts)=>{
    const ctx=JSON.parse(JSON.parse(opts.body).input[0].content);
    if(!ctx.self)return new Response('',{status:401});
    assert.equal(ctx.self.id,w.state.host);count++;return response(args());
  });
  await assert.rejects(runRound(w,agent,plan),/HTTP 401/);assert.equal(count,1);
  const rolled=World.restore(before);rolled.begin(plan);
  await agent.decide(w.state.host,rolled);assert.equal(count,1);
  const reload=new LiveAgent(config);reload.decisions=new Map(JSON.parse(JSON.stringify([...agent.decisions])));
  await reload.decide(w.state.host,rolled);assert.equal(count,1);
  const changed=World.restore(before),newPlan=structuredClone(plan);
  const hostAssignment=newPlan.assignments.find(a=>a.actor===w.state.host);
  assert(hostAssignment);hostAssignment.attend=true;changed.begin(newPlan);
  await reload.decide(w.state.host,changed);assert.equal(count,2);
  const switched=new LiveAgent({...config,model:'gpt-6.1-sol'});switched.decisions=new Map(reload.decisions);
  await switched.decide(w.state.host,rolled);assert.equal(count,3);
});

test('live rounds call only host and world, batch readiness, and replay deterministic humans',async t=>{
  for(const assigned of [false,true]) {
    const w=new World({seed:42}),agent=new LiveAgent(config),requests=[],ready=[];let hostDone=false;
    const plan=suggestedPlan(w);if(!assigned)plan.assignments=plan.assignments.filter(a=>a.actor!==w.state.host);
    t.mock.method(globalThis,'fetch',async(_url,opts)=>{
      const ctx=JSON.parse(JSON.parse(opts.body).input[0].content);requests.push(ctx.self?.id||'world');
      if(ctx.self){assert.equal(ctx.privateObjective.identity,'拟态宿主');await Promise.resolve();hostDone=true;return response(args());}
      assert(!('privateObjective' in ctx));assert(!('host' in ctx));
      return response({summary:'公开结果。',source_ids:ctx.public_results.slice(-2).map(e=>e.id),events:ctx.generationTask.eventCount?[fixtureBuildEvent(ctx)]:[]},'completed','settle_round');
    });
    await runRound(w,agent,plan,e=>{if(e.tool==='decision_ready'&&e.actor!=='world'){assert(hostDone);ready.push(e.actor);}});
    assert.deepEqual(requests,[w.state.host,'world']);assert.equal(agent.calls.length,2);
    assert.equal(new Set(ready).size,plan.assignments.length+(assigned?0:1));
    assert.equal(w.state.phase,'review');assert.equal(replay(w.export()).hash,w.hash());
  }
});

test('human work excludes detective memories and never requests a model, even without config',async t=>{
  t.mock.method(globalThis,'fetch',()=>{throw new Error('human called model');});
  const w=new World({seed:42});await runRound(w,new FixtureAgent(),suggestedPlan(w));w.nextDay();
  const actor=w.state.duty.find(id=>id!==w.state.host),agent=new LiveAgent(null);
  w.begin({assignments:[{actor,slot:'talk',verb:'talk',card:null,attend:false}]});
  const before=w.hash(),d=await agent.decide(actor,w),owned=w.context(actor).self.memory;
  assert.equal(w.hash(),before);assert.equal(agent.calls.length,0);assert.equal(agent.decisions.size,0);
  assert.equal(d.args.approach,'work');assert.equal(d.args.share,true);assert.equal(d.args.covert.kind,'none');
  assert(!owned.some(m=>m.kind));assert.equal(d.args.claims.length,0);
  assert.deepEqual(d.args.reveal_ids,owned.filter(m=>m.kind&&m.kind!=='claim').map(m=>m.id));
  for(const claim of d.args.claims){const m=owned.find(m=>m.id===claim.memory_id);assert(m);assert.equal(claim.location,m.location);}
  w.call(actor,d.name,d.args,d.key);
  for(const id of d.args.reveal_ids)assert(w.state.evidence.some(e=>e.memory_id===id));
});
