import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.mjs';
import { GameStore, placeCrew, validateDraft, energyUsed, paginateEntries, factLabel, factEntry, reportEntries, timelineEntry, archiveEntries, layoutLogEntries, routeNeeds, routeIssues, routeSummary, planReview } from '../client/model.ts';
function view(){return {id:'test-voyage',mode:'fixture',status:'idle',error:null,...new World({seed:123}).project()};}
test('client moves crew without duplication and server accepts its resulting plan',()=>{
  const w=new World({seed:321}),v={id:'x',mode:'fixture',status:'idle',...w.project()},crew=v.crew.find(c=>c.onDuty);
  const first=placeCrew(v,[],crew.id,'pressure:oxygen');const moved=placeCrew(v,first,crew.id,'pressure:power');assert.equal(moved.length,1);assert.equal(moved[0].slot,'pressure:power');assert.doesNotThrow(()=>w.validatePlan({assignments:moved}));
});
test('off-duty dispatch cannot be silently removed and cards cannot be spent twice',()=>{
  const v=view(),off=v.crew.find(c=>!c.onDuty),on=v.crew.find(c=>c.onDuty);
  const plan=placeCrew(v,[],off.id,'pressure:oxygen');assert.equal(v.hand.find(c=>c.id===plan[0].card).type,'dispatch');assert.ok(validateDraft(v,[{...plan[0],card:null}]));
  assert.ok(validateDraft(v,[...plan,{actor:on.id,slot:'pressure:power',verb:'assign',card:plan[0].card,attend:false}]));
  assert.throws(()=>placeCrew(v,[],off.id,'airlock'));
});
test('talk and attendance share one budget; occupied pressure rejects extra crew',()=>{
  const v=view(),off=v.crew.filter(c=>!c.onDuty),on=v.crew.filter(c=>c.onDuty);
  let plan=placeCrew(v,[],off[0].id,'talk');plan=placeCrew(v,plan,off[1].id,'talk');plan=plan.map(a=>({...a,attend:true}));assert.equal(energyUsed(v,plan),6);assert.ok(validateDraft(v,plan));
  const pressure=placeCrew(v,[],on[0].id,'pressure:oxygen');assert.throws(()=>placeCrew(v,pressure,on[1].id,'pressure:oxygen'));
});
test('reconnect and failed round preserve draft; completed round and next day reset it',()=>{
  const v=view(),s=new GameStore();s.accept(v);s.place(v.crew.find(c=>c.onDuty).id,'pressure:oxygen');const draft=structuredClone(s.plan);
  s.accept({...v,status:'running'});assert.deepEqual(s.plan,draft);assert.equal(s.edit([]),false);
  s.accept({...v,error:'rolled back'});assert.deepEqual(s.plan,draft);assert.equal(s.editable,true);
  s.accept({...v,state:{...v.state,phase:'review'},plan:draft});assert.deepEqual(s.plan,draft);
  s.accept({...v,state:{...v.state,day:2}});assert.deepEqual(s.plan,[]);
});
test('request failure keeps assignments and unlocks submission',async()=>{
  const v=view(),s=new GameStore();s.accept(v);s.place(v.crew.find(c=>c.onDuty).id,'pressure:oxygen');const draft=structuredClone(s.plan);s.api=async()=>{throw new Error('offline');};await s.act('resolve');assert.equal(s.busy,false);assert.equal(s.message,'offline');assert.deepEqual(s.plan,draft);
});
test('browser draft storage restores only valid plans for the same voyage and day',t=>{
  const memory=new Map();const original=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)}}});t.after(()=>{if(original)Object.defineProperty(globalThis,'window',original);else delete globalThis.window;});
  const v=view(),s=new GameStore();s.accept(v);s.place(v.crew.find(c=>c.onDuty).id,'pressure:oxygen');const draft=structuredClone(s.plan),restored=new GameStore();restored.accept(v);assert.deepEqual(restored.plan,draft);
  restored.accept({...v,state:{...v.state,day:2}});assert.deepEqual(restored.plan,[]);
  memory.set(s.draftKey(v),JSON.stringify([{actor:'missing',slot:'pressure:oxygen',verb:'assign',card:null,attend:false}]));const invalid=new GameStore();invalid.accept(v);assert.deepEqual(invalid.plan,[]);
});

test('archive pages keep facts together and split oversized records without losing lines',()=>{
  assert.deepEqual(paginateEntries([['a','b'],['c','d']],4),['a\nb','c\nd']);
  assert.deepEqual(paginateEntries([['a'],['b']],4),['a\n\nb']);
  assert.deepEqual(paginateEntries([['a','b','c','d','e'],['f']],3),['a\nb\nc','d\ne','f']);
  assert.deepEqual(paginateEntries([],16),['']);
  const v=view();
  const label=factLabel({id:'x',actor:'clerk',kind:'claim',day:1,window:'task',location:'bridge',subject:'clerk',by:'clerk'},v);
  assert.equal(label.split(v.crew.find(c=>c.id==='clerk').role).length,2);
  assert(label.includes('第 1 日')&&label.includes(v.locations.bridge));
  assert(factLabel({id:'s',actor:'cook',kind:'sighting',day:1,location:'cargo',suspects:['scientist','medic'],credibility:1},v).includes(' 或 '));
});

test('structured fact cards preserve contacts, uncertainty and withdrawal amounts without assigning guilt',()=>{
  const v=view(),fact={id:'trace',day:1,kind:'access',window:'aftermath',actor:null,location:'cargo',method:'不一致的出入记录',present:['cook','storekeeper','medic'],credibility:1};
  const card=factEntry(fact,v);assert.equal(card.title,'不一致的出入记录');assert.equal(card.meta,'第 1 日 · 事后 · 货舱');assert.deepEqual(card.people,fact.present);assert.equal(card.warning,'登记存在不一致');assert.deepEqual(card.lines,[]);
  const withdrawal=factEntry({id:'w',day:1,actor:'cook',kind:'withdraw',location:'cargo',asset:'supplies',amount:2,logged:false},v);
  assert(withdrawal.lines.some(line=>line.includes('厨师 · 陶')&&line.includes('SUP 2')));assert(withdrawal.lines.includes('未登记'));
});

test('report cards resolve public fact references once and retain narrative-only historical reports',()=>{
  const v=view();v.evidence=[{id:'f1',day:1,actor:null,kind:'access',location:'engine',method:'非标准拆卸',present:['engineer'],credibility:2}];
  const r={actor:'clerk',title:'调查供氧',outcome:'旧文本。',notes:'监察官在场。 使用操作许可。',factIds:['f1'],delta:{}};
  const cards=reportEntries(r,v);assert.equal(cards.length,2);assert.deepEqual(cards[0].lines,['监察官在场。','使用操作许可。']);assert.deepEqual(cards[1].people,['engineer']);
  assert.deepEqual(reportEntries({...r,notes:undefined,factIds:undefined},v)[0].lines,['旧文本。']);
  const entry=timelineEntry({id:'e1',day:2,actor:'world',kind:'summary',summary:'现场事项尚未处理完。'},v);assert.equal(entry.title,'日结记录');assert.equal(entry.meta,'第 2 日 · 航程记录');
});

test('measured card pagination retains long notes, eight contacts, warnings and continuation context',()=>{
  const wrap=(text,size,width)=>{const count=Math.max(1,Math.floor(width/size));return text.match(new RegExp(`.{1,${count}}`,'gu'))||[];};
  const v=view(),body='记录'.repeat(220),entry={key:'long',title:'现场记录',meta:'第 1 日 · 货舱',lines:[body],people:v.crew.map(c=>c.id),warning:'登记存在不一致'};
  const pages=layoutLogEntries([entry,{key:'next',title:'下一条',meta:'第 2 日',lines:['结束。']}],720,460,wrap),cards=pages.flat();
  assert(pages.length>1);for(const page of pages)assert(page.reduce((sum,c)=>sum+c.height,0)+(page.length-1)*12<=460);
  const parts=cards.filter(c=>c.key==='long');assert.equal(parts.map(c=>c.body.join('')).join(''),`• ${body}`);assert(parts.slice(1).every(c=>c.continued));
  assert(parts.every(c=>c.people.length===8&&c.warning===entry.warning&&c.meta===entry.meta));assert.equal(cards.at(-1).key,'next');
  assert.deepEqual(layoutLogEntries([],720,460,wrap),[[]]);
});

test('archive groups same-day upkeep and exposes recorded costs without rewriting other prose',()=>{
  const v=view();v.timeline=[{id:'o',day:1,actor:'system',kind:'upkeep',summary:'O₂ 日常与设备损耗 −8。'}, {id:'p',day:1,actor:'system',kind:'upkeep',summary:'PWR 日常与设备损耗 −7。'}, {id:'s',day:1,actor:'system',kind:'upkeep',summary:'SUP 日常与设备损耗 −9。'}, {id:'summary',day:1,actor:'world',kind:'summary',summary:'尚有几件待办。'}, {id:'next',day:2,actor:'system',kind:'upkeep',summary:'O₂ 日常与设备损耗 −9。'}];
  const before=structuredClone(v),entries=archiveEntries(v);assert.equal(entries.length,3);assert.deepEqual(entries[2].delta,{oxygen:-8,power:-7,supplies:-9});assert.deepEqual(entries[0].delta,{oxygen:-9});assert.deepEqual(entries[1].lines,['尚有几件待办。']);assert.deepEqual(v,before);
  const anomaly=timelineEntry({id:'a',day:1,actor:'system',kind:'anomaly',summary:'供电发生额外损耗：PWR −4，设备状态恶化。起因尚未确认。',data:{asset:'power',amount:4,damage:true}},v);assert.deepEqual(anomaly.delta,{power:-4});assert.deepEqual(anomaly.lines,['设备状态恶化。','起因尚未确认。']);
});

test('route comparisons show requirements against the selected group, not total available crew or cards',()=>{
  const v=view(),slot=v.slots.find(s=>s.eventKind==='cold_storage'),r=slot.routes.find(r=>r.id==='take');
  assert(routeNeeds(v,[],slot.id,r).some(x=>x.includes('1 人')));
  const plan=[{actor:'medic',slot:slot.id,verb:r.verb,card:null,attend:false,route:r.id}];
  assert.deepEqual(routeNeeds(v,plan,slot.id,r),[]);assert.deepEqual(routeIssues(v,plan),[]);
  assert(!routeSummary(slot.routes.filter(r=>r.rewardComponent==='none')).includes('组件'));
  assert.equal(routeSummary(slot.routes),'2 种处理办法');
});

test('submission review counts each route once and distinguishes deadline risks from guaranteed costs',()=>{
  const v=view(),s=v.slots.find(s=>s.eventKind==='cold_storage'),r=s.routes.find(r=>r.id==='rescue');
  r.suppliesCost=8;v.state.resources.supplies=10;s.deadline=v.state.day;
  const other={...s,id:'second',title:'第二事件',routes:[{...r,id:'other'}]};v.slots.push(other);
  const plan=[{actor:'medic',slot:s.id,route:r.id},{actor:'security',slot:s.id,route:r.id},{actor:'clerk',slot:other.id,route:'other'}];
  const review=planReview(v,plan).flat().join('\n');
  assert(review.includes('合计 16 SUP'));assert(review.includes('依赖当日收入'));assert(review.includes('已安排，仍须完成'));
  assert(review.includes('未计隐藏损耗'));assert(!review.includes('合计 24 SUP'));
  assert(planReview(v,[]).flat().join('\n').includes('未安排；未完成将损失'));
});
