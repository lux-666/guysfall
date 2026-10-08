import { mkdir, writeFile } from 'node:fs/promises';
import { RULES } from './content.mjs';
import { World, replay } from './world.mjs';
import { FixtureAgent, LiveAgent, modelConfig, runRound, suggestedPlan, initializeVoyage } from './agents.mjs';
const live=process.argv.includes('--live');
const config=live?modelConfig():null;
if(live&&!config)throw new Error('请配置本地 .env 模型信息');
const seedArg=process.argv.find(a=>a.startsWith('--seed='));
const world=new World({opening:live,...(seedArg?{seed:Number(seedArg.split('=')[1])}:{})});
const agent=live?new LiveAgent(config):new FixtureAgent();
const limit=process.argv.includes('--full')?RULES.days:1;
const started=Date.now();let error;
try {
  await initializeVoyage(world,agent);
  for(let i=0;i<limit;i++) {
    await runRound(world,agent,suggestedPlan(world),({actor,tool})=>console.log(`D${world.state.day} ${actor} → ${tool}`));
    if(world.state.ending || i===limit-1)break;world.nextDay();
  }
}catch(e){error=e;}
const file=new URL(`../runs/seven-days-${live?'live':'fixture'}-${Date.now()}.json`,import.meta.url);
await mkdir(new URL('../runs/',import.meta.url),{recursive:true,mode:0o700});
const recording={...world.export(),mode:live?'live':'fixture',model:config?.model,elapsedMs:Date.now()-started,error:error?.message||null,calls:agent.calls};
await writeFile(file,JSON.stringify(recording,null,2),{mode:0o600});
console.log(JSON.stringify({requests:live?agent.calls.length:0,elapsedMs:recording.elapsedMs,state:world.project().state,results:world.project().results,events:world.project().slots.filter(e=>e.kind==='event'),replay:replay(recording).hash===world.hash(),file:file.pathname},null,2));
if(error){console.error(error.message);process.exitCode=1;}
