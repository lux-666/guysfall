import { isBuildEvent } from './builds.mjs';
import { ASSETS } from './content.mjs';
import { ensure, validate } from './schema.mjs';
const fixedRoute={specialty:'none',rewardComponent:'none',consumeItem:'none',rewardItem:'none',operation:'none',permanent:'none',powerCost:0};
function mapRoutes(routes,fn) {
  ensure(Array.isArray(routes),'routes: array required');
  for(const r of routes)ensure(r&&typeof r==='object'&&!Array.isArray(r),'route: object required');
  return routes.map(r=>fn({...r,...(r.discovery?{discovery:{...r.discovery,routes:mapRoutes(r.discovery.routes,fn)}}:{}),...(r.followUpEvent?{followUpEvent:{...r.followUpEvent,routes:mapRoutes(r.followUpEvent.routes,fn)}}:{})}));
}

// Contract for new model submissions; recorded game commands remain replayable.
// pendingEvents are the same public consequences already exposed by project().
export function eventGenerationRequest(world) {
  const context = world.context('world'), tool = world.tool('world');
  const records=world.ledger.filter(e=>e.audience.includes('public'));
  const resolved=records.filter(e=>e.kind==='event_closed');
  const closed=new Set(resolved.map(e=>e.data.thread));
  const byId=new Map(records.map(e=>[e.id,e]));
  const belongsToClosed=(id,seen=new Set())=>{
    if(seen.has(id))return false;seen.add(id);
    const record=byId.get(id);
    return Boolean(record&&(closed.has(record.data.thread)||record.sources.some(source=>belongsToClosed(source,seen))));
  };
  context.resolvedEvents=resolved.map(e=>({title:e.data.title,day:e.day}));
  context.closedSourceIds=records.filter(e=>belongsToClosed(e.id)).map(e=>e.id);
  const pending = structuredClone(world.state.pendingEvents);
  const routeEvents = context.events.filter(isBuildEvent).length + pending.filter(isBuildEvent).length;
  const reason = Object.values(context.resources).some(n => n <= 0) ? 'resources_depleted'
    : !context.opening && context.day >= Math.min(6, world.rules.days) ? 'generation_window_closed'
    : world.state.buildOfferedDay === context.day ? 'already_offered_today'
    : context.buildRules.freeEventSlots < 1 ? 'event_capacity'
    : routeEvents >= 2 ? 'unresolved_route_events'
    : null;
  context.pendingEvents = pending;
  context.generationTask = {
    mode: reason ? 'summary_only' : context.opening ? 'opening_event' : 'new_choice_event',
    eventCount: reason ? 0 : 1,
    reason,
    instruction: reason
      ? '本轮只总结公开结果，events必须为空；先让玩家处理已有事件。'
      : '根据当前船况生成恰好一张prototype=build的处境和两种办法，明确duration和penalty。可以提出危机，也可以提出值得腾出人手的限时机会（penalty=0）；不要把每件事都变成必须维修的待办。结合手牌、人手和当前资源考虑不同价值，rewardCard=dispatch可以换来之后的额外人手，使用材料可先腾出手牌位；别只替同一种维修换名字，不要求剧情描写或固定题材顺序。已结束的事件不再续单，不能用closedSourceIds中的旧结果换名重开。每件事有明确出口，只有确实留下新问题时才预留一层后续，后续直接结束。两种办法有实际取舍，可用loss表达代价，或inspect+discovery先查再决定；调查前不泄露finding或新办法。用已有手牌，不生成加工链、组件、人物养成或责任人。'
  };
  const events = tool.function.parameters.properties.events;
  events.minItems = events.maxItems = context.generationTask.eventCount;
  events.description = context.generationTask.instruction;
  events.items.properties.prototype.enum = ['build'];
  events.items.required.push('routes','duration','penalty');
  const simplify=schema=>{
    schema.minItems=schema.maxItems=2;const p=schema.items.properties;
    p.workers.maximum=2;
    p.card.description='至少一种办法card=none且suppliesCost=0，不花材料或物资；可多派人或承担loss。';
    p.suppliesCost.description='同一事件至少一种办法suppliesCost=0且card=none。';
    for(const key of Object.keys(fixedRoute))delete p[key];
    schema.items.required=schema.items.required.filter(key=>!Object.hasOwn(fixedRoute,key));
    p.id.description='简短英文标识，如repair或accept，最多48字符。';
    p.label.description='简短按钮名称，最多18个字；数字效果写在对应字段中。';
    p.followUp.enum=p.followUp.enum.filter(v=>['none','generated'].includes(v));
    if(p.followUpEvent)simplify(p.followUpEvent.properties.routes);
    if(p.discovery)simplify(p.discovery.properties.routes);
  };
  simplify(events.items.properties.routes);
  return { context, tool };
}

export function validateGeneratedEvents(args, { context, tool }) {
  ensure(args&&Array.isArray(args.events),'events: array required');
  for(const e of args.events)ensure(e&&typeof e.title==='string'&&Array.isArray(e.source_ids),'event: title and source_ids required');
  const normalized=structuredClone(args),compact=structuredClone(args);
  for(const e of normalized.events)e.routes=e.routes&&mapRoutes(e.routes,r=>{
    for(const [key,value] of Object.entries(fixedRoute))ensure(r[key]===undefined||r[key]===value,`route.${key}: retired mechanic`);
    return {...fixedRoute,...r};
  });
  for(const e of compact.events)e.routes=e.routes&&mapRoutes(e.routes,r=>{for(const key of Object.keys(fixedRoute))delete r[key];return r;});
  const seenTitles = new Set([...context.events, ...context.pendingEvents, ...context.resolvedEvents].map(e => e.title.trim()));
  const seenKinds = new Set([...context.events, ...context.pendingEvents].map(e => `${e.asset}:${e.kind}`));
  for (const e of args.events) {
    ensure(!e.source_ids.some(id=>context.closedSourceIds.includes(id)), 'event_already_closed: 已结束的事情不能用旧结果换名重开；请依据新的公开变化生成独立问题');
    ensure(!seenTitles.has(e.title.trim()), `duplicate_event: ${e.title} 已存在；请提出新的处境，不要重复提交`);
    ensure(e.prototype === 'build' || !seenKinds.has(`${e.asset}:${e.prototype}`),
      `duplicate_event: ${e.asset}/${e.prototype} 已存在；换标题不能产生新事件`);
    seenTitles.add(e.title.trim());seenKinds.add(`${e.asset}:${e.prototype}`);
  }
  const task = context.generationTask;
  ensure(args.events.length === task.eventCount && args.events.every(e => e.prototype === 'build'),
    `generation_contract: ${task.instruction}`);
  validate(compact, tool.function.parameters);
  for(const e of normalized.events)validateTradeoffs(e.routes);
  return normalized;
}

// Apply only to new model content; historical recorded commands keep their contract.
function validateTradeoffs(routes) {
  const commitment=r=>[r.workers,r.specialty,r.card,r.suppliesCost,r.consumeItem||'none',r.powerCost||0,r.operation||'none',ASSETS.map(a=>r.loss?.[a.id]||0),r.discovery?r.discovery.routes.map(commitment):null,r.followUp,r.followUpEvent?
    [r.followUpEvent.asset,r.followUpEvent.duration,r.followUpEvent.penalty,r.followUpEvent.routes.map(commitment)]:null];
  const commitments=routes.map(r=>JSON.stringify(commitment(r)));
  ensure(new Set(commitments).size>1,'route_tradeoff_required: 两种办法不能只换奖励；人手、材料、物资或后续负担需要不同');
  for(const r of routes) {
    if(r.followUpEvent)validateTradeoffs(r.followUpEvent.routes);
    if(r.discovery)validateTradeoffs(r.discovery.routes);
  }
}
