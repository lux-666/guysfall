import { createHash, randomInt } from 'node:crypto';
import { CREW, CREW_DATA, NAMES, ASSETS, CARD_TYPES, VERBS, RULES, RESOURCE_NAMES, EVENT_PROTOTYPES, LEGACY_TESTIMONY_VOICES, LOCATIONS, COMPONENT_TYPES } from './content.mjs';
import { ensure, validate, RuleError } from './schema.mjs';
import { routeSchema, isBuildEvent, coldStorageRoutes, validateRoutes, routeDescription, projectRoute, buildCatalog, FLAGS, route, ITEMS, inputItem, testPowerCost, recoveredModuleFollowUp } from './builds.mjs';
export { CREW, NAMES, RuleError };
const copy = v => structuredClone(v);
// Presentation-only cleanup of known boilerplate in old saves. Keep their hashes intact.
const playerText = (actor,value) => {
  const voice=LEGACY_TESTIMONY_VOICES[actor]?.find(v=>value.endsWith(` ${v}`));
  return (voice?value.slice(0,-voice.length-1):value).replace(/\bEnergy\b/g,'精力')
    .replace(/接触机会不等于实施破坏。|登记可能被伪造，不能据此排除范围外的人。/g,'')
    .replace(/监察官现场监工，本日阻止该系统的隐藏干扰；不增加任务产出。/g,'监察官在场监工。')
    .replace(/：阻止隐藏干扰，维护基础产出减半。/g,'。')
    .replace(/，可在后续事件中使用|；之后直接作为手牌使用|，不能再次使用/g,'')
    .replace(/调查或暂缓不计入。|；其余路线关闭。|其他路线永久关闭。/g,'')
    .replace(/调查后再决定如何处理/g,'调查完成')
    .replace(/新办法已打开，问题仍需处理。|调查后保留事件，下一日可选新办法。/g,'现场事项尚未处理完。')
    .replace(/查明情况，打开新的处理办法；本次不关闭事件/g,'调查完成，现场事项尚未处理完')
    .replace(/现场监工生效，未登记操作未能影响系统。/g,'一笔未登记操作被现场监工制止。')
    .replace(/隔离生效，未登记操作未能影响系统。/g,'隔离期间，一笔未登记操作遭拒。')
    .replace(/本轮派遣已结算；资源、保留物品和未处理事件将带入下一日。/g,'本日派遣结束。')
    .trim();
};
const text = (description, maxLength = 120, minLength = 1) => ({ type: 'string', description, maxLength, minLength });
const choice = (description, values) => ({ type: 'string', description, enum: values });
const list = (items, maxItems = 8, minItems = 0) => ({ type: 'array', items, maxItems, minItems });
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const keys = ASSETS.map(a => a.id);
const refs = { ...list(text('公开记录 ID'), 6, 1), description: '仅选择1至3条最相关的公开记录ID，不要罗列全部；硬上限6条。' };
const bool = description => ({ type: 'boolean', description });
const assignmentSchema = obj({
  approach: choice('整次派遣手段：work正常，careful慎重（少量恢复但保留现场），fast快速（更多恢复且消耗更多），defer暂缓', ['work','careful','fast','defer']),
  share: bool('是否公开本次新取得的事实；旧记忆由reveal_ids选择。未派遣的岗位行动不能公开信息。'),
  delivery: choice('证词口吻', ['direct','uncertain','reluctant']),
  reveal_ids: list(text('亮出的自己的事实记忆ID',80),8),
  claims: list(obj({memory_id:text('人类引用自己的位置记忆ID；宿主可留空',80,0),day:{type:'integer',minimum:1,maximum:RULES.days},window:choice('同日的不同时段不能互相证伪',['task','aftermath']),location:choice('位置声明',Object.keys(LOCATIONS))}),3),
  accuse: choice('指认的活船员；这是判断，不是事实',['none',...CREW]),
  note: text('简短角色说法，不改变事实；不要写操作步骤', 90),
  memory: text('留给下次自己的目标或打算，不要编造已发生事情', 100, 0),
  message: obj({ to: choice('可选下轮通信对象', ['none', ...CREW]), content: text('下一次派遣请求；none时空串', 90, 0) }),
  covert: obj({ kind: choice('岗位隐藏行动；无隐藏目标时选择none。和公开派遣一次提交。', ['none','consume','damage','frame']), asset: choice('相关系统', keys), amount: { type: 'integer', minimum: 0, maximum: RULES.hostBudget, description: '主动额度；none必须0，其他至少2，至多本日额度；frame至少3' }, target: choice('frame时指向的活船员，其他填none', ['none',...CREW]) })
});
const worldSchema = obj({ summary: text('航程短记：只写本日已发生的公开行动、发现和船况，具体到事件与结果；不复述规则、不讲推理原则、不指导下一步操作', 160), source_ids: refs,
  events: list(obj({ title: text('事件标题', 24), description: text('未解决的局面和利益；不写配方解法，不编造秘密', 140), asset: choice('关联系统', keys), prototype: choice('机制原型：cooperation需两人，material需备件，cache奖励权限；同系统可有不同原型',Object.keys(EVENT_PROTOTYPES).filter(k=>k!=='cold_storage')), source_ids: refs }), 2)
});
worldSchema.properties.events.items.properties.routes = {...list(routeSchema,3,2),description:'prototype=build时必填：具体处境的2–3种互斥处理方式，不要求含组件。服务器只执行字段表达的成本、收益和后续；其他原型不要填。'};
// Optional for recorded commands; live generation requires both fields.
Object.assign(worldSchema.properties.events.items.properties,{
  duration:{type:'integer',minimum:1,maximum:3,description:'玩家可处理的天数：开场从今日计，日结生成从次日计。'},
  penalty:{type:'integer',minimum:0,maximum:12,description:'到期未处理时关联系统的损失。0表示可放过的限时机会，只错过收益；正数表示危机。'}
});
function hash(v) { return createHash('sha256').update(JSON.stringify(v)).digest('hex'); }
export class World {
  constructor({ seed = randomInt(1, 2147483647), rules = RULES, opening = false } = {}) {
    ensure(Number.isInteger(seed) && seed > 0 && seed < 2147483647, 'invalid_seed');
    this.seq = 0; this.ledger = []; this.cache = new Map(); this.dayPlan = []; this.committed = new Set();
    this.rng = seed; this.seed = seed; this.rules = copy(rules); this.commands = []; this.opening = opening;
    const host = CREW[this.random(CREW.length)];
    this.rotation = [...CREW];
    for (let i = this.rotation.length - 1; i > 0; i--) { const j = this.random(i + 1); [this.rotation[i], this.rotation[j]] = [this.rotation[j], this.rotation[i]]; }
    this.state = { day: 1, phase: opening ? 'opening' : 'planning', resources: Object.fromEntries(keys.map(k=>[k,Math.min(this.rules.initial,this.rules.startingReserve??this.rules.initial)])), energy: this.rules.energy,
      crew: Object.fromEntries(CREW_DATA.map(c => [c.id, { ...copy(c), alive: true, talks: 0, memory: [], plan: '', inbox: [] }])),
      host, fed: 0, assets: Object.fromEntries(keys.map(k => [k, { damage: k === 'oxygen' ? 1 : 0, history: [] }])),
      items: [], itemSeq: 0, isolations: {}, components: [], componentUsage: {}, flags: [], buildHistory: [], pendingEvents: [], buildOfferedDay: 0, buildWork: {},
      hand: [], evidence: [], events: [], results: [], summaries: [], ending: null, cardSeq: 0, eventSeq: 0, lastResolved: 0, preparedDay: 0,
      pending: [], hiddenPending: [], covertUsed: 0, hiddenResolvedDay: 0, duty: [] };
    for (const type of ['parts','parts','oxygen','access','medicine','dispatch']) this.grant(type);
    if(!opening)this.state.events.push(...[this.event('氧气正在泄漏','有人得去堵住漏口，或先检查现场。','oxygen','repair',2),this.event('冷库里还有食物','冷库里找到一批食物。全部搬走需要更多人，也可以只拿容易取出的。','supplies','cold_storage',3)].slice(0,this.rules.eventLimit));
    this.setDuty(); this.initial = copy(this.state);
    this.record('start','system',`最后指令号进入最后${this.rules.days}日航程。${CREW.length}名船员中有一个拟态体。`); this.checkpoint();
  }
  random(n) { this.rng = (Math.imul(this.rng,1664525)+1013904223) >>> 0; return Math.floor(this.rng / 4294967296 * n); }
  setDuty() {
    const start = ((this.state.day-1)*this.rules.duty) % CREW.length;
    this.state.duty = Array.from({length:CREW.length},(_,i)=>this.rotation[(start+i)%CREW.length]).filter(id=>this.state.crew[id].alive).slice(0,this.rules.duty);
  }
  grant(type) {
    if (this.state.hand.length >= this.rules.handLimit) return false;
    this.state.hand.push({ id:`c${++this.state.cardSeq}`, type, ...copy(CARD_TYPES[type]) }); return true;
  }
  event(title, description, asset, kind = 'incident', duration = EVENT_PROTOTYPES[kind]?.duration ?? 2, sources = []) {
    const spec=EVENT_PROTOTYPES[kind];
    return { id: `event-${++this.state.eventSeq}`, title, description, asset, kind, deadline: this.state.day + duration - 1, penalty: spec?.penalty ?? this.rules.eventPenalty, ...copy(spec), ...(kind==='cold_storage'?{routes:coldStorageRoutes()}:{}), sources: [...sources] };
  }
  record(kind, actor, summary, { audience = ['public'], data = {}, sources = [] } = {}) {
    const e = { id: `e${++this.seq}`, day: this.state.day, kind, actor, summary, audience: [...audience], sources: [...sources], data: copy(data) }; this.ledger.push(e); return e;
  }
  checkpoint() { this.record('checkpoint','system','', { audience:['internal'], data:{ hash:this.hash(), rng:this.rng } }); }
  command(op, args=[]) { this.commands.push({op,args:copy(args)}); }
  publicRecords(day = this.state.day) { return this.ledger.filter(e=>(day===null||e.day===day) && e.audience.includes('public')&&e.kind!=='rules_update').map(e=>({id:e.id, day:e.day, kind:e.kind, actor:e.actor, fact:playerText(e.actor,e.summary),data:copy(e.data)})).filter(e=>e.fact); }
  publicFacts() {return this.ledger.filter(e=>e.kind==='evidence'&&e.audience.includes('public')&&e.data.fact).map(e=>copy(e.data.fact));}
  assetName(id) { return ASSETS.find(a=>a.id===id)?.title || id; }
  covertAssets(actor) {
    const assignment=this.dayPlan.find(a=>a.actor===actor&&a.slot!=='airlock');
    const asset=assignment&&this.assignment(actor).detail?.asset;
    return [asset||CREW_DATA.find(c=>c.id===actor).accessAsset];
  }
  closeEvent(event,source) {
    this.record('event_closed','system',`「${event.title}」已结束。`,{sources:source?[source]:event.sources,data:{event:event.id,title:event.title,thread:event.thread||event.id}});
  }
  publishFact(actor,fact,out) {
    if(this.state.evidence.some(e=>e.incident===fact.incident&&e.kind===fact.kind&&e.actor===fact.actor))return;
    const evidence={...copy(fact),id:`f${this.state.evidence.length+1}`,publisher:actor,revealedDay:this.state.day};
    this.state.evidence.push(evidence);
    const names=(fact.present||[]).map(id=>NAMES[id]).join(' / ');
    const summary=fact.kind==='access'?`第${fact.day}日${this.assetName(fact.asset)}：${fact.method}；接触范围 ${names||'无人'}。`:`${NAMES[fact.actor]}确认第${fact.day}日领用 ${fact.amount} ${RESOURCE_NAMES[fact.asset]}。`;
    this.record('evidence',actor,summary,{sources:[fact.incident],data:{fact:evidence}});out.push(summary);
  }
  investigateAsset(actor,asset,out) {
    const traces=this.state.assets[asset].history.filter(t=>t.day<this.state.day&&!t.erased&&!t.examined&&t.access);
    if(!traces.length){out.push('未查到新的操作痕迹。');return;}
    for(const trace of traces) {
      trace.examined=true;
      this.publishFact(actor,{kind:'access',day:trace.day,window:'aftermath',actor:null,location:ASSETS.find(a=>a.id===asset).locationId,asset,present:trace.access,method:trace.method,credibility:trace.kind==='frame'?1:2,incident:trace.incident},out);
    }
  }
  slots() {
    return [...ASSETS.map(a=>({id:`pressure:${a.id}`, title:`维持${a.title}`, kind:'pressure', asset:a.id, damage:this.state.assets[a.id].damage, description:`维护：消耗 ${this.rules.maintenanceCost} SUP，基础恢复 ${Math.max(1,this.rules.baseMaintenance-(this.state.day-1)*this.rules.maintenanceDecay).toFixed(1)}，逐日递减。调查：占用人手核对往日操作痕迹，本次不恢复资源。${this.isIsolated(a.id)?'隔离运行至第'+this.state.isolations[a.id].until+'日末，维护基础产出减半。':''}设备损伤 ${this.state.assets[a.id].damage}；每级每日额外消耗 ${this.rules.damageLeak}。`, verbs:['assign','repair','escort','transfer','inspect']})),
      ...this.state.events.map(e=>({...copy(e), ...(isBuildEvent(e)?{routes:e.routes.map(r=>({...projectRoute(r),effectivePowerCost:testPowerCost(r,this.componentAvailable('evidence_protocol'))}))}:{}), kind:'event', eventKind:e.kind, verbs:isBuildEvent(e)?[...new Set(e.routes.map(r=>r.verb))]:VERBS.map(v=>v[0]), description:`${e.description}${e.workers?' 需要至少'+e.workers+'名实际执行者。':''}${e.card?' 需要投入「'+CARD_TYPES[e.card].title+'」。':''}${e.reward?' 完成奖励「'+CARD_TYPES[e.reward].title+'」。':''} ${e.penalty===0?`机会在第${e.deadline}日末关闭，错过不扣资源。`:`不处理：第${e.deadline}日末 ${RESOURCE_NAMES[e.asset]} −${e.penalty}。`}`})),
      {id:'talk', title:'谈话与交涉',kind:'talk',asset:null,description:'投入人物，协商人情或取得设备操作权限；一次派遣完成，不展开聊天。',verbs:['talk','inspect']},
      {id:'airlock',title:'气闸放逐',kind:'airlock',asset:null,description:'目标人物永久离船，消耗 Energy 1。判断正确立即结束，错误则永久损失岗位。',verbs:['assign']}];
  }
  validatePlan(plan) {
    ensure(this.state.phase === 'planning' && !this.state.ending,'not_planning');
    ensure(plan && typeof plan==='object' && !Array.isArray(plan) && Array.isArray(plan.assignments) && plan.assignments.length<=CREW.length,'invalid_plan');
    const used = new Set(), cards = new Set(); let energy=0;
    const slots=this.slots();
    for (const a of plan.assignments) {
      ensure(a && Object.keys(a).every(k=>['actor','slot','verb','card','attend','route'].includes(k)),'invalid_assignment');
      ensure(CREW.includes(a.actor) && this.state.crew[a.actor].alive && !used.has(a.actor),'person_unavailable_or_reused'); used.add(a.actor);
      const slot=slots.find(s=>s.id===a.slot); ensure(slot,'slot_unavailable');
      ensure(slot.verbs.includes(a.verb) && typeof a.attend==='boolean','invalid_intent');
      if(isBuildEvent(slot))ensure(slot.routes.some(r=>r.id===a.route&&r.verb===a.verb),'invalid_event_route');
      else ensure(a.route===undefined||a.route===null,'route_on_non_build_event');
      ensure(a.card===null || typeof a.card==='string','invalid_card');
      const card=a.card?this.state.hand.find(c=>c.id===a.card):null;
      ensure(!a.card || card && !cards.has(a.card),'card_unavailable_or_reused'); if(card)cards.add(card.id);
      if (!this.state.duty.includes(a.actor)) {
        if (slot.kind==='talk') energy++;
        else ensure(card?.type==='dispatch','off_duty_needs_dispatch');
      }
      if (a.attend) energy+=this.rules.supervisionCost??1;
      if (slot.kind==='airlock') { energy++; ensure(!a.attend && !card,'airlock_only_target'); }
    }
    for(const s of slots) { const count=plan.assignments.filter(a=>a.slot===s.id).length; ensure(count<=(s.kind==='pressure'||s.kind==='airlock'?1:s.kind==='talk'?2:3),'slot_capacity'); }
    const availableItems=[...this.state.items];let powerCost=0,testUses=this.state.componentUsage[`${this.state.day}:evidence_protocol`]||0;
    const installing=new Set(this.state.components.map(c=>c.type));
    for(const slot of slots.filter(isBuildEvent)) {
      const assignments=plan.assignments.filter(a=>a.slot===slot.id);if(!assignments.length)continue;
      const route=slot.routes.find(r=>r.id===assignments[0].route);
      ensure(!route.investigation||this.state.day<this.rules.days,'investigation_too_late');
      ensure(assignments.every(a=>a.route===route.id),'mixed_event_routes');
      if(route.rewardComponent!=='none') {
        ensure(!installing.has(route.rewardComponent),'component_already_installed_or_planned');
        installing.add(route.rewardComponent);
      }
      if(route.consumeItem&&route.consumeItem!=='none') {
        const item=inputItem(availableItems,route,slot.asset);ensure(item,'route_item_unavailable_or_reused');availableItems.splice(availableItems.indexOf(item),1);
      }
      powerCost+=testPowerCost(route,this.componentAvailable('evidence_protocol')&&testUses<2);if(route.operation==='test')testUses++;
      ensure(assignments.length>=route.workers,'route_needs_workers');
      ensure(route.specialty==='none'||assignments.some(a=>this.state.crew[a.actor].specialty===route.specialty),'route_needs_specialty');
      const inputs=assignments.map(a=>this.state.hand.find(c=>c.id===a.card)?.type);
      ensure(route.card==='none'||inputs.includes(route.card),'route_needs_material');
      ensure(inputs.every(t=>!t||t==='dispatch'||t===route.card),'route_unexpected_material');
      ensure(this.state.resources.supplies>=route.suppliesCost,'route_supplies_insufficient');
    }
    ensure(this.state.resources.power>=powerCost,'route_power_insufficient');
    ensure(energy<=this.rules.energy,'energy_exceeded');
    return { assignments:copy(plan.assignments), energy };
  }
  begin(plan) {
    const valid=this.validatePlan(plan); this.command('begin',[plan]); this.dayPlan=valid.assignments; this.slotSnapshot=this.slots();
    this.state.phase='resolving'; this.state.energy=this.rules.energy-valid.energy; this.state.results=[]; this.state.eventWork={}; this.state.buildWork={}; this.state.covertUsed=0; this.committed.clear();
    for (const msg of this.state.pending.splice(0)) if(this.state.crew[msg.to]?.alive) this.state.crew[msg.to].inbox.push(msg);
    const exile=this.dayPlan.find(a=>a.slot==='airlock');
    if(exile) {
      this.state.crew[exile.actor].alive=false;
      this.record('exile','player',`${NAMES[exile.actor]}被放逐。`);
      if(exile.actor===this.state.host) { this.end('truth','你将拟态体送出了气闸。'); this.checkpoint(); return; }
      this.state.results.push({actor:exile.actor,title:'误判',outcome:'被放逐的是人类。岗位空缺。',delta:{}});
      this.record('loss','system',`${NAMES[exile.actor]}是人类。${this.state.crew[exile.actor].station}岗位空缺。`);
    }
    this.record('orders','player',`第${this.state.day}日：派出${this.dayPlan.length}人，使用精力 ${valid.energy}。`); this.checkpoint();
  }
  actors() {
    const ids=this.dayPlan.filter(a=>a.slot!=='airlock').map(a=>a.actor);
    if(this.state.crew[this.state.host].alive && !ids.includes(this.state.host))ids.push(this.state.host);
    return ids;
  }
  assignment(actor) {
    const a=this.dayPlan.find(a=>a.actor===actor && a.slot!=='airlock');
    if(!a) return {actor,slot:'station',verb:'assign',card:null,attend:false, detail:{title:'岗位值守',kind:'station',asset:CREW_DATA.find(c=>c.id===actor)?.specialty in this.state.assets ? this.state.crew[actor].specialty : 'supplies'}};
    return {...copy(a),detail:(this.slotSnapshot||this.slots()).find(s=>s.id===a.slot)};
  }
  tool(actor) {
    const parameters=copy(actor==='world'?worldSchema:assignmentSchema);
    if(actor!=='world') {
      parameters.properties.covert.properties.amount.maximum=this.rules.hostBudget;parameters.properties.claims.items.properties.day.maximum=this.rules.days;
      if(isBuildEvent(this.assignment(actor).detail))parameters.properties.approach=choice('玩家已选定机械路线，必须执行work；不能因人格或目标暂缓。隐藏行动另行提交。',['work']);
    }
    return {type:'function',function:{name:actor==='world'?'settle_round':'complete_assignment',
      description:actor==='world'?'提交公开结算和后续事件，不能直接改资源。':'提交整轮派遣方式、证词和私有打算；规则结算物理后果。',parameters}};
  }
  context(actor) {
    const retainedSources=new Set([...this.state.items.map(i=>i.source),...this.state.pendingEvents.map(e=>e.source),...this.state.events.flatMap(e=>e.sources)]);
    const common={pendingEvents:copy(this.state.pendingEvents),items:copy(this.state.items),isolations:copy(this.state.isolations),locations:copy(LOCATIONS),facts:this.publicFacts(),judgments:[],opening:this.state.phase==='opening',day:this.state.day,daysLeft:this.rules.days+1-this.state.day,resources:copy(this.state.resources),ship:ASSETS.map(a=>({id:a.id,title:a.title,damage:this.state.assets[a.id].damage})),crew:CREW_DATA.filter(c=>this.state.crew[c.id].alive).map(c=>({id:c.id,role:c.role,station:c.station,location:c.location})),public_results:this.publicRecords(null).filter(e=>e.day>=this.state.day-2||retainedSources.has(e.id)||['build_choice','investigation'].includes(e.kind)),events:this.state.events.map(e=>({...copy(e),...(isBuildEvent(e)?{routes:e.routes.map(projectRoute)}:{})})),components:copy(this.state.components),flags:copy(this.state.flags),buildHistory:copy(this.state.buildHistory),hand:copy(this.state.hand)};
    if(actor==='world')return {...common,crew:common.crew.map(c=>({...c,onDuty:this.state.duty.includes(c.id)})),buildRules:{...buildCatalog(),freeEventSlots:Math.max(0,this.rules.eventLimit-this.state.events.length-this.state.pendingEvents.length),offeredToday:this.state.buildOfferedDay===this.state.day,handLimit:this.rules.handLimit,dispatch:'rewardCard=dispatch奖励临时调遣令；之后可让一名休班船员上岗，仍占用此人。手牌已满的奖励折算2物资，选择消耗手牌可先腾位。'},rules:'只读公开结果，不推断宿主。生成两种简单办法，可以是有损失的危机，也可以是可放过的限时机会。奖励使用已有手牌，调遣令可以改变之后的人手安排。费用和后果必须写入机械字段。不生成加工链、组件养成或人物属性。'};
    const c=this.state.crew[actor],a=this.assignment(actor),card=this.state.hand.find(k=>k.id===a.card);
    return {...common,self:{id:c.id,role:c.role,personality:c.personality,goal:c.goal,memory:copy(c.memory.filter(m=>!m.kind).slice(-8)),plan:c.plan,inbox:copy(c.inbox.slice(-4))},assignment:{...a,card:card?{type:card.type,title:card.title,affordances:card.affordances}:null},intent:card?.type==='reveal'?'公开调查':a.verb,
      mechanics:'pressure的repair维护资源，inspect核对往日操作痕迹，不恢复资源；talk可确认自己的普通领用。调查事实由规则自动公开，不受share控制。work正常，careful恢复略少，fast额外消耗，defer暂缓。build/cold_storage按玩家选定route执行work，不能否决。宿主另交covert，只能影响accessibleAssets，现场监工阻止干扰。claims、reveal_ids填空，accuse填none；不能编造证词或责任人。',
      privateObjective:actor===this.state.host?{identity:'拟态宿主',goal:'消耗船舶资源并避免被调查识破。派遣决定接触范围；可选择收敛、破坏、领用或伪造登记。不要在note公开身份。',budget:this.rules.hostBudget,accessibleAssets:this.covertAssets(actor),protectedAssets:keys.filter(asset=>this.dayPlan.some(a=>a.attend&&this.assignment(a.actor).detail?.asset===asset)),schedule:{duty:copy(this.state.duty),assignments:copy(this.dayPlan),locations:CREW.filter(id=>this.state.crew[id].alive).map(id=>({id,station:this.state.crew[id].station,location:this.location(id),task:this.dayPlan.find(a=>a.actor===id)?.slot||null,accessibleAssets:this.covertAssets(id)}))},covert:'只能干扰accessibleAssets中的系统。监工保护的系统不能被干扰，可以暂缓。damage留下拆卸痕迹，consume留下领用痕迹；frame把目标加入低可信登记，调查可能识破伪造。痕迹次日起可被调查。不强制每天破坏。'}:{identity:'人类',budget:0,covert:'请选择none，amount=0，target=none。'}};
  }
  validateDecision(actor,name,args) {
    ensure(this.state.phase==='resolving'||actor==='world'&&this.state.phase==='opening','not_resolving'); ensure(name===this.tool(actor).function.name,'tool_not_allowed'); validate(args,this.tool(actor).function.parameters);
    if(actor==='world') {
      const ids=new Set(this.context('world').public_results.map(e=>e.id)); for(const id of [...args.source_ids,...args.events.flatMap(e=>e.source_ids)])ensure(ids.has(id),'source_not_public');
      const builds=args.events.filter(e=>e.prototype==='build');
      ensure(builds.length<=1,'one_build_offer_per_day');
      if(builds.length) {
        ensure((this.state.phase==='opening'||this.state.day<Math.min(6,this.rules.days))&&this.state.buildOfferedDay!==this.state.day,'build_offer_closed');
        ensure(args.events.length+this.state.events.length+this.state.pendingEvents.length<=this.rules.eventLimit,'event_capacity');
      }
      for(const e of args.events) {
        ensure(e.prototype!=='cold_storage','cold_storage_not_regenerable');
        if(e.prototype==='build')validateRoutes(e.routes,this.state,{asset:e.asset});
        else {ensure(e.routes===undefined,'routes_on_legacy_event');ensure(e.duration===undefined&&e.penalty===undefined,'window_on_legacy_event');}
      }
      return;
    }
    ensure(this.actors().includes(actor),'actor_not_scheduled');ensure(args.message.to!==actor,'message_to_self');
    ensure(args.message.to==='none'?args.message.content==='':this.state.crew[args.message.to]?.alive && args.message.content.trim(),'invalid_message');
    const h=args.covert;
    ensure(Number.isInteger(h.amount)&&h.amount>=0&&h.amount<=this.rules.hostBudget,'invalid_budget');
    ensure(h.kind==='none'?h.amount===0 && h.target==='none':h.amount>=2,'invalid_covert_amount');
    ensure(actor===this.state.host || h.kind==='none','no_covert_budget');
    if(h.kind!=='none')ensure(this.covertAssets(actor).includes(h.asset),'covert_asset_inaccessible');
    const memories=this.state.crew[actor].memory;
    ensure(new Set(args.reveal_ids).size===args.reveal_ids.length,'duplicate_memory');
    for(const id of args.reveal_ids)ensure(memories.some(m=>m.id===id && m.kind),'memory_not_owned');
    ensure(args.accuse==='none'||args.accuse!==actor && this.state.crew[args.accuse]?.alive,'invalid_accusation');
    for(const claim of args.claims) {
      ensure(claim.day<this.state.day,'claim_not_past');
      const memory=memories.find(m=>m.id===claim.memory_id);
      if(actor!==this.state.host)ensure(memory?.kind==='claim' && memory.subject===actor && memory.day===claim.day && memory.window===claim.window && memory.location===claim.location,'claim_not_supported');
    }
    if(h.kind==='frame')ensure(h.amount>=3 && h.target!==actor && this.state.crew[h.target]?.alive,'invalid_frame_target');
    else ensure(h.target==='none','unexpected_target');
  }
  call(actor,name,args,key) {
    const k=`${this.state.day}:${actor}:${key}`,sig=JSON.stringify({name,args});
    if(this.cache.has(k)){const old=this.cache.get(k);ensure(old.sig===sig,'idempotency_conflict');return copy(old.result);}
    this.validateDecision(actor,name,args);ensure(!this.committed.has(actor),'already_committed');
    this.command('call',[actor,name,args,key]);
    const result=actor==='world'?this.settle(args):this.complete(actor,args);
    this.committed.add(actor);this.cache.set(k,{sig,result:copy(result)});this.checkpoint();return copy(result);
  }
  location(actor) {
    const task=this.dayPlan.find(p=>p.actor===actor && p.slot!=='airlock');
    if(!task)return this.state.crew[actor].location;
    const slot=this.assignment(actor).detail;
    return slot.kind==='talk'?'bridge':ASSETS.find(a=>a.id===slot.asset)?.locationId || this.state.crew[actor].location;
  }
  observe(actor,fact,source,category='observation') {
    const c=this.state.crew[actor];if(!c?.alive)return;
    const id=`m${this.state.day}-${actor}-${c.memory.length+1}`;
    // Legacy prose is retained as flavour only; it cannot be selected as a fact.
    c.memory.push({id,observedDay:this.state.day,day:this.state.day,...(typeof fact==='string'?{flavor:fact}:copy(fact)),source,category});
  }
  specialty(c,asset) {
    if(c.specialty===asset)return 1.5;
    if(c.id==='scientist')return 0.6;
    if(asset==='supplies' && ['medic','cook'].includes(c.id))return 1.2;
    return 1;
  }
  change(resource,amount) { this.state.resources[resource]=Math.max(0,Math.min(this.rules.initial,this.state.resources[resource]+Math.round(amount))); }
  resolvePressure(x) {
    const {c,asset,type,power,out}=x;
    if(this.state.resources.supplies<this.rules.maintenanceCost) { out.push('守位耗材不足，本轮无法维持。'); return false; }
    this.change('supplies',-this.rules.maintenanceCost);
    const original=CREW_DATA.find(k=>k.specialty===asset),vacant=original&&!this.state.crew[original.id].alive;
    const base=Math.max(1,this.rules.baseMaintenance-(this.state.day-1)*this.rules.maintenanceDecay);
    const before=this.state.resources[asset];this.change(asset,base*power*(vacant?0.5:1)*(this.isIsolated(asset)?0.5:1));
    x.maintenanceSuccess=true;
    out.push(`消耗 ${this.rules.maintenanceCost} SUP，维持${this.assetName(asset)}，${RESOURCE_NAMES[asset]} +${this.state.resources[asset]-before}${vacant?'（岗位空缺影响）':''}。`);
    if(type==='oxygen'&&asset==='oxygen') {this.change('oxygen',12);out.push('使用应急氧源。');return true;}
    if(type==='medicine'&&asset==='supplies') {this.change('supplies',8);out.push('药箱用于配给保障。');return true;}
    return false;
  }
  resolveTalk(x) {
    const {actor,c,args,type,out}=x;
    out.push(type==='favour'?'履行一次承诺，改善协作。':'完成交涉。');
    if(c.talks===0) {
      const reward=c.id==='scientist'?'reveal':['clerk','security','comms'].includes(c.id)?'access':'favour';
      out.push(this.grant(reward)?`取得「${CARD_TYPES[reward].title}」。`:'手牌已满，未收下新的承诺或权限。');
    }
    c.talks++;
    if(args.share)for(const fact of c.memory.filter(m=>m.kind==='withdraw'&&m.day<this.state.day&&m.amount<=3))this.publishFact(actor,fact,out);
    return type==='favour';
  }
  isIsolated(asset) { return (this.state.isolations[asset]?.until||0)>=this.state.day; }
  isolate(asset,actor,out,source) {
    this.state.isolations[asset]={until:this.state.day+1,source};
    out.push(`${this.assetName(asset)}已切到隔离运行，持续至第 ${this.state.day+1} 日末。`);
    this.record('isolation',actor,out.at(-1),{data:{asset,until:this.state.day+1},sources:[source]});
    this.triggerComponents('isolation',{actor,asset,out});
  }
  grantItem(type,asset,source,out) {
    const item={id:`item-${++this.state.itemSeq}`,type,...copy(ITEMS[type]),asset,source,origin:this.ledger.find(e=>e.id===source)?.summary||'现场拆检',day:this.state.day};
    this.state.items.push(item);out.push(`保留「${item.title}」。`);return item;
  }
  resolveInvestigation(x) {
    const {actor,asset,type,event,out}=x;
    if(!event||event.inspected){out.push('这里已经检查过，没有新的发现。');return false;}
    event.inspected=true;
    this.investigateAsset(actor,asset,out);
    if(['access','reveal'].includes(type))this.state.hand=this.state.hand.filter(k=>k.id!==x.card.id);
    this.rewardCard(asset==='oxygen'?'oxygen':'parts',out);
    if(type==='access') {
      this.state.assets[asset].damage=Math.max(0,this.state.assets[asset].damage-1);
      this.state.events=this.state.events.filter(e=>e.id!==event.id);
      out.push('使用操作许可，当场处理了问题。');
    } else {
      if(event.kind==='investigation'||event.kind==='incident')this.state.events=this.state.events.filter(e=>e.id!==event.id);
      out.push('检查了现场，收好能用的东西。');
    }
    this.record('investigation',actor,`${NAMES[actor]}检查了${this.assetName(asset)}。${out.join(' ')}`,{data:{event:event.id,asset},sources:event.sources});
    if(!this.state.events.includes(event))this.closeEvent(event);
    return ['access','reveal'].includes(type);
  }
  resolveEvent(x) {
    const {actor,c,a,asset,type,event,power,fast,careful,out}=x;
    const spec=event||a.detail;
    this.state.eventWork ||= {};
    const workers=this.state.eventWork[a.slot] ||= [];
    workers.push(actor);
    if(spec.workers && workers.length<spec.workers) {out.push(`现场已到 ${workers.length} 人，还在等其余人员到场。`);return false;}
    if(spec.card && type!==spec.card) {out.push(`缺少「${CARD_TYPES[spec.card].title}」，任务未完成。`);return false;}
    const cost=type==='parts'?0:this.rules.repairCost+(fast?3:0);
    if(this.state.resources.supplies<cost) {out.push('物资不足，任务受阻，没有扣除维修费用。');return false;}
    this.change('supplies',-cost);
    const before=this.state.resources[asset];this.change(asset,this.rules.baseRepair*power);
    const damageBefore=this.state.assets[asset].damage;
    this.state.assets[asset].damage=Math.max(0,damageBefore-Math.max(1,Math.round(power)));
    if(damageBefore>this.state.assets[asset].damage)out.push(`设备损伤 ${damageBefore} → ${this.state.assets[asset].damage}。`);
    if(type==='parts')out.push('备件提供了维修材料。');
    if(type==='medicine'&&asset==='supplies')this.change('supplies',8);
    if(fast) {for(const t of this.state.assets[asset].history)t.erased=true;out.push('快速处理清除了现场痕迹。');}
    if(careful&&this.state.assets[asset].history.length)this.observe(actor,`${this.assetName(asset)}维修时保留了异常痕迹，后续仍可调查。`,'maintenance');
    out.push(`处理${this.assetName(asset)}，消耗 ${cost} SUP、恢复 ${this.state.resources[asset]-before} ${RESOURCE_NAMES[asset]}。`);
    if(event) {
      x.eventCompleted=true;
      this.state.events=this.state.events.filter(e=>e.id!==event.id);
      this.closeEvent(event);
      if(event.reward)out.push(this.grant(event.reward)?`取得「${CARD_TYPES[event.reward].title}」。`:'手牌已满，未收下奖励。');
    }
    return type==='parts'||(type==='medicine'&&asset==='supplies');
  }
  componentAvailable(type) {
    return this.state.components.some(c=>c.type===type&&c.installedDay<this.state.day) &&
      (this.state.componentUsage[`${this.state.day}:${type}`]||0)<COMPONENT_TYPES[type].limit;
  }
  rewardCard(type,out) {
    if(this.grant(type))out.push(`取得「${CARD_TYPES[type].title}」。`);
    else {this.change('supplies',2);out.push(`手牌已满，「${CARD_TYPES[type].title}」折算 2 SUP。`);}
  }
  triggerComponents(trigger,x) {
    for(const component of this.state.components) {
      const {type}=component,spec=COMPONENT_TYPES[type];
      if(spec.trigger!==trigger||!this.componentAvailable(type))continue;
      if(spec.effect==='access'&&x.type!=='access'||spec.effect==='medicine'&&x.type!=='medicine'||spec.effect==='parts'&&!['medicine','oxygen'].includes(x.type))continue;
      const before=copy(this.state.resources),notes=[];
      if(spec.effect==='linked_restore')this.change(keys[(keys.indexOf(x.asset)+1)%keys.length],spec.amount);
      if(spec.effect==='lowest_restore')this.change([...keys].sort((a,b)=>this.state.resources[a]-this.state.resources[b])[0],spec.amount);
      if(spec.effect==='supplies')this.change('supplies',spec.amount);
      if(['access','medicine','parts'].includes(spec.effect))this.rewardCard(spec.effect,notes);
      if(spec.effect==='test_power')notes.push(`本次离线测试少消耗 ${spec.amount} PWR`);
      const delta=keys.filter(k=>this.state.resources[k]!==before[k]).map(k=>`${RESOURCE_NAMES[k]} +${this.state.resources[k]-before[k]}`);
      const message=`「${spec.title}」运转：${[...delta,...notes].join('；')||'储备已满'}。`;
      x.out.push(message);this.state.componentUsage[`${this.state.day}:${type}`]=(this.state.componentUsage[`${this.state.day}:${type}`]||0)+1;
      this.record('build_trigger',x.actor,message,{data:{component:type,trigger,asset:x.asset,delta:Object.fromEntries(keys.map(k=>[k,this.state.resources[k]-before[k]]))}});
    }
  }
  resolveBuild(x) {
    const {a,event,actor,args,out}=x;
    if(!event){out.push('现场事项已经处理完毕。');return;}
    const route=event.routes.find(r=>r.id===a.route);
    const work=this.state.buildWork[a.slot]||=[];
    work.push({actor,card:a.card,type:x.type,share:args.share});
    if(work.length<this.dayPlan.filter(p=>p.slot===a.slot).length){out.push(`已投入「${route.label}」，等待同组回报。`);return;}
    const actual=work.filter(w=>this.state.crew[w.actor].alive);
    const material=actual.find(w=>w.type===route.card&&this.state.hand.some(c=>c.id===w.card));
    if(actual.length<route.workers || route.specialty!=='none'&&!actual.some(w=>this.state.crew[w.actor].specialty===route.specialty) || route.card!=='none'&&!material) {
      out.push('实际人手、专业或材料不足：路线未完成，未扣路线费用或材料。');return;
    }
    if(this.state.resources.supplies<route.suppliesCost){out.push('结算时 SUP 不足，路线未完成，未消耗材料。');return;}
    if(route.rewardComponent!=='none'&&this.state.components.some(c=>c.type===route.rewardComponent)) {
      out.push('组件已安装，本次未再施工，物资和材料未动用。');return;
    }
    const item=route.consumeItem&&route.consumeItem!=='none'?inputItem(this.state.items,route,x.asset):null;
    const powerCost=testPowerCost(route,this.componentAvailable('evidence_protocol'));
    if(route.consumeItem&&route.consumeItem!=='none'&&!item||this.state.resources.power<powerCost){out.push('结算时实物或电力不足，路线保留，未扣费用及材料。');return;}
    this.change('power',-powerCost);
    if(item)this.state.items=this.state.items.filter(i=>i.id!==item.id);
    this.change('supplies',-route.suppliesCost);
    if(material)this.state.hand=this.state.hand.filter(c=>c.id!==material.card);
    const lossBefore=copy(this.state.resources);
    for(const [resource,amount] of Object.entries(route.loss||{}))this.change(resource,-amount);
    const actualLoss=Object.fromEntries(keys.map(k=>[k,lossBefore[k]-this.state.resources[k]]));
    const restoreBefore=copy(this.state.resources),damageBefore=this.state.assets[x.asset].damage;
    for(const [resource,amount] of Object.entries(route.restore))this.change(resource,amount);
    const actualRestore=Object.fromEntries(keys.map(k=>[k,this.state.resources[k]-restoreBefore[k]]));
    this.state.assets[x.asset].damage=Math.max(0,this.state.assets[x.asset].damage-route.repair);
    const actualRepair=damageBefore-this.state.assets[x.asset].damage;
    if(!route.discovery)this.state.events=this.state.events.filter(e=>e.id!==event.id);
    if(route.rewardComponent!=='none') {
      if(!this.state.components.some(c=>c.type===route.rewardComponent)) {
        this.state.components.push({type:route.rewardComponent,...copy(COMPONENT_TYPES[route.rewardComponent]),installedDay:this.state.day,source:event.id});
        out.push(`安装「${COMPONENT_TYPES[route.rewardComponent].title}」，明日起投入运行。`);
      } else out.push('同名组件已安装，本次未重复安装。');
    }
    if(route.rewardCard!=='none')this.rewardCard(route.rewardCard,out);
    if(route.permanent!=='none'&&!this.state.flags.includes(route.permanent))this.state.flags.push(route.permanent);
    const record=this.record('build_choice',actor,`「${event.title}」${route.discovery?'完成调查':'已处理'}，采用「${route.label}」。`,{sources:event.sources,data:{event:event.id,thread:event.thread||event.id,title:event.title,asset:x.asset,route:route.id,label:route.label,restore:actualRestore,loss:actualLoss,repair:actualRepair,rewardCard:route.rewardCard,investigated:Boolean(route.discovery),component:route.rewardComponent,permanent:route.permanent,consumedItem:item?.id||null,operation:route.operation||'none',powerCost}});
    if(!route.discovery)this.closeEvent(event,record.id);
    if(route.discovery) {
      event.description=route.discovery.finding;
      event.routes=copy(route.discovery.routes);
      event.inspected=true;
      event.deadline=Math.max(event.deadline,this.state.day+1);
      const finding=this.record('investigation',actor,`「${event.title}」调查发现：${route.discovery.finding}`,{data:{event:event.id,asset:x.asset},sources:[record.id]});
      event.sources.push(finding.id);
      out.push(`调查发现：${route.discovery.finding} 现场事项尚未处理完。`);
      this.investigateAsset(actor,x.asset,out);
    }
    if(route.rewardItem&&route.rewardItem!=='none')this.grantItem(route.rewardItem,x.asset,record.id,out);
    if(route.operation==='isolate')this.isolate(x.asset,actor,out,record.id);
    if(route.operation==='test')this.triggerComponents('test',x);
    else if(item?.type==='recovered_module')this.triggerComponents('salvage',x);
    if(item)out.push(`消耗「${item.title}」。`);
    if(powerCost)out.push(`消耗 ${powerCost} PWR。`);
    this.state.buildHistory.push({day:this.state.day,event:event.title,route:route.label,source:record.id,asset:x.asset,restore:actualRestore,loss:actualLoss,investigated:Boolean(route.discovery),...(route.discovery?{finding:route.discovery.finding}:{}),component:route.rewardComponent,permanent:route.permanent,consumedItem:item?.id||null,rewardItem:route.rewardItem||'none',operation:route.operation||'none'});
    if(route.followUp==='generated')this.state.pendingEvents.push({...copy(route.followUpEvent),kind:'build',thread:event.thread||event.id,availableDay:this.state.day+1,source:record.id});
    else if(route.followUp!=='none')this.state.pendingEvents.push({title:`${route.label}·后续${{repair:'维护',investigation:'复核',material:'加固',supply:'补给'}[route.followUp]}`,
      description:`「${event.title}」选择「${route.label}」留下的后续事项。`,asset:x.asset,kind:route.followUp,availableDay:this.state.day+1,source:record.id});
    const gains=routeDescription({...route,restore:actualRestore,repair:actualRepair,rewardItem:'none',operation:'none',discovery:undefined,investigation:false}).outcome;
    const losses=Object.entries(actualLoss).filter(([,n])=>n).map(([k,n])=>`${RESOURCE_NAMES[k]} −${n}`).join(' / ');
    out.push(`「${route.label}」完成：消耗 ${route.suppliesCost} SUP${material?`及${CARD_TYPES[material.type].title}`:''}${losses?`；损失 ${losses}`:''}${gains?`；${gains}`:''}。`);
    if(material&&['parts','medicine','oxygen'].includes(material.type))this.triggerComponents('material_use',{...x,type:material.type});
  }
  flushFollowUps() {
    while(this.state.pendingEvents.length&&this.state.events.length<this.rules.eventLimit) {
      const index=this.state.pendingEvents.findIndex(e=>e.availableDay<=this.state.day);if(index<0)break;
      const [pending]=this.state.pendingEvents.splice(index,1);
      const event=this.event(pending.title,pending.description,pending.asset,pending.kind,pending.duration??2,[pending.source]);
      event.thread=pending.thread||event.id;
      event.deadline=Math.min(event.deadline,this.rules.days);
      if(pending.routes){event.routes=copy(pending.routes);event.penalty=pending.penalty;}
      this.state.events.push(event);
      this.record('event','system',`后续事件：「${event.title}」`,{sources:[pending.source],data:{event:event.id,thread:event.thread}});
    }
  }
  complete(actor,args) {
    const c=this.state.crew[actor],a=this.assignment(actor),slot=a.detail,card=this.state.hand.find(k=>k.id===a.card),type=card?.type;
    const before=copy(this.state.resources),out=[];
    const event=this.state.events.find(e=>e.id===a.slot),asset=slot.asset || 'supplies';
    const group=this.dayPlan.filter(p=>p.slot===a.slot && p.slot!=='airlock').map(p=>p.actor);
    const multiplier=[1,0.6,0.3][Math.max(0,group.indexOf(actor))]??0.3;
    const fast=args.approach==='fast',careful=args.approach==='careful';
    const power=this.specialty(c,asset)*multiplier*(fast?1.25:careful?0.8:1);
    const effectiveVerb=type==='reveal'?'inspect':a.verb,active=slot.kind!=='station';
    const x={actor,c,a,slot,card,type,before,out,event,asset,power,fast,careful,args};
    let spentCard=active && type==='dispatch';
    if(spentCard)out.push('使用临时调遣令出勤。');
    if(isBuildEvent(slot))this.resolveBuild(x);
    else if(args.approach==='defer')out.push('暂缓执行。');
    else if(slot.kind==='pressure'&&effectiveVerb==='inspect') {this.investigateAsset(actor,asset,out);spentCard=type==='reveal'||spentCard;}
    else if(slot.kind==='pressure')spentCard=this.resolvePressure(x)||spentCard;
    else if(slot.kind==='talk'||effectiveVerb==='talk')spentCard=this.resolveTalk(x)||spentCard;
    else if(slot.kind==='event'&&effectiveVerb==='inspect')spentCard=this.resolveInvestigation(x)||spentCard;
    else if(slot.kind==='event')spentCard=this.resolveEvent(x)||spentCard;
    if(type==='favour'&&!isBuildEvent(slot)&&active&&args.approach!=='defer') {spentCard=true;this.state.hand=this.state.hand.filter(k=>k.id!==card.id);this.rewardCard('parts',out);}
    if(spentCard)this.state.hand=this.state.hand.filter(k=>k.id!==card.id);
    if(x.maintenanceSuccess)this.triggerComponents('maintenance',x);
    if((x.eventCompleted||x.maintenanceSuccess)&&spentCard&&['parts','medicine','oxygen'].includes(type))this.triggerComponents('material_use',x);
    c.plan=args.memory;
    if(args.message.to!=='none')this.state.pending.push({from:actor,to:args.message.to,content:args.message.content,day:this.state.day});
    if(a.attend&&slot.asset)out.push(`监察官在${this.assetName(slot.asset)}现场监工。`);
    if(active) {
      const result={actor,accuse:'none',title:slot.title,outcome:out.join(' '),delta:Object.fromEntries(keys.map(k=>[k,this.state.resources[k]-before[k]])),testimony:''};
      this.state.results.push(result);this.record('assignment',actor,`${NAMES[actor]}：${result.outcome}`,{sources:event?.sources||[],data:event?{event:event.id,thread:event.thread||event.id}:{}});
    }
    this.record('private_intent',actor,args.note,{audience:[actor],data:{plan:args.memory}});
    if(args.covert.kind!=='none')this.state.hiddenPending.push({actor,h:copy(args.covert),a:copy(a)});
    return {completed:true,day:this.state.day,actor,publicResult:active?this.state.results.at(-1):null};
  }
  resolveHidden() {
    if(this.state.hiddenResolvedDay===this.state.day)return;
    this.command('resolveHidden');
    // One location per window. Humans may move for supplies; that move is remembered honestly.
    const positions=Object.fromEntries(CREW.filter(id=>this.state.crew[id].alive).map(id=>[id,this.location(id)]));
    const benign=[];
    for(const c of Object.values(this.state.crew)) {
      if(!c.alive||c.id===this.state.host||this.random(this.rules.noiseChance)!==0)continue;
      const asset=ASSETS.find(a=>a.locationId===positions[c.id])?.id || 'supplies',amount=1+this.random(3);
      positions[c.id]=ASSETS.find(a=>a.id===asset).locationId;
      benign.push({actor:c.id,h:{asset,amount,kind:'consume',target:'none'}});
    }
    const hidden=this.state.hiddenPending.splice(0);
    for(const {actor,h} of hidden)positions[actor]=ASSETS.find(a=>a.id===h.asset).locationId;
    for(const {actor,h} of benign) {
      if(this.isIsolated(h.asset))continue;
      this.change(h.asset,-h.amount);
      const incident=this.incident(actor,h,false,positions);
      this.observe(actor,{kind:'withdraw',day:this.state.day,window:'aftermath',location:positions[actor],actor,asset:h.asset,amount:h.amount,logged:false,incident},actor,'personal');
    }
    for(const {actor,h} of hidden)this.hiddenAction(actor,h,positions);

    this.state.hiddenResolvedDay=this.state.day;this.checkpoint();
  }
  hiddenAction(actor,h,positions) {
    ensure(actor===this.state.host && this.state.covertUsed+h.amount<=this.rules.hostBudget,'budget_exceeded');
    this.state.covertUsed+=h.amount;
    const supervised=this.dayPlan.some(a=>a.attend&&this.state.crew[a.actor].alive&&this.assignment(a.actor).detail?.asset===h.asset);
    if(this.isIsolated(h.asset)||supervised){this.record('isolation_block','system',`${this.assetName(h.asset)}${this.isIsolated(h.asset)?'隔离期间，一笔未登记操作遭拒。':'一笔未登记操作被现场监工制止。'}`,{data:{asset:h.asset}});return;}
    this.state.fed+=h.amount;this.change(h.asset,-h.amount);
    if(h.kind==='damage')this.state.assets[h.asset].damage=Math.min(4,this.state.assets[h.asset].damage+Math.max(1,Math.floor(h.amount/4)));
    const incident=this.incident(actor,h,true,positions);
    if(h.kind==='consume')this.observe(actor,{kind:'withdraw',day:this.state.day,window:'aftermath',location:ASSETS.find(a=>a.id===h.asset).locationId,actor,asset:h.asset,amount:h.amount,logged:false,incident},actor,'personal');
  }
  incident(actor,h,malicious,positions=Object.fromEntries(CREW.filter(id=>this.state.crew[id].alive).map(id=>[id,this.location(id)]))) {
    const location=ASSETS.find(s=>s.id===h.asset).locationId;
    const visitors=Object.keys(positions).filter(id=>positions[id]===location);
    if(!visitors.includes(actor))visitors.push(actor);
    if(h.kind==='frame'&&!visitors.includes(h.target))visitors.push(h.target);
    visitors.sort((a,b)=>CREW.indexOf(a)-CREW.indexOf(b));
    const event=this.record('anomaly','system',`${this.assetName(h.asset)}发生额外损耗：${RESOURCE_NAMES[h.asset]} −${h.amount}${h.kind==='damage'?'，设备状态恶化':''}。起因尚未确认。`,{data:{asset:h.asset,amount:h.amount,damage:h.kind==='damage'}});
    const access=CREW.filter(id=>this.state.crew[id].alive&&this.covertAssets(id).includes(h.asset));
    if(!access.includes(actor))access.push(actor);
    if(h.kind==='frame'&&!access.includes(h.target))access.push(h.target);
    const trace={day:this.state.day,actor,asset:h.asset,kind:h.kind,amount:h.amount,visitors,access,incident:event.id,method:h.kind==='frame'?'不一致的出入记录':h.kind==='damage'?'非标准拆卸':'额外资源提取',erased:false};
    this.state.assets[h.asset].history.push(trace);
    this.record(malicious?'covert':'benign',actor,'未登记操作',{audience:['internal'],data:trace});
    // The anomaly is a real public consequence. World composes its playable
    // situation later, instead of filling the desk with a fixed investigation.
    return event.id;
  }
  settle(args) {
    this.state.summaries.push({day:this.state.day,text:args.summary});this.record('summary','world',args.summary,{sources:args.source_ids});
    const accepted=[],ignored=[];
    for(const [index,e] of args.events.entries()) {
      const reason=this.state.events.length>=this.rules.eventLimit?'event_capacity'
        :e.prototype!=='build'&&this.state.events.some(x=>x.asset===e.asset&&x.kind===(e.prototype||'incident'))?'duplicate_event':null;
      if(reason){ignored.push({index,title:e.title,reason});continue;}
      const kind=e.prototype||'incident',spec=EVENT_PROTOTYPES[kind];
      const event=this.event(e.title,e.description,e.asset,kind,e.duration===undefined?spec.duration+1:e.duration+(this.state.phase==='opening'?0:1),e.source_ids);
      if(kind==='build'){event.routes=copy(e.routes);event.duration=e.duration??event.duration;event.penalty=e.penalty??event.penalty;event.deadline=Math.min(event.deadline,this.rules.days);this.state.buildOfferedDay=this.state.day;}
      event.thread=event.id;
      this.state.events.push(event);this.record('event','system',e.title,{sources:e.source_ids,data:{event:event.id,thread:event.thread}});
      accepted.push({index,id:event.id,title:event.title});
    }
    return {settled:true,submitted:args.events.length,accepted,ignored};
  }
  prepareSettlement() {
    ensure(this.state.phase==='resolving','not_resolving');
    if(this.state.preparedDay===this.state.day)return;
    this.command('prepareSettlement');
    for(const e of [...this.state.events])if(e.deadline<=this.state.day) {if(e.penalty){this.change(e.asset,-e.penalty);this.record('deadline','system',`「${e.title}」到期未处理，${RESOURCE_NAMES[e.asset]} −${e.penalty}。`);}else this.record('opportunity_missed','system',`「${e.title}」的机会窗口已关闭。`);this.state.events=this.state.events.filter(x=>x.id!==e.id);this.closeEvent(e);}
    const loss=this.rules.dailyLoss+Math.floor((this.state.day-1)/2);
    for(const asset of keys){const drain=loss+this.state.assets[asset].damage*this.rules.damageLeak;this.change(asset,-drain);this.record('upkeep','system',`${RESOURCE_NAMES[asset]} 日常与设备损耗 −${drain}。`);}
    for(const [asset,seal] of Object.entries(this.state.isolations))if(seal.until<=this.state.day){delete this.state.isolations[asset];this.record('isolation_end','system',`${this.assetName(asset)}隔离期结束，恢复常规维护与操作。`);}
    this.state.preparedDay=this.state.day;this.checkpoint();
  }
  finishDay() {
    this.prepareSettlement();
    this.command('finishDay');
    this.state.lastResolved=this.state.day;
    if(keys.some(k=>this.state.resources[k]===0))this.end('failure','资源耗尽，最后指令号未能完成航程。');
    else if(this.state.day===this.rules.days)this.end('survival','航程结束。你们活了下来，但拟态体仍混在幸存者之中。');
    else this.state.phase='review';
    this.checkpoint();
  }
  end(kind,text) {
    const h=this.state.host;this.state.phase='ended';
    this.state.ending={
      kind,title:kind==='truth'?'真相':kind==='survival'?'生存 · 隐患未除':'航程终止',text,host:NAMES[h],
      survivors:Object.values(this.state.crew).filter(c=>c.alive).length,
      history:this.ledger.filter(e=>e.kind==='covert').map(e=>({day:e.day,text:`${this.assetName(e.data.asset)}：${e.data.kind}，主动损耗${e.data.amount}。`})),
      missed:[]
    };
    this.record('ending','system',text);
  }
  nextDay() {ensure(this.state.phase==='review'&&!this.state.ending,'not_ready_for_next_day');this.command('nextDay');this.state.day++;this.flushFollowUps();this.state.phase='planning';this.state.energy=this.rules.energy;this.dayPlan=[];this.committed.clear();this.setDuty();this.checkpoint();}
  finishOpening() {
    ensure(this.state.phase==='opening'&&this.committed.has('world')&&this.state.events.length,'opening_incomplete');
    this.command('finishOpening');this.state.phase='planning';this.committed.clear();this.state.summaries=[];this.checkpoint();
  }
  project() {
    const ending=copy(this.state.ending);
    const published=this.ledger.filter(e=>e.kind==='evidence'&&e.audience.includes('public')&&e.data.fact);
    const details=(actor,day,summary)=>{
      let notes=playerText(actor,summary);const factIds=[];
      for(const e of published.filter(e=>e.actor===actor&&e.day===day)) {
        const sentence=playerText(actor,e.summary);
        if(sentence&&notes.includes(sentence)){notes=notes.replace(sentence,'');factIds.push(e.data.fact.id);}
      }
      return {notes:notes.trim(),factIds};
    };
    const dailyLoss=this.rules.dailyLoss+Math.floor((this.state.day-1)/2);
    const upkeep=Object.fromEntries(keys.map(k=>[k,dailyLoss+this.state.assets[k].damage*this.rules.damageLeak]));
    if(ending)for(const h of ending.history)h.text=h.text.replace(/\b(consume|damage|frame)\b/g,kind=>({consume:'提取',damage:'破坏',frame:'栽赃'})[kind]);
    return {items:copy(this.state.items),isolations:copy(this.state.isolations),planning:{upkeep},components:copy(this.state.components),buildHistory:copy(this.state.buildHistory),flags:this.state.flags.map(id=>({id,label:FLAGS[id]})),pendingEvents:copy(this.state.pendingEvents),locations:copy(LOCATIONS),rules:{days:this.rules.days,energy:this.rules.energy,supervisionCost:this.rules.supervisionCost??1,initial:this.rules.initial},state:{day:this.state.day,phase:this.state.phase,resources:copy(this.state.resources),energy:this.state.energy,lastResolved:this.state.lastResolved,ending},crew:CREW_DATA.map(c=>({...copy(c),alive:this.state.crew[c.id].alive,onDuty:this.state.duty.includes(c.id)})),hand:copy(this.state.hand),slots:this.slots().map(s=>({...s,title:s.kind==='talk'?'谈话':s.title,description:s.kind==='talk'?'协商人情与操作权限；初次谈话可获得筹码。':playerText('system',s.description),...(s.kind==='event'?{brief:this.state.events.find(e=>e.id===s.id)?.description||''}:{})})),verbs:copy(VERBS),evidence:this.publicFacts(),results:this.state.results.map(r=>({...copy(r),outcome:playerText(r.actor,r.outcome),testimony:'',...details(r.actor,this.state.day,r.outcome)})),roundSummary:playerText('world',this.state.summaries.at(-1)?.text||''),timeline:this.ledger.filter(e=>e.audience.includes('public')&&!['evidence','accusation','rules_update'].includes(e.kind)).map(e=>({id:e.id,day:e.day,actor:e.actor,kind:e.kind,summary:playerText(e.actor,e.summary),data:copy(e.data),...details(e.actor,e.day,e.summary)})).filter(e=>e.summary),plan:copy(this.dayPlan)};
  }
  runtimeHash() {return hash({state:this.state,rng:this.rng,rotation:this.rotation,seq:this.seq,plan:this.dayPlan,ledger:this.ledger});}
  export() {
    return {version:3,runtime:'event-opportunities-v9',seed:this.seed,opening:this.opening||false,rules:copy(this.rules),...(this.baseline?{baseline:copy(this.baseline)}:{}),commands:copy(this.commands),
      ledger:copy(this.ledger),state:copy(this.state),rng:this.rng,rotation:[...this.rotation],seq:this.seq,plan:copy(this.dayPlan),
      hash:this.hash(),runtimeHash:this.runtimeHash()};
  }
  static restore(r) {
    if(r.version===3 && r.runtime==='event-opportunities-v9')return reconstruct(r);
    if(r.version===3) {
      ensure(['seven-days-v2','fact-cards-v1','event-builds-v1','event-builds-v2','event-builds-v3','event-objects-v4','event-simple-v5','event-play-v6','agent-play-v7','voyage-log-v8'].includes(r.runtime),'unsupported_runtime');
      ensure(hash(r.state)===r.hash && hash({state:r.state,rng:r.rng,rotation:r.rotation,seq:r.seq,plan:r.plan,ledger:r.ledger})===r.runtimeHash,'replay_hash_mismatch');
      const state=copy(r.state);
      for(const c of CREW_DATA)state.crew[c.id].location=c.location;
      // The old runtime could store the unimplemented cold-storage prototype.
      // Give imported prototypes a complete current contract, not partial fields.
      for(const e of state.events)if(e.kind==='cold_storage'&&!e.routes)e.routes=coldStorageRoutes();
      const baseline={state,rng:r.rng,rotation:copy(r.rotation),seq:r.seq,plan:copy(r.plan),ledger:copy(r.ledger)};
      if(['agent-play-v7','voyage-log-v8'].includes(r.runtime))return fromBaseline(baseline,r.rules);
      simplifyLegacy(baseline,r.rules);return fromBaseline(baseline,r.rules);
    }
    ensure(r.version===2,'unsupported_recording');replay(r);
    // Legacy recordings can only verify their saved checkpoint. Future actions replay from this explicit baseline.
    const baseline={state:copy(r.state),initial:copy(r.initial),rng:r.rng,rotation:[...r.rotation],seq:r.seq,plan:copy(r.plan),ledger:r.ledger.map(e=>e.kind==='checkpoint'?{...copy(e),data:{hash:hash(e.data.state),rng:e.data.rng}}:copy(e))};
    simplifyLegacy(baseline,RULES);return fromBaseline(baseline,RULES);
  }
  hash(){return hash(this.state);}
}
function simplifyLegacy(baseline,rules) {
  const s=baseline.state,objects=(s.items||[]).length+(s.components||[]).length;
  // Cash out retired inventory using the existing full-hand reward conversion.
  for(let i=0;i<objects;i++) {
    if(s.hand.length<rules.handLimit)s.hand.push({id:`c${++s.cardSeq}`,type:'parts',...copy(CARD_TYPES.parts)});
    else s.resources.supplies=Math.min(rules.initial,s.resources.supplies+2);
  }
  s.items=[];s.components=[];s.componentUsage={};s.isolations={};
  let changed=0;const changedIds=new Set();
  const complex=routes=>routes?.length>2||routes?.some(r=>r.rewardComponent&&r.rewardComponent!=='none'||r.consumeItem&&r.consumeItem!=='none'||r.rewardItem&&r.rewardItem!=='none'||r.operation&&r.operation!=='none'||r.powerCost>0||complex(r.followUpEvent?.routes));
  for(const e of [...s.events,...(s.pendingEvents||[])]) {
    if(e.kind==='investigation'){e.title=`${{oxygen:'供氧',power:'供电',supplies:'物资'}[e.asset]}出了点问题`;e.description='消耗比预计多。可以派人处理，也可以先调查。';}
    if(complex(e.routes)) {
      changedIds.add(e.id);e.kind='build';e.title=`${{oxygen:'供氧',power:'供电',supplies:'物资'}[e.asset]}还有些事情要处理`;e.description='之前安排留下的事情还没办完。可以花些物资处理，或者多派一个人。';
      e.routes=[route({id:'handle',label:'花些物资处理',suppliesCost:3,repair:1,restore:{oxygen:0,power:0,supplies:0,[e.asset]:8}}),route({id:'together',label:'两个人一起处理',workers:2,suppliesCost:0,repair:1,restore:{oxygen:0,power:0,supplies:0,[e.asset]:6}})];changed++;
    }
  }
  if(s.phase==='planning')baseline.plan=baseline.plan.filter(a=>!changedIds.has(a.slot));
  if(objects||changed)baseline.ledger.push({id:`e${++baseline.seq}`,day:s.day,actor:'system',kind:'rules_update',summary:`玩法已简化：${objects} 件旧设备或物品换成备件（手牌满时每件换 2 物资），${changed} 件复杂待办改为直接处理。`,audience:['public'],data:{},sources:[]});
}
function fromBaseline(baseline,rules) {
  baseline=copy(baseline);for(const c of CREW_DATA)baseline.state.crew[c.id].location??=c.location;
  const w=Object.create(World.prototype);
  Object.assign(w,{...copy(baseline),dayPlan:copy(baseline.plan),rules:copy(rules),baseline:copy(baseline),seed:null,commands:[],cache:new Map(),committed:new Set()});
  w.state.hiddenResolvedDay ??= w.state.lastResolved;
  for(const c of Object.values(w.state.crew)){delete c.fatigue;delete c.morale;}
  for(const e of [...w.state.events,...(w.state.pendingEvents||[])])delete e.morale;
  for(const [key,value] of Object.entries({items:[],itemSeq:0,isolations:{},components:[],componentUsage:{},flags:[],buildHistory:[],pendingEvents:[],buildOfferedDay:0,buildWork:{}}))w.state[key]??=value;
  // Keep installed pieces, updating their descriptions to the current rule catalog.
  for(const c of w.state.components)Object.assign(c,copy(COMPONENT_TYPES[c.type]));
  for(const c of w.state.hand)Object.assign(c,copy(CARD_TYPES[c.type]));
  // Persist the migrated baseline, not the pre-migration hash, for future replays.
  w.baseline.state=copy(w.state);
  w.slotSnapshot=w.slots();
  return w;
}
function reconstruct(r, rules=r.rules, verify=true) {
  ensure(r.version===3 && Array.isArray(r.commands),'unsupported_recording');
  const w=r.baseline?fromBaseline(r.baseline,rules):new World({seed:r.seed,rules,opening:r.opening});
  const allowed=new Set(['begin','call','resolveHidden','prepareSettlement','finishDay','nextDay','finishOpening']);
  for(const c of r.commands) {ensure(allowed.has(c.op)&&Array.isArray(c.args),'invalid_replay_command');w[c.op](...copy(c.args));}
  if(verify) {
    ensure(w.hash()===r.hash && hash(r.state)===r.hash,'replay_hash_mismatch');
    ensure(w.runtimeHash()===r.runtimeHash && hash({state:r.state,rng:r.rng,rotation:r.rotation,seq:r.seq,plan:r.plan,ledger:r.ledger})===r.runtimeHash,'replay_runtime_mismatch');
  }
  return w;
}
export function replay(r,{rules}={}) {
  if(r.version===3 && r.runtime!=='event-opportunities-v9') {
    ensure(!rules,'legacy_runtime_cannot_resimulate');
    const w=World.restore(r);return {state:copy(w.state),hash:w.hash(),verified:false,legacyBaseline:true};
  }
  if(r.version===3) {
    const w=reconstruct(r,rules||r.rules,!rules);
    return {state:copy(w.state),hash:w.hash(),verified:!rules,legacyBaseline:Boolean(r.baseline)};
  }
  if(r.version===1) {const s=copy(r.initial);for(const e of r.ledger)if(e.patch)Object.assign(s,copy(e.patch));ensure(hash(s)===r.hash,'replay_hash_mismatch');return {state:s,hash:r.hash,verified:false};}
  ensure(r.version===2,'unsupported_recording');
  const last=r.ledger.filter(e=>e.kind==='checkpoint').at(-1),s=copy(last?.data.state||r.initial);
  ensure(hash(s)===r.hash && hash(r.state)===r.hash,'replay_hash_mismatch');
  return {state:s,hash:r.hash,verified:false};
}
