export type Crew = {id:string;name:string;role:string;station:string;accessAsset?:string;location:string;specialty:string;personality:string;alive:boolean;onDuty:boolean};
export type Card = {id:string;type:string;title:string;kind:string;description:string};
export type Route = {loss?:Record<string,number>;investigation?:boolean;consumeItem?:string;rewardItem?:string;powerCost?:number;effectivePowerCost?:number;operation?:string;id:string;label:string;verb:string;workers:number;specialty:string;card:string;suppliesCost:number;rewardComponent:string;requirements:string;outcome:string;lasting:string;consequence:string;followUpEvent?:{title:string;description:string;asset:string;duration:number;penalty:number;routes:Route[]}};
export type Component = {type:string;title:string;family:string;description:string;installedDay:number};
export type Slot = {id:string;title:string;kind:'pressure'|'event'|'talk'|'airlock';asset:string|null;description:string;verbs:string[];inspected?:boolean;deadline?:number;eventKind?:string;brief?:string;penalty?:number;workers?:number;card?:string;reward?:string;damage?:number;routes?:Route[]};
export type Assignment = {actor:string;slot:string;verb:string;card:string|null;attend:boolean;route?:string|null};
export type Fact = {id:string;memory_id?:string;incident?:string;day:number;window?:'task'|'aftermath';actor:string|null;publisher?:string;source?:string;revealedDay?:number;flavor?:string;text?:string} & (
  {kind:'sighting';location:string;suspects:string[];credibility:number} |
  {kind:'access';location:string;present:string[];credibility:number;asset?:string;method?:string} |
  {kind:'claim';location:string;subject:string;by:string} |
  {kind:'withdraw';location:string;actor:string|null;asset:string;amount:number;logged:boolean} |
  {kind?:undefined}
);
export type Report = {actor:string;title:string;outcome:string;notes?:string;factIds?:string[];delta:Record<string,number>};
export type Timeline = {id?:string;day:number;actor:string;kind:string;summary:string;notes?:string;factIds?:string[];data?:{title?:string;label?:string;delta?:Record<string,number>;asset?:string;amount?:number;damage?:boolean}};
export type LogEntry = {key:string;title:string;meta:string;lines:string[];people?:string[];warning?:string;delta?:Record<string,number>;factIds?:string[]};
export const crewLabel=(id:string,view:Pick<View,'crew'>)=>{const c=view.crew.find(c=>c.id===id);return c?`${c.role} · ${c.name}`:({world:'航程记录',system:'船载系统',player:'监察官'}[id]||id);};
const sentences=(value:string)=>value.split(/(?<=[。！？])\s*|\n+/u).map(s=>s.trim()).filter(Boolean);
export function factEntry(f:Fact,view:Pick<View,'crew'|'locations'>):LogEntry {
  const place='location' in f?view.locations[f.location]||f.location:'';
  const base={key:f.id,meta:`第 ${f.day} 日 · ${f.window==='task'?'派遣':'事后'}${place?` · ${place}`:''}`};
  switch(f.kind) {
    case 'access':return {...base,title:f.method||'操作痕迹',lines:[],people:f.present,warning:f.credibility===1?'登记存在不一致':''};
    case 'withdraw':return {...base,title:'领用确认',lines:[`${f.actor?crewLabel(f.actor,view):'操作者未知'} · ${resourceNames[f.asset]} ${f.amount}`,f.logged?'已登记':'未登记']};
    case 'sighting':return {...base,title:'目击记录',lines:[f.suspects.map(id=>crewLabel(id,view)).join(' 或 '),`可信度 ${f.credibility}`]};
    case 'claim':return {...base,title:'位置陈述',lines:[f.by===f.subject?`${crewLabel(f.by,view)}自述位置`:`${crewLabel(f.by,view)}声称${crewLabel(f.subject,view)}在此`]};
    default:return {...base,title:'旧版记录',lines:sentences(f.flavor||f.text||'旧版备注')};
  }
}
export function reportEntries(r:Report,view:View):LogEntry[] {
  const facts=(r.factIds||[]).map(id=>view.evidence.find(f=>f.id===id)).filter((f):f is Fact=>!!f);
  const notes=sentences(r.notes??r.outcome);
  return [...(notes.length?[{key:`report-${r.actor}`,title:'执行回报',meta:'',lines:notes}]:[]),...facts.map(f=>factEntry(f,view))];
}
export function timelineEntry(e:Timeline,view:View):LogEntry {
  const titles:Record<string,string>={start:'启航',orders:'派遣安排',assignment:'派遣回报',anomaly:'额外损耗',upkeep:'日常损耗',summary:'日结记录',event:'新事件',deadline:'逾期损失',opportunity_missed:'机会已错过',event_closed:'事项结束',build_choice:'处置完成',investigation:'调查回报',build_trigger:'设备回报',isolation:'隔离运行',isolation_block:'操作被阻止',isolation_end:'隔离结束',exile:'气闸放逐',loss:'船员损失',ending:'航程结束'};
  const prefix=`${crewLabel(e.actor,view)}：`,notes=e.notes??e.summary;
  // Historical upkeep records have a fixed numeric format, not a prose model response.
  const upkeep=e.kind==='upkeep'?notes.match(/^(O₂|PWR|SUP) 日常与设备损耗 −(\d+)。$/u):null;
  if(upkeep){const asset=Object.keys(resourceNames).find(k=>resourceNames[k]===upkeep[1])!;return {key:e.id||`upkeep-${e.day}-${asset}`,title:'日常损耗',meta:`第 ${e.day} 日 · 船载系统`,lines:[],delta:{[asset]:-Number(upkeep[2])}};}
  if(e.kind==='anomaly'&&e.data?.asset&&typeof e.data.amount==='number')return {key:e.id||`anomaly-${e.day}`,title:'额外损耗',meta:`第 ${e.day} 日 · 船载系统`,lines:[...(e.data.damage?['设备状态恶化。']:[]),'起因尚未确认。'],delta:{[e.data.asset]:-e.data.amount}};
  return {key:e.id||`${e.day}-${e.actor}-${e.kind}`,title:e.data?.title||titles[e.kind]||'航程记录',meta:`第 ${e.day} 日 · ${crewLabel(e.actor,view)}`,lines:sentences(notes.startsWith(prefix)?notes.slice(prefix.length):notes),delta:e.data?.delta,factIds:e.factIds};
}
export function archiveEntries(view:View):LogEntry[] {
  const entries:LogEntry[]=[];let upkeep:LogEntry|undefined;
  for(const e of [...view.timeline].reverse()) {
    const card=timelineEntry(e,view);
    if(e.kind==='upkeep'&&upkeep?.meta===card.meta){upkeep.lines.push(...card.lines);for(const [k,n] of Object.entries(card.delta||{}))upkeep.delta![k]=(upkeep.delta![k]||0)+n;}
    else{entries.push(card);upkeep=e.kind==='upkeep'?{...card,delta:card.delta||{}}:undefined;if(upkeep)entries[entries.length-1]=upkeep;}
  }
  return entries;
}
export type LogCard = LogEntry & {heading:string[];body:string[];height:number;continued:boolean};
// Measure actual wrapped text before paging; each continuation keeps its context.
export function layoutLogEntries(entries:LogEntry[],width:number,height:number,wrap:(text:string,size:number,width:number)=>string[]):LogCard[][] {
  const pages:LogCard[][]=[];let page:LogCard[]=[],used=0;
  for(const e of entries) {
    const heading=wrap(e.title,24,width-68),meta=wrap(e.meta,18,width-40);
    const cols=Math.max(1,Math.floor((width-40)/166));
    const fixed=24+heading.length*30+meta.length*24+(e.warning?34:0)+(e.people?30+Math.max(1,Math.ceil(e.people.length/cols))*36:0)+(e.delta&&Object.values(e.delta).some(n=>n)?44:0)+(e.factIds?.length?44:0)+14;
    const body=e.lines.flatMap(s=>wrap(`• ${s}`,20,width-40));
    const capacity=Math.max(1,Math.floor((height-fixed)/28));
    for(let i=0;i<Math.max(1,body.length);i+=capacity) {
      const chunk=body.slice(i,i+capacity),card={...e,heading,meta:meta.join('\n'),body:chunk,height:fixed+chunk.length*28,continued:i>0};
      if(page.length&&used+card.height+12>height){pages.push(page);page=[];used=0;}
      page.push(card);used+=card.height+12;
    }
  }
  if(page.length||!pages.length)pages.push(page);
  return pages;
}
export function factLabel(f:Fact,view:Pick<View,'crew'|'locations'>) {
  const who=(id:string)=>view.crew.find(c=>c.id===id)?.role||id;
  const place='location' in f?view.locations[f.location]||f.location:'';
  const prefix=`第 ${f.day} 日 · ${f.window==='task'?'派遣':'事后'} · ${place}`;
  switch(f.kind) {
    case 'sighting':return `${prefix}\n目击 ${f.suspects.map(who).join(' 或 ')} · 可信度 ${f.credibility}`;
    case 'access':return `${prefix}\n${f.method||'操作痕迹'} · 接触范围：${f.present.map(who).join(' / ')||'无人'}${f.credibility===1?'\n登记存在不一致。':''}`;
    case 'claim':return `${prefix}\n${f.by===f.subject?`${who(f.by)}自述位置`:`${who(f.by)}声称${who(f.subject)}在此`}`;
    case 'withdraw':return `${prefix}\n${f.actor?who(f.actor):'操作者未知'}提取 ${resourceNames[f.asset]} ${f.amount} · ${f.logged?'已登记':'未登记'}`;
    default:return f.flavor||f.text||'旧版备注';
  }
}
// Keep a record together when it fits; split only records longer than a page.
export function paginateEntries(entries:string[][],limit:number):string[] {
  const pages:string[]=[];let page:string[]=[];
  for(const entry of entries) {
    if(page.length&&page.length+entry.length+1>limit) {pages.push(page.join('\n'));page=[];}
    if(page.length)page.push('');
    page.push(...entry);
    while(page.length>limit)pages.push(page.splice(0,limit).join('\n'));
  }
  if(page.length||!pages.length)pages.push(page.join('\n'));
  return pages;
}
export type View = {items?:{id:string;type:string;title:string;description:string;asset:string;source:string;origin?:string;day:number}[];isolations?:Record<string,{until:number;source:string}>;planning?:{upkeep:Record<string,number>};components:Component[];buildHistory:{day:number;event:string;route:string;component:string;permanent:string}[];flags:{id:string;label:string}[];pendingEvents:{title:string}[];id:string;mode:'fixture'|'live';status:string;error:string|null;elapsedMs:number;progress?:string|null;locations:Record<string,string>;rules:{days:number;energy:number;supervisionCost?:number;initial:number};state:{day:number;phase:string;resources:Record<string,number>;energy:number;lastResolved:number;ending:null|{title:string;text:string;host:string;survivors:number;history:{day:number;text:string}[];missed:{owner:string;text?:string;fact?:Fact}[]}};crew:Crew[];hand:Card[];slots:Slot[];verbs:[string,string][];plan:Assignment[];results:Report[];roundSummary:string;evidence:Fact[];timeline:Timeline[]};
export type Config = {csrf:string;activeId:string|null;liveReady:boolean;model:string|null};
export const resourceNames:Record<string,string>={oxygen:'O₂',power:'PWR',supplies:'SUP'};
export const isBuildSlot=(s:Slot)=>['build','cold_storage'].includes(s.eventKind||'');
export function taskActions(s:Slot):[string,string][] {
  if(s.kind==='pressure')return [['repair','维护'],['inspect','调查']];
  if(s.kind==='talk')return [['talk','谈话']];
  if(s.kind==='airlock'||isBuildSlot(s))return [];
  return s.eventKind==='morale'?[['repair','处置']]:[['repair','处置'],['inspect','调查']];
}
// Display old equivalent verbs as the surviving action without rewriting saved orders.
export function displayedVerb(s:Slot,verb:string) {
  if(s.kind==='talk')return 'talk';
  return ['assign','escort','transfer'].includes(verb)?'repair':verb;
}
export const assignmentTitle=(s:Slot,a?:Assignment)=>s.kind==='pressure'&&a?.verb==='inspect'?s.title.replace(/^维持/,'调查'):s.title;
export function routeSummary(routes:Route[]) { return `${routes.length} 种处理办法`; }
export function routeBlock(view:View,plan:Assignment[],slotId:string,r:Route):string|null {
  if(r.investigation&&view.state.day>=view.rules.days)return '最后一天，请直接处理';
  if(r.rewardComponent==='none')return null;
  if(view.components.some(c=>c.type===r.rewardComponent))return '组件已安装，请选择其他路线';
  if(plan.some(a=>a.slot!==slotId&&view.slots.find(s=>s.id===a.slot)?.routes?.find(k=>k.id===a.route)?.rewardComponent===r.rewardComponent))return '同名组件已安排在另一事件安装';
  return null;
}
export function routeNeeds(view:View,plan:Assignment[],slotId:string,r:Route):string[] {
  const group=plan.filter(a=>a.slot===slotId),issues:string[]=[];
  const block=routeBlock(view,plan,slotId,r);if(block)issues.push(block);
  if(group.length<r.workers)issues.push(`还缺 ${r.workers-group.length} 人（需 ${r.workers} 人）`);
  if(r.specialty!=='none'&&!group.some(a=>view.crew.find(c=>c.id===a.actor)?.specialty===r.specialty))issues.push(`缺少${view.crew.find(c=>c.specialty===r.specialty)?.role||'所需专业'}`);
  if(r.card!=='none'&&!group.some(a=>view.hand.find(c=>c.id===a.card)?.type===r.card))issues.push(`缺少路线材料${view.hand.find(c=>c.type===r.card)?.title?`（${view.hand.find(c=>c.type===r.card)?.title}）`:''}`);
  if(group.some(a=>{const type=view.hand.find(c=>c.id===a.card)?.type;return type&&type!=='dispatch'&&type!==r.card;}))issues.push('请撤下非路线材料');
  if(r.consumeItem&&r.consumeItem!=='none') {
    const pool=[...(view.items||[])];
    const selected=view.slots.filter(s=>s.id!==slotId).flatMap(s=>{const a=plan.find(a=>a.slot===s.id),route=s.routes?.find(k=>k.id===a?.route);return route?[{s,route}]:[];});
    for(const {s,route} of selected){const i=pool.findIndex(i=>i.type===route.consumeItem&&(i.type!=='recovered_module'||i.asset===s.asset));if(i>=0)pool.splice(i,1);}
    if(!pool.some(i=>i.type===r.consumeItem&&(i.type!=='recovered_module'||i.asset===view.slots.find(s=>s.id===slotId)?.asset)))issues.push(`缺少可用${r.consumeItem==='recovered_module'?'本系统回收总成':'备用线路'}（其他路线占用也计入）`);
  }
  if(view.state.resources.power<(r.effectivePowerCost??r.powerCost??0))issues.push(`PWR 不足（需 ${r.effectivePowerCost??r.powerCost}）`);
  if(view.state.resources.supplies<r.suppliesCost)issues.push(`SUP 不足（需 ${r.suppliesCost}）`);
  return issues;
}
export function routeIssues(view:View,plan:Assignment[]):string[] {
  return view.slots.filter(isBuildSlot).flatMap(s=>{
    const group=plan.filter(a=>a.slot===s.id);if(!group.length)return [];
    const r=s.routes?.find(r=>r.id===group[0].route);
    return (r?routeNeeds(view,plan,s.id,r):['请选择路线']).map(issue=>`${s.title}：${issue}`);
  });
}
// These are public planning costs, not a forecast of hidden actions or task success.
export function planReview(view:View,plan:Assignment[]):string[][] {
  const selected=view.slots.filter(isBuildSlot).flatMap(s=>{
    const a=plan.find(a=>a.slot===s.id),r=s.routes?.find(r=>r.id===a?.route);return r?[r]:[];
  });
  const cost=selected.reduce((n,r)=>n+r.suppliesCost,0);
  const entries:string[][]=[['路线支出',`所选路线合计 ${cost} SUP（每事件支付一次）；当前库存 ${view.state.resources.supplies} SUP。`,
    ...(cost>view.state.resources.supplies?['超过现有库存；后续执行依赖当日收入，结算时不足的路线会失败。']:[]),
    '另有维护与普通处置费用；当日收入和执行顺序会影响支付。']];
  const power=selected.reduce((n,r)=>n+(r.effectivePowerCost??r.powerCost??0),0);
  if(power)entries.push(['测试耗电',`当前预计 ${power} PWR；检测台每日前两次省电，结算时核对次数与库存。`]);
  const loss=selected.reduce((total,r)=>{for(const [k,n] of Object.entries(r.loss||{}))total[k]=(total[k]||0)+n;return total;},{} as Record<string,number>);
  if(Object.values(loss).some(n=>n))entries.push(['所选办法的代价',Object.entries(loss).filter(([,n])=>n).map(([k,n])=>`${resourceNames[k]} −${n}`).join(' / '),'实际处置时承担，另计日末与隐藏损耗。']);
  if(selected.some(r=>r.investigation))entries.push(['先调查的事件','本次公布发现并打开新办法，事件仍需处理；至少留到次日。']);
  if(view.planning)entries.push(['日末损耗估算',Object.entries(view.planning.upkeep).map(([k,n])=>`${resourceNames[k]} −${n}`).join(' / '),'按当前设备状态；维修或新损伤会改变日耗，未计隐藏损耗。']);
  const due=view.slots.filter(s=>s.kind==='event'&&s.deadline!==undefined&&s.deadline<=view.state.day);
  for(const s of due)entries.push([`今日${s.penalty===0?'关闭':'到期'} · ${s.title}`,`${plan.some(a=>a.slot===s.id)?'已安排，仍须完成':'未安排'}；${s.penalty===0?'错过不扣资源':`未完成将损失 ${resourceNames[s.asset||'supplies']} ${s.penalty||0}`}。`]);
  return entries;
}
export function energyUsed(view:View,plan:Assignment[]) {return plan.reduce((n,a)=>n+(a.attend?(view.rules.supervisionCost??1):0)+Number(a.slot==='airlock')+Number(a.slot==='talk'&&!view.crew.find(c=>c.id===a.actor)?.onDuty),0);}
export function validateDraft(view:View,plan:Assignment[]):string|null {
  const people=new Set<string>(),cards=new Set<string>();
  for(const a of plan){
    if(!a||typeof a.attend!=='boolean'||typeof a.actor!=='string'||typeof a.slot!=='string'||typeof a.verb!=='string'||!(a.card===null||typeof a.card==='string'))return '草稿格式无效，请重新布牌。';
    const c=view.crew.find(c=>c.id===a.actor),s=view.slots.find(s=>s.id===a.slot),card=view.hand.find(c=>c.id===a.card);
    if(!c?.alive||people.has(a.actor))return '这名船员已离船，或已安排了任务。';people.add(a.actor);
    if(!s)return '任务已变化，请重新安排。';
    if(isBuildSlot(s)&&!s.routes?.some(r=>r.id===a.route&&r.verb===a.verb))return '请选择有效的事件路线。';
    if(!isBuildSlot(s)&&a.route!=null)return '普通任务不能指定构筑路线。';
    if(!s.verbs.includes(a.verb))return '这个任务不支持所选意图。';
    if(a.card&&(!card||cards.has(a.card)))return '这张物资牌已经投入其他任务。';if(a.card)cards.add(a.card);
    if(!c.onDuty&&s.kind!=='talk'&&card?.type!=='dispatch')return '休班船员需要临时调遣令；也可花 1 点精力与其谈话。';
    if(s.kind==='airlock'&&(a.attend||a.card))return '气闸只能投入目标船员，不能附带物资或亲临。';
  }
  for(const s of view.slots){const group=plan.filter(a=>a.slot===s.id);if(isBuildSlot(s)&&new Set(group.map(a=>a.route)).size>1)return '同一事件只能选择一条路线。';const cap=s.kind==='event'?3:s.kind==='talk'?2:1;if(plan.filter(a=>a.slot===s.id).length>cap)return '这里的人手已经满了。';}
  return energyUsed(view,plan)>view.rules.energy?'精力不足。撤回一次亲临、休班谈话或放逐。':null;
}
export function placeCrew(view:View,plan:Assignment[],actor:string,slotId:string):Assignment[] {
  const c=view.crew.find(c=>c.id===actor),s=view.slots.find(s=>s.id===slotId);
  if(!c||!s)throw new Error('船员或任务已不存在。');
  const rest=plan.filter(a=>a.actor!==actor),old=plan.find(a=>a.actor===actor);
  let card=s.kind==='airlock'?null:old?.card||null;
  if(!c.onDuty&&s.kind!=='talk'){
    if(s.kind==='airlock')throw new Error('休班船员不能直接放逐，请等他当值。');
    card=view.hand.find(k=>k.type==='dispatch'&&!rest.some(a=>a.card===k.id))?.id||null;
  }
  const route=isBuildSlot(s)?s.routes?.find(r=>r.id===rest.find(a=>a.slot===slotId)?.route)||s.routes?.find(r=>!routeBlock(view,rest,slotId,r)):null;
  const verb=route?route.verb:s.kind==='talk'?'talk':s.kind==='airlock'?'assign':s.eventKind==='investigation'?'inspect':'repair';
  const next=[...rest,{actor,slot:slotId,verb,card,attend:false,...(route?{route:route.id}:{})}];const err=validateDraft(view,next);if(err)throw new Error(err);return next;
}
export class GameStore extends EventTarget {
  config!:Config; view:View|null=null; plan:Assignment[]=[]; busy=false; connected=true; stream?:EventSource; message='';
  get editable(){return !!this.view&&this.view.state.phase==='planning'&&this.view.status!=='running'&&!this.busy;}
  notify(){this.dispatchEvent(new Event('change'));}
  async api(path:string,input?:unknown){const r=await fetch(path,input?{method:'POST',headers:{'Content-Type':'application/json','X-Guysfall-Token':this.config.csrf},body:JSON.stringify(input)}:{});const data=await r.json();if(!r.ok)throw new Error(data.error||'请求失败');return data;}
  draftKey(v:View){return `guysfall-draft:${v.id}:${v.state.day}`;}
  savedDraft(v:View):Assignment[]{try{const value=JSON.parse(window.localStorage.getItem(this.draftKey(v))||'[]');return Array.isArray(value)&&!validateDraft(v,value)?value:[];}catch{return [];}}
  saveDraft(){if(!this.view)return;try{if(this.view.state.phase==='planning')window.localStorage.setItem(this.draftKey(this.view),JSON.stringify(this.plan));else if(this.view.status!=='running')window.localStorage.removeItem(this.draftKey(this.view));}catch{/* Private mode may disable browser storage. */}}
  accept(v:View){const prior=this.view;const newDay=prior?.id!==v.id||prior?.state.day!==v.state.day;
    if(newDay)this.plan=v.state.phase==='planning'?this.savedDraft(v):v.plan||[];
    else if(v.state.phase!=='planning'&&v.status!=='running')this.plan=v.plan||[];
    this.view=v;this.message=v.error||'';this.saveDraft();this.notify();}
  connect(id:string){this.stream?.close();this.stream=new EventSource(`/api/events?id=${id}`);this.stream.onmessage=e=>{this.connected=true;this.accept(JSON.parse(e.data));};this.stream.onerror=()=>{this.connected=false;this.notify();};}
  async bootstrap(){try{this.config=await this.api('/api/config');if(this.config.activeId){this.accept(await this.api(`/api/session?id=${this.config.activeId}`));this.connect(this.config.activeId);}else await this.newGame(this.config.liveReady?'live':'fixture');}catch(e){this.fail(e);}}
  fail(e:unknown){this.message=e instanceof Error?e.message:String(e);this.notify();}
  async newGame(mode:'fixture'|'live'){if(this.busy||this.view?.status==='running')return;this.busy=true;this.message=mode==='live'?'正在准备开场处境…':'正在准备航程…';this.notify();try{const v=await this.api('/api/new',{mode});this.accept(v);this.connect(v.id);}catch(e){this.fail(e);}finally{this.busy=false;this.notify();}}
  edit(next:Assignment[]){if(!this.editable||!this.view)return false;const err=validateDraft(this.view,next);if(err){this.fail(new Error(err));return false;}this.plan=next;this.message='';this.saveDraft();this.notify();return true;}
  place(actor:string,slot:string){if(!this.editable||!this.view)return false;try{return this.edit(placeCrew(this.view,this.plan,actor,slot));}catch(e){this.fail(e);return false;}}
  attach(actor:string,card:string|null){return this.edit(this.plan.map(a=>a.actor===actor?{...a,card}:a));}
  patch(actor:string,patch:Partial<Pick<Assignment,'verb'|'attend'>>){return this.edit(this.plan.map(a=>a.actor===actor?{...a,...patch}:a));}
  selectRoute(slotId:string,routeId:string){const route=this.view?.slots.find(s=>s.id===slotId)?.routes?.find(r=>r.id===routeId);if(!route||!this.view)return false;const block=routeBlock(this.view,this.plan,slotId,route);if(block){this.fail(new Error(block));return false;}return this.edit(this.plan.map(a=>a.slot===slotId?{...a,route:route.id,verb:route.verb}:a));}
  remove(actor:string){return this.edit(this.plan.filter(a=>a.actor!==actor));}
  async act(path:'resolve'|'next'){if(!this.view||this.busy||this.view.status==='running')return;if(path==='resolve'){const error=routeIssues(this.view,this.plan)[0];if(error){this.fail(new Error(error));return;}}this.busy=true;this.message='';this.notify();try{const id=this.view.id;const data=await this.api(`/api/${path}`,{id,day:this.view.state.day,...(path==='resolve'?{plan:{assignments:this.plan}}:{})});this.accept(data.state?data:await this.api(`/api/session?id=${id}`));}catch(e){this.fail(e);}finally{this.busy=false;this.notify();}}
}
