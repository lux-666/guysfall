import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { World, replay } from '../src/world.mjs';
import { FixtureAgent, LiveAgent, runRound } from '../src/agents.mjs';
import { LEGACY_TESTIMONY_VOICES } from '../src/content.mjs';
import { route } from '../src/builds.mjs';
import { factLabel } from '../client/model.ts';

const decision=()=>({approach:'work',share:true,delivery:'uncertain',reveal_ids:[],claims:[],accuse:'none',note:'处理派遣。',memory:'',message:{to:'none',content:''},covert:{kind:'none',asset:'oxygen',amount:0,target:'none'}});
const logText=w=>{const v=w.project();return [...v.results.map(r=>r.outcome),...v.timeline.map(e=>e.summary),...v.evidence.map(f=>factLabel(f,v)),v.roundSummary].join('\n');};
const boilerplate=/不等于|不能据此|结合不同日期|不增加任务产出|路线(?:永久)?关闭|新的处理办法|带入下一日|规则结算/;

test('access reports retain dated traces and inconsistent registers without deduction advice',()=>{
  const w=new World({seed:42}),out=[];
  for(const credibility of [2,1])w.publishFact('engineer',{kind:'access',day:1,window:'aftermath',actor:null,location:'engine',asset:'oxygen',method:credibility===1?'不一致的出入记录':'非标准拆卸',present:['engineer','medic'],credibility,incident:`trace-${credibility}`},out);
  const v=w.project();
  assert.equal(v.evidence.length,2);
  assert(out.every(s=>s.includes('第1日供氧')&&s.includes('工程师 · 林')&&s.includes('医官 · 许')));
  assert(factLabel(v.evidence[1],v).includes('登记存在不一致'));
  assert.doesNotMatch([...out,...w.publicRecords().map(e=>e.fact),logText(w)].join('\n'),boilerplate);
  assert(v.evidence.every(f=>f.actor===null));
});

test('supervision reports describe attendance and fixed summaries use final resources',async()=>{
  const w=new World({seed:42}),actor=w.state.duty[0];
  await runRound(w,new FixtureAgent(),{assignments:[{actor,slot:'pressure:oxygen',verb:'repair',card:null,attend:true}]});
  const v=w.project();assert(v.results[0].outcome.includes('监察官在供氧现场监工。'));
  assert.equal(v.roundSummary,`第1日结束。O₂ ${v.state.resources.oxygen} / PWR ${v.state.resources.power} / SUP ${v.state.resources.supplies}。`);
  assert.doesNotMatch(logText(w),boilerplate);assert.equal(replay(w.export()).hash,w.hash());
});

test('investigation and completed choices report findings and costs without route tutorial text',()=>{
  const w=new World({seed:42});
  const e=w.event('接头发热','接头发热。','power','build');
  const leaves=[route({id:'fix',label:'固定接头',suppliesCost:2,restore:{oxygen:0,power:8,supplies:0}}),route({id:'leave',label:'停用接头',suppliesCost:0,loss:{oxygen:0,power:2,supplies:0}})];
  e.routes=[route({id:'inspect',label:'检查接头',verb:'inspect',suppliesCost:0,discovery:{finding:'接头松脱。',routes:leaves}}),leaves[1]];w.state.events=[e];
  const execute=(r,key)=>{const actor=w.state.duty[0];w.begin({assignments:[{actor,slot:e.id,route:r.id,verb:r.verb,card:null,attend:false}]});w.call(actor,'complete_assignment',decision(),key);};
  execute(e.routes[0],'inspect');assert(logText(w).includes('接头松脱。'));assert(w.state.events.includes(e));assert.doesNotMatch(logText(w),boilerplate);
  w.call('world','settle_round',{summary:'接头松脱，尚未修复。',source_ids:w.publicRecords().slice(-1).map(e=>e.id),events:[]},'finish');w.finishDay();w.nextDay();
  execute(leaves[0],'fix');assert(logText(w).includes('消耗 2 SUP；电力 +8'));assert(!w.state.events.includes(e));assert.doesNotMatch(logText(w),boilerplate);
});

test('old log cleanup preserves the evidence and stored state while hiding migration notes',()=>{
  const w=new World({seed:42}),actor='security',voice=LEGACY_TESTIMONY_VOICES[actor][1];
  const old='第1日供电：不一致的出入记录；接触范围 安保官 · 卫。登记可能被伪造，不能据此排除范围外的人。';
  w.state.results=[{actor,title:'调查供电',outcome:`${old} ${voice}`,delta:{},testimony:voice}];
  w.state.summaries=[{day:1,text:'本轮派遣已结算；资源、保留物品和未处理事件将带入下一日。'}];
  w.record('assignment',actor,`${old} ${voice}`);w.record('rules_update','system','玩法已简化。');
  w.publishFact(actor,{kind:'access',day:1,actor:null,location:'security',asset:'power',method:'不一致的出入记录',present:[actor],credibility:1,incident:'old-trace'},[]);
  const before=w.export(),v=w.project();
  assert.doesNotMatch(logText(w),boilerplate);assert(!logText(w).includes(voice));assert.equal(v.results[0].testimony,'');
  assert(v.results[0].outcome.includes('不一致的出入记录'));assert.deepEqual(v.evidence,w.publicFacts());
  assert(!v.timeline.some(e=>e.kind==='rules_update'));assert(!w.publicRecords().some(e=>e.kind==='rules_update'));
  assert.doesNotMatch(w.context('world').public_results.map(e=>e.fact).join('\n'),boilerplate);assert.deepEqual(w.export(),before);
});

test('report projection separates only published facts contained in the report without changing saves',()=>{
  const w=new World({seed:42}),actor='engineer',out=[];
  const fact={kind:'access',day:1,window:'aftermath',actor:null,location:'engine',asset:'oxygen',method:'非标准拆卸',present:['engineer','medic'],credibility:2,incident:'trace'};
  w.publishFact(actor,fact,out);w.state.results=[{actor,title:'调查供氧',outcome:out.join(' ')+' 监察官在供氧现场监工。',delta:{oxygen:0,power:0,supplies:0}}];
  w.record('assignment',actor,`${w.state.crew[actor].role} · ${w.state.crew[actor].name}：${w.state.results[0].outcome}`);
  w.observe(actor,'私有记录','private');const before=w.export(),v=w.project();
  assert.deepEqual(v.results[0].factIds,[v.evidence[0].id]);assert.equal(v.results[0].notes,'监察官在供氧现场监工。');
  const entry=v.timeline.find(e=>e.kind==='assignment');assert.deepEqual(entry.factIds,v.results[0].factIds);assert(!entry.notes.includes('接触范围'));
  assert(!JSON.stringify(v).includes('私有记录'));assert.deepEqual(w.export(),before);
  // A fact published separately is not attached to an unrelated report by author/date alone.
  w.state.results[0].outcome='维护完成。';assert.deepEqual(w.project().results[0].factIds,[]);
});

test('v7 snapshot imports unchanged and new commands replay with the new log format',async()=>{
  const w=new World({seed:42}),old=w.export();old.runtime='agent-play-v7';
  old.ledger.find(e=>e.kind==='start').summary='接触机会不等于实施破坏。';
  const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
  old.runtimeHash=hash({state:old.state,rng:old.rng,rotation:old.rotation,seq:old.seq,plan:old.plan,ledger:old.ledger});
  const before=structuredClone(old),restored=World.restore(old);assert.deepEqual(restored.state,old.state);assert.deepEqual(old,before);
  assert.equal(restored.export().runtime,'event-opportunities-v9');assert.equal(replay(old).legacyBaseline,true);
  assert.doesNotMatch(logText(restored),boilerplate);
  await runRound(restored,new FixtureAgent(),{assignments:[]});assert.equal(replay(restored.export()).hash,restored.hash());
  const bad=structuredClone(old);bad.state.resources.power--;assert.throws(()=>World.restore(bad),/replay_hash_mismatch/);
});

test('model summary requests explicitly keep rules and deduction advice out of voyage prose',async t=>{
  const w=new World({seed:42}),agent=new LiveAgent({base:'https://mock.invalid',model:'test-only',apiKey:'test-only'});
  w.state.day=6;w.setDuty();
  w.begin({assignments:[]});w.prepareSettlement();
  t.mock.method(globalThis,'fetch',async(_url,opts)=>{
    const request=JSON.parse(opts.body),description=request.tools[0].function.parameters.properties.summary.description;
    assert.match(description,/不复述规则、不讲推理原则/);assert.match(request.messages[0].content,/不写规则解说、推理提醒、操作指导/);
    return new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'summary',function:{name:'settle_round',arguments:JSON.stringify({summary:'供氧仍有泄漏。',source_ids:w.publicRecords().slice(-1).map(e=>e.id),events:[]})}}]}}]}));
  });
  assert.equal((await agent.decide('world',w)).args.summary,'供氧仍有泄漏。');assert.equal(agent.calls.length,1);
});
