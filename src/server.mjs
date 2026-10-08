import http from 'node:http';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { World, RuleError } from './world.mjs';
import { FixtureAgent, LiveAgent, modelConfig, runRound, initializeVoyage } from './agents.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const port=Number(process.env.PORT||4317),csrf=randomBytes(24).toString('hex');
const sessions=new Map();let activeId=null;
// Explicit asset allowlist: the browser never gets source, credentials or private saves.
const files={'/':['index.html','text/html'],'/game.js':['game.js','text/javascript'],'/style.css':['style.css','text/css'],'/assets/desk.png':['assets/desk.png','image/png'],'/assets/reference.png':['assets/reference.png','image/png'],'/assets/ui.png':['assets/ui.png','image/png'],'/assets/ui.json':['assets/ui.json','application/json'],'/assets/grain.png':['assets/grain.png','image/png']};
const project=s=>({id:s.id,mode:s.mode,status:s.status,error:s.error,elapsedMs:s.elapsedMs||0,progress:s.progress||null,...(s.status==='running'?s.beforeView:s.world.project())});
function send(res,code,data){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function emit(s){for(const res of s.clients)res.write(`data: ${JSON.stringify(project(s))}\n\n`);}
async function persist(s){
  const dir=`${root}runs`;await mkdir(dir,{recursive:true,mode:0o700});
  const data=JSON.stringify({...s.world.export(),id:s.id,mode:s.mode,model:s.agent.config?.model||null,wireApi:s.agent.config?.wireApi||null,elapsedMs:s.elapsedMs||0,calls:s.agent.calls,decisions:[...(s.agent.decisions||new Map())]},null,2);
  await writeFile(`${dir}/${s.id}.tmp`,data,{mode:0o600});await rename(`${dir}/${s.id}.tmp`,`${dir}/${s.id}.json`);
  await writeFile(`${dir}/active.tmp`,s.id,{mode:0o600});await rename(`${dir}/active.tmp`,`${dir}/active.txt`);
}
function agentFor(mode){const config=mode==='live'?modelConfig():null;if(mode==='live'&&!config)throw new RuleError('尚未配置模型');return config?new LiveAgent(config):new FixtureAgent();}
try{
  const id=(await readFile(`${root}runs/active.txt`,'utf8')).trim();
  if(/^[a-f0-9-]{36}$/.test(id)){
    const r=JSON.parse(await readFile(`${root}runs/${id}.json`,'utf8'));const world=World.restore(r);
    if(['planning','review','ended'].includes(world.state.phase)){
      const agent=agentFor(r.mode);agent.calls=r.calls||[];if(agent.decisions)agent.decisions=new Map(r.decisions||[]);sessions.set(id,{id,world,agent,mode:r.mode,status:'idle',clients:new Set(),error:null,elapsedMs:r.elapsedMs||0});activeId=id;
    }
  }
}catch(e){if(e.code!=='ENOENT')console.error('上次存档未恢复：',e.message);}
async function resolve(s,plan){
  const before=s.world.export();s.beforeView=s.world.project();s.status='running';s.error=null;s.progress='等待船员回报…';const start=Date.now();emit(s);
  const ready=new Set(),assigned=new Set(plan.assignments.filter(a=>a.slot!=='airlock').map(a=>a.actor));
  try{await runRound(s.world,s.agent,plan,({actor,tool})=>{
    if(actor==='world')s.progress='整理记录…';
    else if(tool==='decision_ready'&&assigned.has(actor)) {ready.add(actor);s.progress=`收到 ${ready.size} 份回报`;}
    else return;
    emit(s);
  });s.status='idle';}
  catch(error){s.world=World.restore(before);s.status='idle';s.error=`本轮未完成，已回到布牌状态：${error.name==='TimeoutError'?'模型超时':error.message}`;}
  s.elapsedMs=Date.now()-start;s.progress=null;
  try{await persist(s);}catch{ s.error=(s.error?s.error+'；':'')+'存档失败，请导出记录后再继续。'; }
  emit(s);
}
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16000)throw new RuleError('request_too_large');}try{return JSON.parse(raw||'{}');}catch{throw new RuleError('invalid_json');}}
const server=http.createServer(async(req,res)=>{
  try{
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return send(res,403,{error:'invalid_host'});
    const url=new URL(req.url,`http://${req.headers.host}`);
    if(req.headers.origin&&req.headers.origin!==url.origin)return send(res,403,{error:'invalid_origin'});
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'");
    if(req.method==='GET'&&files[url.pathname]){const[file,type]=files[url.pathname];const bytes=await readFile(`${root}public/${file}`);res.writeHead(200,{'Content-Type':type.startsWith('image/')?type:`${type}; charset=utf-8`});return res.end(bytes);}
    if(req.method==='GET'&&url.pathname==='/api/config')return send(res,200,{csrf,liveReady:Boolean(modelConfig()),model:process.env.GUYSFALL_MODEL||null,activeId});
    if(req.method==='POST'){
      if(req.headers['x-guysfall-token']!==csrf)return send(res,403,{error:'invalid_token'});
      const input=await body(req);
      if(url.pathname==='/api/new'){
        ensureNoRun();if(!['fixture','live'].includes(input.mode))throw new RuleError('invalid_mode');
        const s={id:randomUUID(),mode:input.mode,world:new World({opening:input.mode==='live'}),agent:agentFor(input.mode),status:'running',clients:new Set(),error:null,elapsedMs:0};
        s.beforeView=s.world.project();sessions.set(s.id,s);
        const started=Date.now();
        try {await initializeVoyage(s.world,s.agent);s.status='idle';s.elapsedMs=Date.now()-started;await persist(s);}
        catch(error){sessions.delete(s.id);throw new RuleError(`开场未完成，原航程已保留：${error.message}`);}
        activeId=s.id;
        if(sessions.size>5){const old=sessions.values().next().value;for(const c of old.clients)c.end();sessions.delete(old.id);}
        return send(res,201,project(s));
      }
      const s=sessions.get(input.id);if(!s)return send(res,404,{error:'session_not_found'});
      if(s.status==='running')return send(res,409,{error:'本轮正在结算'});
      if(input.day!==s.world.state.day)return send(res,409,{error:'日期已变化，请刷新页面'});
      if(url.pathname==='/api/resolve'){
        ensureNoRun();s.world.validatePlan(input.plan);send(res,202,{id:s.id});void resolve(s,input.plan);return;
      }
      if(url.pathname==='/api/next'){
        s.world.nextDay();s.error=null;await persist(s);emit(s);return send(res,200,project(s));
      }
    }
    if(req.method==='GET'&&['/api/session','/api/events','/api/recording'].includes(url.pathname)){
      const s=sessions.get(url.searchParams.get('id'));if(!s)return send(res,404,{error:'session_not_found'});
      if(url.pathname==='/api/session')return send(res,200,project(s));
      if(url.pathname==='/api/recording'){res.setHeader('Content-Disposition',`attachment; filename="guysfall-${s.id}-public.json"`);return send(res,200,{view:'player',mode:s.mode,...s.world.project()});}
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});s.clients.add(res);res.write(`data: ${JSON.stringify(project(s))}\n\n`);
      const timer=setInterval(()=>res.write(': heartbeat\n\n'),15000);res.on('close',()=>{clearInterval(timer);s.clients.delete(res);});return;
    }
    send(res,404,{error:'not_found'});
  }catch(error){if(!res.headersSent)send(res,error instanceof RuleError?400:500,{error:error instanceof RuleError?error.message:'服务处理失败'});else res.end();}
});
function ensureNoRun(){if([...sessions.values()].some(s=>s.status==='running'))throw new RuleError('已有航程在结算');}
server.listen(port,'127.0.0.1',()=>console.log(`guysfall 七日寄生 → http://127.0.0.1:${port}`));
