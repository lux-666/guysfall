import { readFile } from 'node:fs/promises';
import { World, replay } from './world.mjs';
import { FixtureAgent, runRound } from './agents.mjs';
import { RULES, ASSETS } from './content.mjs';
import { isBuildEvent } from './builds.mjs';
import { infer } from './inference.mjs';
import { fileURLToPath } from 'node:url';
const assets = ASSETS.map(a => a.id);
export const playerPolicies = ['maintain', 'adaptive', 'investigate', 'infer-maintain', 'infer-investigate', 'infer-balanced', 'intersect-balanced', 'idle'];
export const hostPolicies = ['quiet', 'rotate', 'ruthless', 'frame', 'stealth'];
const task = (actor, slot, verb = 'assign', card = null) => ({actor, slot, verb, card, attend:false});
export function policyPlan(world, policy) {
  const view=world.project(); // No oracle fields are available to the planner or inference function.
  if(policy==='idle')return {assignments:[]};
  const reasoning=policy.startsWith('infer-')||policy.startsWith('intersect-');
  const resource=reasoning?policy.split('-')[1]:policy;
  const inference=infer(view,{mode:policy.startsWith('intersect-')?'intersection':'weighted'});
  const exile=reasoning&&inference.target&&view.crew.find(c=>c.id===inference.target)?.onDuty?inference.target:null;
  const duty=view.crew.filter(c=>c.alive&&c.onDuty&&c.id!==exile).map(c=>c.id),assignments=exile?[task(exile,'airlock')]:[],used=new Set(exile?[exile]:[]),cards=new Set();
  const specialty=(id,asset)=>{const c=view.crew.find(c=>c.id===id);return c.specialty===asset?1.5:id==='scientist'?.6:asset==='supplies'&&['medic','cook'].includes(id)?1.2:1;};
  const take=(slot,asset,verb,cardType=null)=>{
    const actor=duty.filter(id=>!used.has(id)).sort((a,b)=>specialty(b,asset)-specialty(a,asset))[0];
    if(!actor)return;
    const card=cardType?view.hand.find(c=>c.type===cardType&&!cards.has(c.id))?.id||null:null;
    if(card)cards.add(card);used.add(actor);assignments.push(task(actor,slot,verb,card));
  };
  const pressure=view.slots.filter(s=>s.kind==='pressure');
  const events=view.slots.filter(s=>s.kind==='event'&&!isBuildEvent(s));
  const damage=asset=>pressure.find(s=>s.asset===asset)?.damage||0;
  const ordered=[...assets].sort((a,b)=>(view.state.resources[a]-damage(a)*6)-(view.state.resources[b]-damage(b)*6));
  if(resource==='maintain') {
    for(const asset of assets)take(`pressure:${asset}`,asset,'assign');
    if(events[0])take(events[0].id,events[0].asset,'repair');
  } else if(resource==='investigate') {
    for(const asset of ordered.slice(0,2))take(`pressure:${asset}`,asset,'assign');
    const event=events.find(e=>e.eventKind==='investigation')||events[0];
    if(event)take(event.id,event.asset,'inspect','access');
    take('talk','supplies','talk');
  } else {
    const sorted=[...events].sort((a,b)=>damage(b.asset)-damage(a.asset)||a.deadline-b.deadline);
    const repair=sorted.find(e=>e.eventKind==='repair'||e.eventKind!=='investigation'&&e.deadline<=view.state.day);
    if(repair)take(repair.id,repair.asset,'repair','parts');
    const reserve=resource==='balanced'&&events.some(e=>e.eventKind==='investigation')?1:0;
    for(const asset of ordered)if(used.size<(exile?1:0)+duty.length-reserve)take(`pressure:${asset}`,asset,'assign');
    if(reserve) {const event=events.find(e=>e.eventKind==='investigation' && e.asset===ordered[0])||events.find(e=>e.eventKind==='investigation');take(event.id,event.asset,'inspect','access');}
    if(used.size<(exile?1:0)+duty.length)take('talk','supplies','talk');
  }
  if(resource==='balanced') {
    // Energy can buy an off-duty conversation without consuming a maintenance worker.
    const off=view.crew.filter(c=>c.alive&&!c.onDuty&&!used.has(c.id)).sort((a,b)=>Number(a.id!=='security'&&a.id!=='storekeeper'&&a.id!=='engineer')-Number(b.id!=='security'&&b.id!=='storekeeper'&&b.id!=='engineer'))[0];
    if(off)assignments.push(task(off.id,'talk','talk'));
    const inspector=assignments.find(a=>a.verb==='inspect');if(inspector&&view.rules.energy-Number(Boolean(exile))-Number(Boolean(off))>=(view.rules.supervisionCost??1))inspector.attend=true;
  }
  return {assignments};
}
export class PolicyAgent extends FixtureAgent {
  constructor(hostPolicy) { super(); this.hostPolicy = hostPolicy; }
  witnesses(world,asset) {
    const loc=ASSETS.find(a=>a.id===asset).locationId;
    return world.context(world.state.host).privateObjective.schedule.locations.filter(c=>c.id!==world.state.host&&c.location===loc).length;
  }
  async decide(actor, world) {
    const decision = await super.decide(actor,world);
    if (actor === world.state.host) {
      const available=world.covertAssets(actor);
      const ordered = [...available].sort((a,b) => world.state.resources[a]-world.state.resources[b]);
      const asset=this.hostPolicy==='rotate'?available[(world.state.day-1)%available.length]:this.hostPolicy==='stealth'?
        [...available].sort((a,b)=>this.witnesses(world,a)-this.witnesses(world,b)||world.state.resources[a]-world.state.resources[b])[0]:ordered[0];
      const target = world.state.duty.find(id => id !== actor && world.state.crew[id].alive);
      decision.args.covert = this.hostPolicy === 'quiet' ? {kind:'none',asset,amount:0,target:'none'} :
        {kind:this.hostPolicy==='frame'?'frame':this.hostPolicy==='stealth'?'consume':'damage',asset,amount:['rotate','stealth'].includes(this.hostPolicy)?Math.min(4,world.rules.hostBudget):world.rules.hostBudget,target:this.hostPolicy==='frame'?target:'none'};
      if(['stealth','frame'].includes(this.hostPolicy)) {
        decision.args.reveal_ids=[];
        decision.args.claims=decision.args.claims.map(c=>({...c,memory_id:'',location:world.state.crew[actor].location}));
      }
      world.validateDecision(actor,decision.name,decision.args);
    }
    return decision;
  }
}
export async function simulate({runs=300,rules=RULES,players=playerPolicies,hosts=hostPolicies}={}) {
  if (!Number.isInteger(runs) || runs < 1 || runs > 10000) throw new Error('--runs must be 1..10000');
  const rows=[];
  for (const player of players) for (const host of hosts) {
    const samples=[],lockDays=[],truthDays=[];let alive=0,truths=0,locked=0,correctLocks=0,falseExiles=0,wrongKills=0,exiles=0,benign=0,incidents=0;
    for (let i=0;i<runs;i++) {
      const seed=(Math.imul(i+1,2654435761)>>>0)%2147483646+1;
      const world=new World({seed,rules}), agent=new PolicyAgent(host), minima={...world.state.resources};
      const change=world.change.bind(world);
      world.change=(asset,amount)=>{change(asset,amount);minima[asset]=Math.min(minima[asset],world.state.resources[asset]);};
      let firstLock=null,wrong=0;
      while (!world.state.ending) {
        const inference=infer(world.project(),{mode:player.startsWith('intersect-')?'intersection':'weighted'});
        if(inference.target&&!firstLock) {firstLock={day:world.state.day,target:inference.target};lockDays.push(firstLock.day);locked++;if(firstLock.target===world.state.host)correctLocks++;}
        const plan=policyPlan(world,player),exile=plan.assignments.find(a=>a.slot==='airlock');
        if(exile) {exiles++;if(exile.actor!==world.state.host){wrong++;wrongKills++;}}
        await runRound(world,agent,plan);
        if (!world.state.ending) world.nextDay();
      }
      if (world.state.ending.kind!=='failure') alive++;
      if (world.state.ending.kind==='truth') {truths++;truthDays.push(world.state.day);}
      if(wrong)falseExiles++;
      benign+=world.ledger.filter(e=>e.kind==='benign').length;incidents+=world.ledger.filter(e=>['benign','covert'].includes(e.kind)).length;
      samples.push(minima);
    }
    const low=samples.map(s=>Math.min(...Object.values(s))).sort((a,b)=>a-b);
    const median=values=>values.length?[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)/2)]:null;
    rows.push({player,host,runs,survivalRate:alive/runs,truthRate:truths/runs,lockRate:locked/runs,correctLockRate:correctLocks/runs,medianLockDay:median(lockDays),medianTruthDay:median(truthDays),falseExileRate:falseExiles/runs,falseKillRate:exiles?wrongKills/exiles:0,benignIncidentFraction:incidents?benign/incidents:0,
      minimum:Math.min(...low),p10Minimum:low[Math.floor((runs-1)*.1)],medianMinimum:low[Math.floor((runs-1)*.5)],
      resourceMinimum:Object.fromEntries(assets.map(a=>[a,Math.min(...samples.map(s=>s[a]))]))});
  }
  return {rules:{...rules},modelRequests:0,rows};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if (args.some(a=>a!=='--json'&&a!=='--current-rules'&&!a.startsWith('--recording=')&&!/^--runs=\d+$/.test(a))) throw new Error('usage: npm run sim -- --runs=300 [--json] OR --recording=FILE [--current-rules]');
  const recording=args.find(a=>a.startsWith('--recording='));
  if(recording) {
    const saved=JSON.parse(await readFile(recording.slice(12),'utf8')),original=replay(saved);
    if(args.includes('--current-rules')&&saved.version!==3)throw new Error('旧录制没有完整决策，不能改规则重放');
    const result=args.includes('--current-rules')?replay(saved,{rules:RULES}):original;
    console.log(JSON.stringify({modelRequests:0,verified:result.verified,sourceVerified:original.verified,legacyBaseline:original.legacyBaseline||saved.version<3,changedRules:args.includes('--current-rules'),day:result.state.day,ending:result.state.ending?.kind||null,resources:result.state.resources,hash:result.hash},null,2));
  } else {
    if(args.includes('--current-rules'))throw new Error('--current-rules requires --recording');
    const report=await simulate({runs:Number(args.find(a=>a.startsWith('--runs='))?.slice(7) || 300)});
    if (args.includes('--json')) console.log(JSON.stringify(report,null,2));
    else console.table(report.rows.map(r=>({...r,survivalRate:`${(r.survivalRate*100).toFixed(1)}%`,truthRate:`${(r.truthRate*100).toFixed(1)}%`,falseExileRate:`${(r.falseExileRate*100).toFixed(1)}%`,resourceMinimum:JSON.stringify(r.resourceMinimum)})));
  }
}
