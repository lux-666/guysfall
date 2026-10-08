import test from 'node:test';
import assert from 'node:assert/strict';
import { World, replay } from '../src/world.mjs';
import { LiveAgent } from '../src/agents.mjs';
import { route } from '../src/builds.mjs';
import { eventGenerationRequest, validateGeneratedEvents } from '../src/event-generation.mjs';

const config={base:'http://mock.invalid',model:'test-only',apiKey:'test-only',wireApi:'chat_completions'};
const ready=()=>{const w=new World({seed:42});w.begin({assignments:[]});return w;};
const sources=w=>w.publicRecords().slice(-1).map(e=>e.id);
const offer=w=>({summary:'公开结果。',source_ids:sources(w),events:[{
  title:'备用线束拆取窗口',description:'旧线束可以拆取或整理归库。',asset:'power',prototype:'build',duration:3,penalty:9,source_ids:sources(w),routes:[
    route({id:'recover',label:'拆取线束',suppliesCost:0,restore:{oxygen:0,power:0,supplies:6}}),
    route({id:'sort',label:'整理归库',workers:2,suppliesCost:0,restore:{oxygen:0,power:0,supplies:10}})
  ]}]});
const response=args=>new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'world',function:{name:'settle_round',arguments:JSON.stringify(args)}}]}}]}),{headers:{'content-type':'application/json'}});

test('new world request requires a route event without components; world projection stays public',()=>{
  const w=ready(),request=eventGenerationRequest(w),args=offer(w);
  assert.equal(request.context.generationTask.mode,'new_choice_event');
  assert.equal(request.tool.function.parameters.properties.events.minItems,1);
  assert.equal(request.tool.function.parameters.properties.events.maxItems,1);
  assert.deepEqual(request.tool.function.parameters.properties.events.items.properties.prototype.enum,['build']);
  assert(!('self' in request.context));assert(!('privateObjective' in request.context));
  validateGeneratedEvents(args,request);w.validateDecision('world','settle_round',args);
  assert.throws(()=>validateGeneratedEvents({...args,events:[]},request),/generation_contract/);
  const result=w.call('world','settle_round',args,'new-event');
  assert.equal(result.submitted,1);assert.equal(result.accepted.length,1);assert.deepEqual(result.ignored,[]);
  assert(w.state.events.some(e=>e.id===result.accepted[0].id));assert.equal(replay(w.export()).hash,w.hash());
});

test('full desk, reserved follow-ups, route backlog, final days and failed voyages request summary only',()=>{
  const cases=[
    ['event_capacity',w=>{w.rules.eventLimit=w.state.events.length;}],
    ['event_capacity',w=>{w.rules.eventLimit=3;w.state.pendingEvents.push({kind:'repair',title:'排队后续',asset:'power'});} ],
    ['unresolved_route_events',w=>w.state.pendingEvents.push({kind:'build',title:'待入台路线',asset:'power'})],
    ['generation_window_closed',w=>{w.state.day=6;}],
    ['generation_window_closed',w=>{w.rules.days=2;w.state.day=2;}],
    ['resources_depleted',w=>{w.state.resources.oxygen=0;}],
    ['already_offered_today',w=>{w.state.buildOfferedDay=w.state.day;}]
  ];
  for(const [reason,mutate] of cases){const w=ready();mutate(w);w.record('summary','system','本日公开测试记录。');const request=eventGenerationRequest(w);
    assert.equal(request.context.generationTask.reason,reason);assert.equal(request.context.generationTask.eventCount,0);
    validateGeneratedEvents({...offer(w),events:[]},request);
    assert.throws(()=>validateGeneratedEvents(offer(w),request),/generation_contract/);
  }
});

test('duplicates against current and queued events receive actionable errors, even with renamed legacy titles',()=>{
  const w=ready(),args=offer(w),request=eventGenerationRequest(w);
  const old={...args,events:[{title:'换了名字的氧循环维修',description:'旧故障。',asset:'oxygen',prototype:'repair',source_ids:sources(w)}]};
  assert.throws(()=>validateGeneratedEvents(old,request),/duplicate_event.*oxygen\/repair/);
  args.events[0].title=w.state.events[0].title;assert.throws(()=>validateGeneratedEvents(args,request),/duplicate_event/);
  w.state.pendingEvents.push({title:'排队后续',kind:'supply',asset:'supplies'});args.events[0].title='排队后续';
  assert.throws(()=>validateGeneratedEvents(args,eventGenerationRequest(w)),/duplicate_event/);
});

test('live world corrects a duplicate once before mutation; empty replacement also fails the contract',async t=>{
  for(const fixed of [true,false]){
    const w=ready(),agent=new LiveAgent(config),before=w.hash();let count=0;
    t.mock.method(globalThis,'fetch',async(_url,opts)=>{const body=JSON.parse(opts.body);count++;
      if(count===1)return response({...offer(w),events:[{title:'氧循环再次维修',description:'重复。',asset:'oxygen',prototype:'repair',source_ids:sources(w)}]});
      assert.match(body.messages.at(-1).content,/duplicate_event/);assert.equal(w.hash(),before);
      return response(fixed?offer(w):{...offer(w),events:[]});
    });
    if(fixed){const decision=await agent.decide('world',w);assert.equal(w.hash(),before);const result=w.call('world',decision.name,decision.args,decision.key);assert.equal(result.accepted.length,1);}
    else {await assert.rejects(agent.decide('world',w),/generation_contract/);assert.equal(w.hash(),before);}
    assert.equal(count,2);assert.match(agent.calls[0].validationError,/duplicate_event/);
  }
});

test('world settlement reports legacy duplicates and capacity skips accurately and idempotently',()=>{
  const w=ready(),refs=sources(w),args={summary:'旧接口结算。',source_ids:refs,events:[
    {title:'重复维修',description:'旧故障。',asset:'oxygen',prototype:'repair',source_ids:refs},
    {title:'新协作',description:'需要协作。',asset:'oxygen',prototype:'cooperation',source_ids:refs}
  ]};
  const result=w.call('world','settle_round',args,'legacy');
  assert.equal(result.submitted,2);assert.equal(result.accepted.length,1);assert.equal(result.ignored[0].reason,'duplicate_event');
  assert.equal(result.accepted[0].title,'新协作');assert.equal(result.accepted[0].index,1);
  assert.deepEqual(w.call('world','settle_round',args,'legacy'),result);assert.equal(replay(w.export()).hash,w.hash());
  const full=ready();full.rules.eventLimit=full.state.events.length;
  const dropped=full.call('world','settle_round',{...args,source_ids:sources(full),events:[{...args.events[1],source_ids:sources(full)}]},'full');
  assert.equal(dropped.accepted.length,0);assert.equal(dropped.ignored[0].reason,'event_capacity');
});

test('legacy repair or investigation proposals are blocked; controlled build remains valid',()=>{
  const w=ready(),request=eventGenerationRequest(w);
  const legacy=[
    {title:'主氧循环泄漏',description:'现场仍有漏损，需要维修。',asset:'oxygen',prototype:'repair',source_ids:sources(w)},
    {title:'配给系统异常记录',description:'需要核对额外损耗。',asset:'supplies',prototype:'investigation',source_ids:sources(w)}
  ];
  for(const event of legacy)assert.throws(()=>validateGeneratedEvents({...offer(w),events:[event]},request),/generation_contract|duplicate_event/);
  // New generation keeps two choices; both optional follow-up choices remain usable.
  const event={title:'冷库拆除现场的余料处置',description:'冷库拆除后，余料需要分拣或集中回收。',asset:'supplies',prototype:'build',duration:3,penalty:9,source_ids:sources(w),routes:[
    route({id:'sort',label:'就地分拣余料',suppliesCost:0,restore:{oxygen:0,power:0,supplies:6}}),
    route({id:'pack',label:'用备件整理可用材料',card:'parts',suppliesCost:0,restore:{oxygen:0,power:0,supplies:10},rewardCard:'parts'}),
    route({id:'bulk',label:'集中回收，随后清理堆放现场',workers:2,suppliesCost:0,restore:{oxygen:0,power:0,supplies:10},rewardCard:'parts',followUp:'generated',followUpEvent:{
      title:'回收后的余料堆放',description:'集中回收留下的余料需要清理。',asset:'supplies',duration:2,penalty:4,routes:[
        route({id:'clear',label:'直接清理余料',suppliesCost:0,restore:{oxygen:0,power:0,supplies:2}}),
        route({id:'resort',label:'两人重新分拣',workers:2,suppliesCost:2,restore:{oxygen:0,power:0,supplies:8}})
      ]
    }})
  ]};
  const args={...offer(w),events:[event]};assert.throws(()=>validateGeneratedEvents(args,request));event.routes.splice(1,1);validateGeneratedEvents(args,request);w.validateDecision('world','settle_round',args);
});
