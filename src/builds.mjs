import { ASSETS, CARD_TYPES, COMPONENT_TYPES, CREW_DATA, RESOURCE_NAMES } from './content.mjs';
import { ensure, validate } from './schema.mjs';

const keys = ASSETS.map(a => a.id);
const enumOf = values => ({type:'string',enum:values});
const integer = (minimum,maximum) => ({type:'integer',minimum,maximum});
const object = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const FLAGS = {storage_bypass:'冷库旁路已改装',culture_preserved:'培养材料已保全',cold_storage_closed:'冷库已永久拆除'};
export const ITEMS = {recovered_module:{title:'回收总成',description:'从故障现场拆下；可离线测试或拆成物资，只能用于原系统。'},spare_line:{title:'备用线路',description:'可消耗它将一个系统切到隔离运行，限制进一步干扰。'}};
export const routeSchema = object({
  id:{type:'string',minLength:1,maxLength:48}, label:{type:'string',minLength:1,maxLength:18},
  verb:enumOf(['repair','inspect']), workers:integer(1,3), specialty:enumOf(['none',...CREW_DATA.map(c=>c.specialty)]),
  card:enumOf(['none','parts','medicine','oxygen','access']), suppliesCost:integer(0,8),
  restore:object(Object.fromEntries(keys.map(k=>[k,integer(0,16)]))), repair:integer(0,2),
  rewardComponent:enumOf(['none',...Object.keys(COMPONENT_TYPES)]), rewardCard:enumOf(['none','parts','medicine','oxygen','access','dispatch']),
  permanent:enumOf(['none',...Object.keys(FLAGS)]), followUp:enumOf(['none','repair','investigation','material','supply'])
});
// Optional fields keep saved route contracts readable; new routes state these explicitly.
Object.assign(routeSchema.properties,{consumeItem:enumOf(['none',...Object.keys(ITEMS)]),rewardItem:enumOf(['none',...Object.keys(ITEMS)]),powerCost:integer(0,8),operation:enumOf(['none','test','isolate'])});
routeSchema.properties.loss=object(Object.fromEntries(keys.map(k=>[k,integer(0,12)])));
// One generated consequence per chosen route; leaf routes cannot grow another tree.
export const leafRouteSchema = structuredClone(routeSchema);
leafRouteSchema.properties.followUp=enumOf(['none']);
export const followUpSchema = object({
  title:{type:'string',minLength:1,maxLength:24}, description:{type:'string',minLength:1,maxLength:140},
  asset:enumOf(keys), duration:integer(1,3), penalty:integer(0,12),
  routes:{type:'array',items:leafRouteSchema,minItems:2,maxItems:3}
});
routeSchema.properties.followUp.enum.push('generated');
routeSchema.properties.followUpEvent=followUpSchema;
// Investigation changes the same event once. Its finding and new choices stay
// server-side until the crew completes the investigation.
routeSchema.properties.discovery=object({
  finding:{type:'string',minLength:1,maxLength:140},
  routes:{type:'array',items:leafRouteSchema,minItems:2,maxItems:3}
});
export const isBuildEvent = e => ['build','cold_storage'].includes(e?.eventKind || e?.kind);
export function route(overrides) {
  return {consumeItem:'none',rewardItem:'none',powerCost:0,operation:'none',id:'route',label:'处理',verb:'repair',workers:1,specialty:'none',card:'none',suppliesCost:3,
    restore:{oxygen:0,power:0,supplies:0},repair:0,rewardComponent:'none',rewardCard:'none',permanent:'none',followUp:'none',...overrides};
}
export function recoveredModuleFollowUp(asset) {
  return {title:'回收总成待处置',description:'总成已保留下来。离线测试可改接出备用线路，拆解可补充物资；也可以先整理现场，把总成留给后续事件。',asset,duration:2,penalty:4,routes:[
    route({id:'test',label:'离线测试并改接',verb:'inspect',workers:2,suppliesCost:0,powerCost:4,consumeItem:'recovered_module',rewardItem:'spare_line',operation:'test',restore:{oxygen:0,power:0,supplies:4}}),
    route({id:'dismantle',label:'拆成救急物资',suppliesCost:0,consumeItem:'recovered_module',restore:{oxygen:0,power:0,supplies:12}}),
    route({id:'retain',label:'整理现场，保留总成',workers:2,suppliesCost:0,restore:{oxygen:0,power:0,supplies:2}})
  ]};
}
export const coldStorageRoutes = () => [
  route({id:'rescue',label:'两个人把食物搬出来',workers:2,suppliesCost:0,restore:{oxygen:0,power:0,supplies:12}}),
  route({id:'take',label:'只拿容易取出的',suppliesCost:0,restore:{oxygen:0,power:0,supplies:6},rewardCard:'parts'})
];
export const inputItem = (items,r,asset) => items.find(i=>i.type===r.consumeItem&&(i.type!=='recovered_module'||i.asset===asset));
export const testPowerCost = (r,hasBench=false) => Math.max(0,(r.powerCost||0)-(r.operation==='test'&&hasBench?3:0));

// Reward budget is independent of missing resources; flavour and future penalties
// cannot be traded for unlimited present rewards. This is a guardrail, not balance.
export function routeBudget(r) {
  return {value:Object.values(r.restore).reduce((a,b)=>a+b,0)+r.repair*4+(r.rewardComponent!=='none'?12:0)+(r.rewardCard!=='none'?4:0)+(r.rewardItem&&r.rewardItem!=='none'?6:0)+(r.operation==='isolate'?6:0),
    cap:16+(r.workers-1)*5+(r.card!=='none'?6:0)+(r.specialty!=='none'?4:0)+r.suppliesCost+(r.powerCost||0)+(r.consumeItem&&r.consumeItem!=='none'?4:0)};
}
export function validateRoutes(routes, state, {coldStorage=false,leaf=false,asset}={}) {
  ensure(Array.isArray(routes)&&routes.length>=2&&routes.length<=3,'build_routes_required');
  const ids=new Set(),signatures=new Set();
  for(const r of routes) {
    validate(r,leaf?leafRouteSchema:routeSchema,'route');
    ensure(/^[a-z][a-z0-9_-]*$/.test(r.id)&&!ids.has(r.id),'duplicate_or_invalid_route');ids.add(r.id);
    const signature=JSON.stringify(Object.fromEntries(Object.keys(routeSchema.properties).filter(k=>!['id','label'].includes(k)).map(k=>[k,r[k]])));
    ensure(!signatures.has(signature),'identical_routes');signatures.add(signature);
    const budget=routeBudget(r),loss=Object.values(r.loss||{}).reduce((a,b)=>a+b,0);
    ensure(budget.value<=budget.cap&&(budget.value>0||loss>0||r.discovery||r.followUp!=='none'||r.suppliesCost>0||r.powerCost>0),'route_reward_budget');
    ensure(r.verb!=='inspect'||r.repair===0,'inspection_cannot_repair');
    ensure(r.operation!=='test'||r.consumeItem==='recovered_module'&&(r.powerCost||0)>=4,'test_needs_module_and_power');
    ensure(r.operation!=='isolate'||r.card==='access'||r.consumeItem==='spare_line','isolation_needs_equipment');
    if(asset&&r.consumeItem&&r.consumeItem!=='none')ensure(inputItem(state.items||[],r,asset),'route_item_not_in_context');
    ensure(coldStorage||r.permanent==='none','reserved_permanent_flag');
    ensure(r.rewardComponent==='none'||!state.components.some(c=>c.type===r.rewardComponent),'component_already_installed');
    const living=Object.values(state.crew).filter(c=>c.alive);
    ensure(living.length>=r.workers&& (r.specialty==='none'||living.some(c=>c.specialty===r.specialty)),'route_no_living_workers');
    if(r.discovery) {
      ensure(r.verb==='inspect'&&r.followUp==='none'&&r.operation==='none'&&r.permanent==='none'&&r.rewardComponent==='none'&&(!r.rewardItem||r.rewardItem==='none'),'investigation_route_conflict');
      ensure(!r.discovery.routes.some(next=>ids.has(next.id)||routes.some(old=>old.id===next.id)),'investigation_route_id_reused');
      validateRoutes(r.discovery.routes,state,{leaf:true,asset});
    }
    if(r.followUp==='generated') {
      ensure(r.followUpEvent,'generated_follow_up_required');
      const remaining=[...(state.items||[])],spent=inputItem(remaining,r,asset);
      if(spent)remaining.splice(remaining.indexOf(spent),1);
      if(r.rewardItem&&r.rewardItem!=='none')remaining.push({type:r.rewardItem,asset:asset||r.followUpEvent.asset});
      validateRoutes(r.followUpEvent.routes,{...state,items:remaining,components:[...state.components,{type:r.rewardComponent}]},{leaf:true,asset:asset?r.followUpEvent.asset:undefined});
    } else ensure(r.followUpEvent===undefined,'unexpected_follow_up_event');
  }
  ensure(routes.some(r=>!r.discovery),'event_needs_direct_exit');
  ensure(routes.some(r=>r.card==='none'&&r.specialty==='none'&&r.rewardComponent==='none'&&r.suppliesCost===0&&!(r.powerCost>0)&&(!r.consumeItem||r.consumeItem==='none')),'route_needs_material_free_exit: 至少一种办法不花材料或物资，card=none、suppliesCost=0；可多派人或承担loss。不必免费恢复资源。');
}

export function routeDescription(r) {
  const needs=[`${r.workers} 人`,...(r.specialty==='none'?[]:[CREW_DATA.find(c=>c.specialty===r.specialty)?.role]),...(r.card==='none'?[]:[CARD_TYPES[r.card].title]),...(r.suppliesCost?[`${r.suppliesCost} 物资`]:[])];
  if(r.consumeItem&&r.consumeItem!=='none')needs.push(`消耗${ITEMS[r.consumeItem].title}${r.consumeItem==='recovered_module'?'（本系统）':''}`);
  if(r.powerCost)needs.push(`${r.powerCost} PWR${r.operation==='test'?'（检测台可省 3）':''}`);
  const gains=keys.filter(k=>r.restore[k]).map(k=>`${{oxygen:'氧气',power:'电力',supplies:'物资'}[k]} +${r.restore[k]}`);
  if(r.repair)gains.push(`设备损伤 −${r.repair}`);
  if(r.rewardCard!=='none')gains.push(`${CARD_TYPES[r.rewardCard].title}（手牌满时换 2 物资）`);
  if(r.rewardComponent!=='none')gains.push(`安装「${COMPONENT_TYPES[r.rewardComponent].title}」`);
  if(r.rewardItem&&r.rewardItem!=='none')gains.push(`保留${ITEMS[r.rewardItem].title}`);
  if(r.operation==='isolate')gains.push('本系统隔离运行至次日末；阻止隐藏损耗和破坏，维护基础产出减半');
  if(r.discovery||r.investigation)gains.push('查明情况，打开新的处理办法；本次不关闭事件');
  const losses=keys.filter(k=>r.loss?.[k]).map(k=>`${{oxygen:'氧气',power:'电力',supplies:'物资'}[k]} −${r.loss[k]}`);
  return {requirements:needs.join(' · '),outcome:gains.join('；'),
    lasting:r.rewardItem&&r.rewardItem!=='none'?ITEMS[r.rewardItem].description:r.rewardComponent!=='none'?COMPONENT_TYPES[r.rewardComponent].description:'',
    consequence:[losses.length?`承担损失：${losses.join(' / ')}`:'',FLAGS[r.permanent],r.discovery||r.investigation?'调查后仍需处理，至少留到次日':r.followUp==='generated'?`次日起等待空位开启「${r.followUpEvent.title}」：${r.followUpEvent.description}（入台后 ${r.followUpEvent.duration} 日限期，${r.followUpEvent.penalty===0?'错过不扣资源':`逾期 ${RESOURCE_NAMES[r.followUpEvent.asset]} −${r.followUpEvent.penalty}`}）`:r.followUp!=='none'?`次日起等待空位开启${{repair:'维修',investigation:'调查',material:'材料',supply:'补给'}[r.followUp]}后续（入台后 2 日限期）`:'无后续事件'].filter(Boolean).join('；')};
}

export function projectRoute(r) {
  const {discovery,...visible}=structuredClone(r);
  return {...visible,...routeDescription(r),...(discovery?{investigation:true}:{}),...(r.followUpEvent?{followUpEvent:{...structuredClone(r.followUpEvent),routes:r.followUpEvent.routes.map(projectRoute)}}:{})};
}

export function buildCatalog() {
  return {budget:'奖励值=恢复总量+修复级数×4+手牌4；上限=16+额外人手×5+材料6+SUP费用。',
    constraints:'两种处理办法，每种1–2人，不指定专业。至少一种不花材料或物资，至少一种直接结束事件。duration为1–3个可处理日，penalty为0–12；0是机会，错过只失去收益，正数是危机。restore恢复资源，loss承担资源损失（不能换取更多奖励预算），repair修复，rewardCard发手牌，dispatch增加之后调遣休班人员的机会；允许只有损失没有奖励的处置。inspect可附discovery:{finding,routes}，完成调查后保留同一事件、公布发现、换成两种新办法，至少留到次日；发现和新办法调查前不能写进公开描述或总结。调查路线不能附后续；discovery.routes与followUpEvent.routes都是叶子，不能继续调查或挂后续。rewardComponent/consumeItem/rewardItem/operation均为none，powerCost为0，permanent为none。只在选择确实留下问题时附一层后续，不安排加工链、组件或人物数值。'};
}

// Transparent offline content fixture. Live mode must supply its own validated
// mechanical routes; this is never a fallback for a failed model call.
export function fixtureBuildEvent(ctx) {
  if(ctx.buildRules.offeredToday||ctx.day>=Math.min(6,ctx.day+ctx.daysLeft-1)||ctx.events.filter(isBuildEvent).length>=2||ctx.buildRules.freeEventSlots<1)return null;
  const asset=[...keys].sort((a,b)=>ctx.resources[a]-ctx.resources[b]||keys.indexOf(a)-keys.indexOf(b))[0];
  const scenes={oxygen:['备用氧罐阀门卡住','可借走廊电力启动气泵，先补上氧气；也可以先检查阀门。','借电力抽气','氧罐没有漏气，卡住的是外部阀门，备件和手工都能解决。'],power:['备用电源无法接通','可以停掉一组通风，先接上电源；也可以检查接头，再决定怎么接。','暂停通风接电','备用电源完好，接头松动；更换接头或派两人固定都可以恢复供电。'],supplies:['一批补给箱打不开','可以用电动工具破开箱子，先拿物资；也可以查清箱子的开启方式。','用电动工具开箱','箱子里是完好的补给；用操作许可打开封条，或派两人手工解开即可取出。']};
  const [title,description,quick,finding]=scenes[asset],loss=asset==='power'?{oxygen:6,power:0,supplies:0}:{oxygen:0,power:4,supplies:0};
  const previous=ctx.buildHistory.at(-1);
  return {title,description,asset,prototype:'build',duration:3,penalty:9,source_ids:ctx.public_results.slice(-2).map(e=>e.id),routes:[
    route({id:'quick',label:quick,suppliesCost:0,loss,restore:{oxygen:0,power:0,supplies:0,[asset]:10}}),
    route({id:'investigate',label:'先调查，再决定',verb:'inspect',suppliesCost:0,discovery:{finding,routes:[
      route({id:'use_card',label:asset==='supplies'?'用许可打开封条':'用备件处理',card:asset==='supplies'?'access':'parts',suppliesCost:0,repair:asset==='supplies'?0:1,restore:{oxygen:0,power:0,supplies:0,[asset]:12}}),
      route({id:'manual',label:'两个人慢慢处理',workers:2,suppliesCost:0,repair:asset==='supplies'?0:1,restore:{oxygen:0,power:0,supplies:0,[asset]:10}})
    ]}})
  ],...(previous?{description:`${description} 之前选择了「${previous.route}」，眼下${{oxygen:'氧气',power:'电力',supplies:'物资'}[asset]}最紧张。`}:{})};
}
