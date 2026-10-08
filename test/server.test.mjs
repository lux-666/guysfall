import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, cp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fixtureBuildEvent } from '../src/builds.mjs';

test('live opening is atomic and SSE counts only public assignments, with or without an unassigned host',{timeout:10000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'guysfall-http-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await cp(new URL('../src/',import.meta.url),join(dir,'src'),{recursive:true});
  let rejectOpening=false,openingGate=null,openingStarted=false;
  const fake=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const input=JSON.parse(raw),ctx=JSON.parse(input.messages[1].content),world=!ctx.self;
    if(ctx.opening){openingStarted=true;if(rejectOpening){res.writeHead(401);res.end();return;}if(openingGate)await openingGate;}
    const args=world?{summary:'公开结果已汇总。',source_ids:ctx.public_results.slice(-2).map(e=>e.id),events:ctx.generationTask.eventCount?[fixtureBuildEvent(ctx)]:[]}:
      {approach:'work',share:false,delivery:'direct',reveal_ids:[],claims:[],accuse:'none',note:'测试决定。',memory:'',message:{to:'none',content:''},covert:{kind:'none',asset:'oxygen',amount:0,target:'none'}};
    await sleep(world?5:ctx.privateObjective.budget?25:5);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{tool_calls:[{id:'mock',function:{name:world?'settle_round':'complete_assignment',arguments:JSON.stringify(args)}}]}}]}));
  });
  fake.listen(0,'127.0.0.1');await once(fake,'listening');t.after(()=>fake.close());
  const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,[join(dir,'src/server.mjs')],{env:{...process.env,PORT:String(port),GUYSFALL_BASE_URL:`http://127.0.0.1:${fake.address().port}/v1`,GUYSFALL_MODEL:'local-test',GUYSFALL_API_KEY:'test-only',GUYSFALL_WIRE_API:'chat_completions'},stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());await once(child.stdout,'data');
  const base=`http://127.0.0.1:${port}`,config=await (await fetch(base+'/api/config')).json();
  const post=async(path,input)=>{const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-guysfall-token':config.csrf},body:JSON.stringify(input)});assert(r.ok);return r.json();};
  for(const assigned of [false,true]) {
    const view=await post('/api/new',{mode:'live'}),save=JSON.parse(await readFile(join(dir,'runs',view.id+'.json'),'utf8')),host=save.state.host;
    const workers=view.crew.filter(c=>c.onDuty&&c.id!==host).slice(0,assigned?2:3);
    const assignments=workers.map((c,i)=>({actor:c.id,slot:`pressure:${['oxygen','power','supplies'][i]}`,verb:'assign',card:null,attend:false}));
    if(assigned)assignments.push({actor:host,slot:'talk',verb:'talk',card:null,attend:false});
    const abort=new AbortController(),stream=await fetch(base+`/api/events?id=${view.id}`,{signal:abort.signal}),reader=stream.body.getReader(),decoder=new TextDecoder(),snapshots=[];
    const collect=(async()=>{
      let buffer='';
      while(true) {
        const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});
        let end;
        while((end=buffer.indexOf('\n\n'))!==-1) {
          const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);
          if(!frame.startsWith('data: '))continue;const v=JSON.parse(frame.slice(6));snapshots.push(v);
          if(v.state.phase==='review')return;
        }
      }
    })();
    await post('/api/resolve',{id:view.id,day:1,plan:{assignments}});
    await collect;abort.abort();
    const progress=snapshots.filter(v=>v.progress).map(v=>v.progress);
    assert(progress.includes('收到 3 份回报'));
    assert(!progress.some(p=>p.includes('4 份')||/\d+\s*\//.test(p)));
    for(const v of snapshots.filter(v=>v.status==='running')) {assert.equal(v.state.phase,'planning');assert(!Object.hasOwn(v.state,'host'));assert.equal(v.results.length,0);}
    const publicSave=await (await fetch(base+`/api/recording?id=${view.id}`)).json();assert(!Object.hasOwn(publicSave,'commands'));assert(!Object.hasOwn(publicSave.state,'host'));
  }
  const before=(await readFile(join(dir,'runs/active.txt'),'utf8')).trim();
  const rawNew=()=>fetch(base+'/api/new',{method:'POST',headers:{'content-type':'application/json','x-guysfall-token':config.csrf},body:JSON.stringify({mode:'live'})});
  rejectOpening=true;const failed=await rawNew();assert.equal(failed.status,400);assert.match((await failed.json()).error,/开场未完成.*原航程已保留/);
  assert.equal((await readFile(join(dir,'runs/active.txt'),'utf8')).trim(),before);
  assert.equal((await (await fetch(base+'/api/config')).json()).activeId,before);
  rejectOpening=false;openingStarted=false;let release;openingGate=new Promise(resolve=>{release=resolve;});
  const pending=rawNew();while(!openingStarted)await sleep(5);
  const conflicting=await rawNew();release();assert.equal(conflicting.status,400);assert.match((await conflicting.json()).error,/已有航程在结算/);
  const created=await (await pending).json();assert.equal(created.state.phase,'planning');assert.equal(created.state.lastResolved,0);assert.equal(created.slots.filter(s=>s.kind==='event').length,1);
});
