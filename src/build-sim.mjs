import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { World, replay } from './world.mjs';
import { runRound } from './agents.mjs';
import { PolicyAgent, hostPolicies } from './sim.mjs';
import { isBuildEvent } from './builds.mjs';
import { infer } from './inference.mjs';

export const buildPolicies=['省人手','省物资','先调查'];
const assets=['oxygen','power','supplies'];

// Public projection only: no identity, memories or private damage history.
export function buildPlan(view,family,{reasoning=false}={}) {
  const target=reasoning?infer(view).target:null;
  const exile=view.rules.energy>0&&view.crew.find(c=>c.id===target&&c.alive&&c.onDuty);
  const people=view.crew.filter(c=>c.alive&&c.onDuty&&c.id!==exile?.id), used=new Set(), cards=new Set(), assignments=[];
  const add=(crew,slot,verb='assign',card=null,route)=>{used.add(crew.id);if(card)cards.add(card.id);assignments.push({actor:crew.id,slot,verb,card:card?.id||null,attend:false,...(route?{route:route.id}:{})});};
  if(exile)add(exile,'airlock');
  const available=()=>people.filter(c=>!used.has(c.id));
  const material=type=>view.hand.find(c=>c.type===type&&!cards.has(c.id));
  const candidates=view.slots.filter(isBuildEvent).flatMap(e=>(e.routes||[]).map(r=>({e,r})));
  const priority=({e,r})=>family==='先调查'?(e.inspected?0:r.investigation?1:2):0;
  const build=candidates.sort((a,b)=>priority(a)-priority(b)||(family==='省物资'
    ? a.r.suppliesCost-b.r.suppliesCost||Number(a.r.card!=='none')-Number(b.r.card!=='none')||a.e.deadline-b.e.deadline
    : a.r.workers-b.r.workers||a.e.deadline-b.e.deadline)).find(({r})=>
      (!r.investigation||view.state.day<view.rules.days)&&r.workers<=people.length&&(r.card==='none'||material(r.card))&&view.state.resources.supplies>=r.suppliesCost);
  if(build) {
    const {e,r}=build;
    const workers=[...people].sort((a,b)=>Number(b.specialty===r.specialty)-Number(a.specialty===r.specialty)).slice(0,r.workers);
    workers.forEach((c,i)=>add(c,e.id,r.verb,i===0?material(r.card):null,r));
  }
  const events=view.slots.filter(s=>s.kind==='event'&&!isBuildEvent(s));
  const pressure=view.slots.filter(s=>s.kind==='pressure');
  const damage=k=>pressure.find(s=>s.asset===k)?.damage||0;
  const ordered=[...assets].sort((a,b)=>(view.state.resources[a]-damage(a)*6)-(view.state.resources[b]-damage(b)*6));
  const best=asset=>available().sort((a,b)=>Number(b.specialty===asset)-Number(a.specialty===asset))[0];
  const inspect=events.find(e=>e.eventKind==='investigation');
  const repair=[...events].sort((a,b)=>damage(b.asset)-damage(a.asset)||a.deadline-b.deadline).find(e=>e.eventKind==='repair'||e.eventKind==='supply'||e.eventKind==='material');
  // Two maintenance stations remain staffed; spare labour goes to repair / economy.
  for(const asset of ordered.slice(0,2)){const c=best(asset);if(c)add(c,`pressure:${asset}`,'assign',asset==='supplies'?material('medicine'):null);}
  if(available().length&&inspect)add(best(inspect.asset),inspect.id,'inspect',material('access'));
  else if(available().length&&repair){const type=repair.asset==='supplies'&&material('medicine')?'medicine':'parts';add(best(repair.asset),repair.id,'repair',material(type));}
  if(available().length){const asset=ordered[2];add(best(asset),`pressure:${asset}`,'assign',asset==='supplies'?material('medicine'):null);}
  if(reasoning) {
    let energy=view.rules.energy-Number(Boolean(exile));
    const off=view.crew.find(c=>c.alive&&!c.onDuty&&!used.has(c.id)&&['engineer','security','storekeeper'].includes(c.id))||view.crew.find(c=>c.alive&&!c.onDuty&&!used.has(c.id));
    if(off&&energy>0){add(off,'talk','talk');energy--;}
    const inspector=assignments.find(a=>a.verb==='inspect');if(inspector&&energy>=(view.rules.supervisionCost??1))inspector.attend=true;
  }
  return {assignments};
}

export async function simulateBuilds({runs=30,verifyReplay=false,reasoning=false}={}) {
  if(!Number.isInteger(runs)||runs<1||runs>1000)throw new Error('runs must be 1..1000');
  const rows=[];
  for(const family of buildPolicies)for(const host of hostPolicies) {
    let survives=0,truths=0,falseExiles=0,wrongKills=0,exiles=0,correctLocks=0,byDay4=0,twoByDay4=0,triggers=0,choices=0,investigations=0,discoveryResolutions=0;
    const lockDays=[],truthDays=[],installed={},gains=Object.fromEntries(assets.map(k=>[k,0]));
    for(let i=0;i<runs;i++) {
      const w=new World({seed:(Math.imul(i+1,2654435761)>>>0)%2147483646+1}),agent=new PolicyAgent(host);
      let firstLock=null,wrong=false;
      while(!w.state.ending) {
        if(w.state.day===4){const count=w.project().components.filter(c=>c.family===family&&c.installedDay<4).length;if(count)byDay4++;if(count>=2)twoByDay4++;}
        const view=w.project(),inference=infer(view);
        if(!firstLock&&inference.target){firstLock=inference.target;lockDays.push(w.state.day);if(firstLock===w.state.host)correctLocks++;}
        const plan=buildPlan(view,family,{reasoning}),exile=plan.assignments.find(a=>a.slot==='airlock');
        if(exile){exiles++;if(exile.actor!==w.state.host){wrong=true;wrongKills++;}}
        await runRound(w,agent,plan);
        if(!w.state.ending)w.nextDay();
      }
      if(verifyReplay&&replay(w.export()).hash!==w.hash())throw new Error('build replay mismatch');
      if(w.state.ending.kind!=='failure')survives++;
      if(w.state.ending.kind==='truth'){truths++;truthDays.push(w.state.day);}
      if(wrong)falseExiles++;
      choices+=w.state.buildHistory.length;
      const inspected=new Set(w.ledger.filter(e=>e.kind==='investigation').map(e=>e.data.event));
      investigations+=inspected.size;
      discoveryResolutions+=w.ledger.filter(e=>e.kind==='build_choice'&&!e.data.investigated&&inspected.has(e.data.event)).length;
      for(const c of w.state.components)installed[c.type]=(installed[c.type]||0)+1;
      for(const e of w.ledger.filter(e=>e.kind==='build_trigger')){triggers++;for(const k of assets)gains[k]+=e.data.delta[k];}
    }
    const median=values=>values.length?[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)/2)]:null;
    rows.push({family,host,runs,survivalRate:survives/runs,truthRate:truths/runs,falseExileRate:falseExiles/runs,falseKillRate:exiles?wrongKills/exiles:0,
      lockRate:lockDays.length/runs,correctLockRate:correctLocks/runs,medianLockDay:median(lockDays),medianTruthDay:median(truthDays),
      day4BuildRate:byDay4/runs,day4TwoPieceRate:twoByDay4/runs,
      averageChoices:choices/runs,averageInvestigations:investigations/runs,averageDiscoveryResolutions:discoveryResolutions/runs,averageTriggers:triggers/runs,componentInstalls:installed,componentResourceGains:gains});
  }
  return {modelRequests:0,contentSource:'deterministic-fixture-not-LLM',reasoning,runs:rows.length*runs,rows};
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if(args.some(a=>!/^--runs=\d+$/.test(a)&&a!=='--verify-replay'&&a!=='--infer'))throw new Error('usage: node src/build-sim.mjs [--runs=30] [--verify-replay] [--infer]');
  console.log(JSON.stringify(await simulateBuilds({runs:Number(args.find(a=>a.startsWith('--runs='))?.slice(7)||30),verifyReplay:args.includes('--verify-replay'),reasoning:args.includes('--infer')}),null,2));
}
