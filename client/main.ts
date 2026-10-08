import Phaser from 'phaser';
import portraitConfig from '../art/ui/portraits.json';
import { GameStore, energyUsed, placeCrew, resourceNames, isBuildSlot, taskActions, displayedVerb, assignmentTitle, routeIssues, routeBlock, routeNeeds, routeSummary, planReview, paginateEntries, crewLabel, factEntry, reportEntries, archiveEntries, layoutLogEntries, type LogEntry, type LogCard, type Report, type Crew, type Slot, type Assignment, type Card } from './model';
import { DeskAudio } from './audio';
const W=1600,H=1000;
const phaseLabels:Record<string,string>={planning:'布牌',review:'日末',ended:'终局'};
const C={ink:0x192a37,paper:0xead7b3,edge:0xb5884e,gold:0xe5ba79,navy:0x122433,muted:0x8da1aa,light:0xf6e9d0,green:0x478760,red:0xb84934,cyan:0x62c9d7};
const font='"PingFang SC", "Microsoft YaHei", sans-serif';
const store=new GameStore();
const portraits:Record<string,number[]>=portraitConfig.rects;
// Frame names in public/assets/ui.json (built from art/ui by `npm run art`). Glyphs are white and take a tint; medallion-* and chip-* are full colour.
const eventTone:Record<string,string>={incident:'medallion-red',repair:'medallion-red',cooperation:'medallion-green',morale:'medallion-green',cache:'medallion-green'};
type Action={label:string;fn:()=>void;enabled:boolean};
type Target={slot:string;x:number;y:number;w:number;h:number;glow:Phaser.GameObjects.Graphics};
class DeskScene extends Phaser.Scene {
  board!:Phaser.GameObjects.Container;modal!:Phaser.GameObjects.Container;fx!:Phaser.GameObjects.Container;
  audioFx=new DeskAudio();selected:string|null=null;selectedCard:string|null=null;eventPage=0;targets:Target[]=[];
  actions:Action[]=[];modalActions:Action[]=[];modalContent:string[]=[];inModal=false;modalOpen=false;lastPhase='';lastDay='';
  tooltip?:Phaser.GameObjects.Container;dragging=false;detailActor:string|null=null;reportIndex=0;archivePage=0;archiveEvidence=false;
  preload(){this.load.image('desk','/assets/desk.png');this.load.image('reference','/'+portraitConfig.source.replace(/^public\//,''));this.load.atlas('ui','/assets/ui.png','/assets/ui.json');this.load.image('grain','/assets/grain.png');}
  create(){
    document.getElementById('loading')?.remove();
    for(const[id,rect]of Object.entries(portraits))this.textures.get('reference').add(id,0,...rect as [number,number,number,number]);
    this.textures.get('reference').add('leak',0,454,231,189,94);this.textures.get('reference').add('signal',0,933,231,171,94);
    this.add.image(W/2,H/2,'desk').setDisplaySize(W,H);
    this.add.rectangle(W/2,H/2,W,H,0x030a12,.22);
    this.board=this.add.container(0,0);this.fx=this.add.container(0,0).setDepth(50);this.modal=this.add.container(0,0).setDepth(100);
    this.input.dragDistanceThreshold=8;
    this.input.on('dragstart',(_p:Phaser.Input.Pointer,obj:Phaser.GameObjects.Container)=>{this.dragging=true;this.hideTip();this.audioFx.play('pick');obj.setDepth(20);obj.setScale(1.055);const actor=obj.getData('actor');if(actor)this.highlight(actor);});
    this.input.on('drag',(_p:Phaser.Input.Pointer,obj:Phaser.GameObjects.Container,x:number,y:number)=>{obj.setPosition(x,y);});
    this.input.on('dragend',(p:Phaser.Input.Pointer,obj:Phaser.GameObjects.Container)=>{
      const actor=obj.getData('actor') as string|undefined,card=obj.getData('card') as string|undefined;
      const target=this.targets.find(t=>Phaser.Geom.Rectangle.Contains(new Phaser.Geom.Rectangle(t.x,t.y,t.w,t.h),p.x,p.y));
      if(target){if(actor)this.place(actor,target.slot);else if(card)this.putCard(card,target.slot);}else this.paint();
      this.time.delayedCall(40,()=>{this.dragging=false;});
    });
    this.input.keyboard?.on('keydown-ESC',()=>{if(this.modalOpen)this.closeModal();else{this.selected=null;this.selectedCard=null;this.paint();}});
    this.input.keyboard?.on('keydown-M',()=>{this.audioFx.toggle();this.paint();});
    store.addEventListener('change',()=>this.onState());this.paint();void store.bootstrap();
  }
  text(parent:Phaser.GameObjects.Container,x:number,y:number,value:string,size=20,color=C.light,width?:number){const t=this.add.text(x,y,value,{fontFamily:font,fontSize:size,color:`#${color.toString(16).padStart(6,'0')}`,lineSpacing:5,...(width?{wordWrap:{width,useAdvancedWrap:true}}:{})});parent.add(t);return t;}
  panel(parent:Phaser.GameObjects.Container,x:number,y:number,w:number,h:number,paper=false,edge=C.edge){
    const g=this.add.graphics();g.fillStyle(0x000000,.35).fillRoundedRect(x+5,y+7,w,h,9);g.fillStyle(edge).fillRoundedRect(x,y,w,h,9);g.fillStyle(paper?0x57452f:0x080f17).fillRoundedRect(x+3,y+3,w-6,h-6,7);g.fillStyle(paper?C.paper:C.navy,.98).fillRoundedRect(x+7,y+7,w-14,h-14,5);
    g.lineStyle(1,paper?0xf8e8c7:0x496170,.55).strokeRoundedRect(x+11,y+11,w-22,h-22,3);
    for(const dx of [17,w-17])for(const dy of [17,h-17]){g.fillStyle(paper?0x997340:0x78909b,.7).fillCircle(x+dx,y+dy,2.5);}
    parent.add(g);if(paper)parent.add(this.add.tileSprite(x+7,y+7,w-14,h-14,'grain').setOrigin(0).setAlpha(.55));return g;
  }
  icon(parent:Phaser.GameObjects.Container,x:number,y:number,frame:string,size=24,tint?:number){const img=this.add.image(x,y,'ui',frame).setDisplaySize(size,size);if(tint!==undefined)img.setTint(tint);parent.add(img);return img;}
  portrait(parent:Phaser.GameObjects.Container,x:number,y:number,id:string,w:number,h:number){
    parent.add(this.add.rectangle(x,y,w,h,0x223546).setOrigin(0));
    const image=this.add.image(x+w/2,y+h/2,'reference',id);
    image.setScale(Math.min(w/image.width,h/image.height));parent.add(image);return image;
  }
  medal(parent:Phaser.GameObjects.Container,x:number,y:number,plate:string,frame:string,size=44,tint=C.light){this.icon(parent,x,y,plate,size);return this.icon(parent,x,y,frame,size*.5,tint);}
  // Icon + short value; returns the x after the badge so condition rows can be laid out left to right.
  badge(parent:Phaser.GameObjects.Container,x:number,y:number,frames:string[],value:string,ink:number,size=20){let cx=x;for(const f of frames){this.icon(parent,cx+size/2,y,f,size,ink);cx+=size+1;}if(value){const t=this.text(parent,cx+2,y,value,15,ink).setOrigin(0,.5);cx+=t.width+4;}return cx+12;}
  button(parent:Phaser.GameObjects.Container,x:number,y:number,w:number,h:number,label:string,fn:()=>void,opts:{enabled?:boolean;paper?:boolean;danger?:boolean;size?:number;icon?:string;chip?:string;trail?:string[];a11y?:string}={}){
    const enabled=opts.enabled??true;const c=this.add.container(x,y);parent.add(c);
    const bg=this.add.graphics();const fill=opts.danger?0x963c2c:opts.paper?C.paper:0x233c49;
    const draw=(hover=false)=>{bg.clear().fillStyle(0x000000,.25).fillRoundedRect(2,4,w,h,4).fillStyle(fill,enabled?1:.55).fillRoundedRect(0,0,w,h,4).lineStyle(hover?2:1,hover?C.gold:opts.danger?0xd86b4c:C.edge,enabled?1:.35).strokeRoundedRect(0,0,w,h,4);};draw();c.add(bg);
    const ink=opts.paper?C.ink:C.light,is=Math.min(h-8,30),trail=opts.trail||[],ts=Math.min(h*.5,16);const left=opts.icon||opts.chip?is+8:0,right=trail.length?trail.length*(ts+2)+6:0;
    if(opts.chip)this.icon(c,4+is/2,h/2,opts.chip,is+4).setAlpha(enabled?1:.5);else if(opts.icon)this.icon(c,6+is/2,h/2,opts.icon,is-4,ink).setAlpha(enabled?1:.5);
    trail.forEach((f,i)=>this.icon(c,w-6-ts/2-i*(ts+2),h/2,f,ts,opts.paper?C.ink:C.gold));
    if(label)this.text(c,left+(w-left-right)/2,h/2,label,opts.size||18,ink).setOrigin(.5).setAlpha(enabled?1:.5);
    c.setSize(w,h).setInteractive(new Phaser.Geom.Rectangle(w/2,h/2,w,h),Phaser.Geom.Rectangle.Contains);
    if(enabled){c.input!.cursor='pointer';c.on('pointerover',()=>draw(true));c.on('pointerout',()=>draw());c.on('pointerup',()=>{if(this.dragging)return;this.audioFx.play('pick');fn();});}
    (this.inModal?this.modalActions:this.actions).push({label:opts.a11y||label,fn,enabled});return c;
  }
  onState(){
    const v=store.view,key=v?`${v.id}:${v.state.day}`:'';if(key!==this.lastDay){this.lastDay=key;this.eventPage=0;this.selected=null;this.selectedCard=null;this.closeModal(false);}
    const phase=v?.status==='running'?'running':v?.state.phase||'';const changed=phase!==this.lastPhase;this.lastPhase=phase;
    this.paint();
    if(changed&&['review','ended'].includes(phase)){this.closeModal(false);this.reportIndex=0;this.audioFx.play('reveal');this.openReport();}
    else if(this.modalOpen&&this.detailActor){const actor=this.detailActor;this.openAssignment(actor);}
  }
  paint(){
    this.hideTip();this.board.removeAll(true);this.actions=[];this.targets=[];
    const v=store.view;if(!v){this.panel(this.board,480,385,640,230);this.text(this.board,800,428,'最后指令号',36,C.gold).setOrigin(.5);this.text(this.board,800,490,store.message||'正在读取航程记录…',20,C.light,550).setOrigin(.5);if(store.message)this.button(this.board,710,540,180,44,'重新连接',()=>void store.bootstrap());this.syncAccess();return;}
    this.drawHeader();this.drawSlots();this.drawCrew();this.drawHand();this.drawFooter();
    if(this.selected)this.highlight(this.selected);
    if(store.message){const msg=this.add.container(375,600);this.board.add(msg);this.panel(msg,0,0,850,50,false,C.red);this.text(msg,425,25,store.message,16,0xffcfb8,798).setOrigin(.5);}
    this.syncAccess();
  }
  drawHeader(){const v=store.view!;
    const date=this.add.container(38,30).setAngle(-3);this.board.add(date);this.panel(date,0,0,208,142,true);this.text(date,25,17,'距抵达',16,C.ink);this.text(date,25,42,String(Math.max(0,v.rules.days+1-v.state.day)).padStart(2,'0'),60,C.ink).setFontStyle('bold');this.text(date,120,76,`/ ${String(v.rules.days).padStart(2,'0')} 天`,23,C.ink);this.text(date,27,113,`第 ${v.state.day} 日 · ${phaseLabels[v.state.phase]}`,16,0x79654a);
    this.panel(this.board,280,32,1037,111);
    const labels=[['oxygen','氧气'],['power','电力'],['supplies','物资']];
    labels.forEach(([key,label],i)=>{const x=312+i*232;const val=v.state.resources[key];this.icon(this.board,x+15,68,`res-${key}`,32,val<25?0xff8465:C.cyan);this.text(this.board,x+38,57,label,17,0xb6c9cd);this.text(this.board,x+38,78,resourceNames[key],12,0x7f969c);this.text(this.board,x+178,51,String(val).padStart(2,'0'),32,val<25?0xff8465:C.light).setOrigin(1,0);const g=this.add.graphics();g.fillStyle(0x070f19).fillRoundedRect(x,103,178,7,3);g.fillStyle(val<25?C.red:C.cyan).fillRoundedRect(x,103,Math.max(1,val/v.rules.initial*178),7,3);this.board.add(g);});
    const energy=v.state.phase==='planning'?v.rules.energy-energyUsed(v,store.plan):v.state.energy;this.text(this.board,1040,52,'监察官精力',18,C.gold);this.text(this.board,1270,48,`${energy} / ${v.rules.energy}`,27,C.light).setOrigin(1,0);for(let i=0;i<v.rules.energy;i++){const step=234/v.rules.energy,g=this.add.graphics();g.fillStyle(0x070f19).fillRoundedRect(1040+i*step,90,step-12,32,5);this.board.add(g);this.icon(this.board,1040+i*step+(step-12)/2,106,'energy',28,i<energy?C.cyan:0x354651);}
    const running=v.status==='running'||store.busy;const label=running?'执行中…':v.state.phase==='planning'?'执行本日派遣':v.state.phase==='review'?'进入下一日':'航程终局';
    this.button(this.board,1351,45,208,64,label,()=>this.resolve(),{paper:true,enabled:!running,size:23});
    this.text(this.board,1455,122,running?(v.progress||'等待回报…'):v.state.phase==='planning'?`已安排 ${store.plan.length} 名船员`:'已归档',16,C.light).setOrigin(.5);
  }
  drawSlots(){const v=store.view!;
    v.slots.filter(s=>s.kind==='pressure').forEach((s,i)=>{const x=296+i*337;this.panel(this.board,x,166,323,86,false,0x647777);this.icon(this.board,x+30,192,`res-${s.asset}`,26,C.cyan);this.text(this.board,x+48,180,s.title,19,C.light);if(v.isolations?.[s.asset||''])this.text(this.board,x+310,181,`隔离 D${v.isolations[s.asset!].until}`,13,C.gold).setOrigin(1,0);this.target(s,x+8,201,307,43);this.tokens(s,x+16,215,285);});
    this.text(this.board,800,278,'当前事件',19,0xd9e5e2).setOrigin(.5);
    const events=v.slots.filter(s=>s.kind==='event'),pages=Math.max(1,Math.ceil(events.length/2));this.eventPage=Math.min(this.eventPage,pages-1);
    if(events.length===0)this.text(this.board,800,403,'暂无事件',25,C.light).setOrigin(.5).setAlign('center');
    events.slice(this.eventPage*2,this.eventPage*2+2).forEach((s,i)=>this.eventCard(s,405+i*415,300));
    if(pages>1){this.button(this.board,310,408,60,55,'‹',()=>{this.eventPage=(this.eventPage+pages-1)%pages;this.paint();},{size:32});this.button(this.board,1230,408,60,55,'›',()=>{this.eventPage=(this.eventPage+1)%pages;this.paint();},{size:32});}
    this.text(this.board,800,599,`${events.length} 件待办${pages>1?`  ·  ${this.eventPage+1} / ${pages}`:''}`,16,0xc4d5d4).setOrigin(.5);
    const talk=v.slots.find(s=>s.id==='talk')!;this.panel(this.board,40,209,210,374,true);this.icon(this.board,98,250,'talk',38,C.ink);this.text(this.board,162,249,'谈话',30,C.ink).setOrigin(.5);this.text(this.board,66,297,'交涉与协作',18,0x6f5b42,158);this.target(talk,55,365,180,133);this.tokens(talk,62,386,165,true);this.text(this.board,145,548,'休班谈话 · 精力 1',15,0x715a41).setOrigin(.5);
    const air=v.slots.find(s=>s.id==='airlock')!;this.panel(this.board,1350,210,210,374,false,C.red);this.text(this.board,1455,248,'气闸入口',28,0xf3b686).setOrigin(.5);this.medal(this.board,1455,302,'medallion-red','airlock',64,0xffe2cf);this.target(air,1365,351,180,143);this.tokens(air,1374,392,161);this.text(this.board,1455,526,'放逐后无法撤回',18,0xfab69b).setOrigin(.5);this.text(this.board,1455,553,'精力 1',15,0xc68b78).setOrigin(.5);
  }
  eventCard(s:Slot,x:number,y:number){const c=this.add.container(x,y);this.board.add(c);this.panel(c,0,0,350,280,true);
    c.add(this.add.image(19,16,'reference',s.asset==='oxygen'?'leak':'signal').setOrigin(0).setDisplaySize(312,90));
    const kind=s.penalty===0?'cache':s.eventKind||'incident';this.medal(c,46,42,eventTone[kind]||'medallion-navy',`ev-${kind}`,50);
    this.text(c,22,110,s.title,20,C.ink,310).setFontStyle('bold');
    const chosen=s.routes?.find(r=>r.id===store.plan.find(a=>a.slot===s.id)?.route);
    this.text(c,22,166,isBuildSlot(s)?(chosen?`安排：${chosen.label}`:`${s.inspected?'已查明 · ':''}${routeSummary(s.routes||[])}`):s.description,15,0x69573e,305).setMaxLines(2);
    this.text(c,22,208,`◷ 第 ${s.deadline} 日末${s.penalty===0?'关闭':'到期'}`,16,s.penalty===0?C.green:C.red);
    this.target(s,x+7,y+7,336,266);this.tokens(s,x+23,y+245,306);
    const zone=this.add.zone(x+10,y+10,330,220).setOrigin(0).setInteractive();this.board.add(zone);zone.input!.cursor='pointer';zone.on('pointerover',()=>this.tip(`${s.title}\n${s.description}`,x+80,y+98));zone.on('pointerout',()=>this.hideTip());zone.on('pointerup',()=>{if(this.dragging)return;this.slotClick(s.id);});
    if(isBuildSlot(s))this.button(this.board,x+183,y+202,145,30,'选择处理办法',()=>this.openRoutes(s.id),{size:15});
  }
  target(s:Slot,x:number,y:number,w:number,h:number){
    const glow=this.add.graphics().setDepth(1);glow.lineStyle(1,s.kind==='airlock'?C.red:0x967e56,.75).strokeRoundedRect(x,y,w,h,4);this.board.add(glow);this.targets.push({slot:s.id,x,y,w,h,glow});
    const zone=this.add.zone(x,y,w,h).setOrigin(0).setInteractive();zone.input!.cursor='pointer';this.board.add(zone);zone.on('pointerup',()=>{if(!this.dragging)this.slotClick(s.id);});
    this.actions.push({label:`投入${s.title}`,fn:()=>this.slotClick(s.id),enabled:store.editable});
  }
  tokens(s:Slot,x:number,y:number,w:number,vertical=false){const assigned=store.plan.filter(a=>a.slot===s.id);
    if(!assigned.length){this.text(this.board,x+w/2,y+4,this.selected?'＋ 派入所选船员':'＋ 投入船员',s.kind==='event'||s.kind==='pressure'?15:19,s.kind==='talk'?0x856c4a:s.kind==='event'?0x806648:0xadc0c6).setOrigin(.5,0);return;}
    const tw=vertical?w:Math.min(w,(w-6*(assigned.length-1))/assigned.length);
    assigned.forEach((a,i)=>{const c=store.view!.crew.find(c=>c.id===a.actor)!;const xx=vertical?x:x+i*(tw+6),yy=vertical?y+i*42:y;
      const marks=[...(a.card?[`card-${store.view!.hand.find(k=>k.id===a.card)?.type||'slot'}`]:[]),...(a.attend?['attend']:[])];
      const label=`${c.role}${s.kind==='pressure'&&a.verb==='inspect'?' · 查':''}`;
      this.button(this.board,xx,yy-3,tw,30,label,()=>this.selectedCard?this.attach(c.id,this.selectedCard):this.openAssignment(c.id),{size:assigned.length>1?13:16,chip:`chip-${c.id}`,trail:marks,a11y:`${label}${a.card?' 带筹码':''}${a.attend?' 亲临':''}`});
    });
  }
  slotClick(id:string){if(!store.editable)return;const assigned=store.plan.filter(a=>a.slot===id);
    if(this.selected){this.place(this.selected,id);return;}if(this.selectedCard){this.putCard(this.selectedCard,id);return;}
    if(assigned.length===1){this.openAssignment(assigned[0].actor);return;}
    this.openSlot(id);
  }
  place(actor:string,slot:string){this.selected=null;this.selectedCard=null;if(store.place(actor,slot)){this.audioFx.play('drop');const t=this.targets.find(t=>t.slot===slot);if(t)this.pulse(t.x+t.w/2,t.y+t.h/2);this.openAssignment(actor);}else{this.audioFx.play('error');this.paint();}}
  putCard(card:string,slot:string){const assigned=store.plan.filter(a=>a.slot===slot);if(assigned.length===1)this.attach(assigned[0].actor,card);else if(assigned.length>1){this.selectedCard=card;this.openSlot(slot);}else{store.fail(new Error('先给任务安排一名船员，再把牌交给他。'));this.audioFx.play('error');this.paint();}}
  attach(actor:string,card:string|null){this.selectedCard=null;if(store.attach(actor,card)){this.audioFx.play('drop');this.openAssignment(actor);}else this.audioFx.play('error');}
  highlight(actor:string){if(!store.view||!store.editable)return;for(const t of this.targets){let allowed=false;try{placeCrew(store.view,store.plan,actor,t.slot);allowed=true;}catch{}t.glow.clear().lineStyle(allowed?3:1,allowed?C.cyan:C.red,allowed?.9:.45).strokeRoundedRect(t.x,t.y,t.w,t.h,5);}}

  drawCrew(){const v=store.view!;this.text(this.board,58,627,'船员名单',17,C.light);this.text(this.board,1540,627,`值班 ${v.crew.filter(c=>c.alive&&c.onDuty).length} 人   ·   在船 ${v.crew.filter(c=>c.alive).length} / 8`,17,C.light).setOrigin(1,0);
    // Stable identities and positions: no sorting by duty or secret information.
    const order=['engineer','storekeeper','medic','security','scientist','comms','cook','clerk'];
    order.forEach((id,i)=>{const crew=v.crew.find(c=>c.id===id)!;this.crewCard(crew,52+i*188,663);});
  }
  crewCard(crew:Crew,x:number,y:number){const a=store.plan.find(a=>a.actor===crew.id),sel=this.selected===crew.id;const c=this.add.container(x,y);this.board.add(c);this.panel(c,0,0,179,205,true,sel?C.cyan:a?C.gold:crew.onDuty?0x7d9b68:0x666c6b);
    this.portrait(c,13,12,crew.id,153,116).setTint(crew.alive?(crew.onDuty?0xffffff:0xaab4c3):0x657077);
    if(!crew.onDuty||!crew.alive){const shade=this.add.rectangle(90,70,155,118,0x152536,crew.alive?.16:.5);c.add(shade);}
    this.icon(c,25,150,`role-${crew.id}`,22,C.ink);this.text(c,40,138,`${crew.role} · ${crew.name}`,18,C.ink).setFontStyle('bold');
    const g=this.add.graphics();g.fillStyle(!crew.alive?0x434649:a?0x947342:crew.onDuty?C.green:0x6e7b89).fillRoundedRect(12,172,155,24,3);c.add(g);
    const slot=a&&store.view!.slots.find(s=>s.id===a.slot),label=!crew.alive?'已离船':a&&slot?assignmentTitle(slot,a):crew.onDuty?'当值':'休班';this.icon(c,27,184,!crew.alive?'dead':a?'pin':crew.onDuty?'duty':'off',16,C.light);this.text(c,96,184,label,13,C.light).setOrigin(.5);
    c.setSize(179,205).setInteractive(new Phaser.Geom.Rectangle(89.5,102.5,179,205),Phaser.Geom.Rectangle.Contains);c.setData('actor',crew.id);
    if(store.editable&&crew.alive)this.input.setDraggable(c);
    c.input!.cursor=store.editable&&crew.alive?'grab':'pointer';
    c.on('pointerover',()=>{if(this.dragging||this.modalOpen)return;this.tweens.add({targets:c,y:y-9,duration:130,ease:'Sine.easeOut'});this.tip(`${crew.role} · ${crew.name} / ${crew.station}\n${crew.onDuty?"今日当值":"今日休班"} · 值守可接触 ${resourceNames[crew.accessAsset||'']||'系统'}\n派往系统后，接触范围随任务改变。`,x,Math.max(390,y-134));});
    c.on('pointerout',()=>{if(!this.dragging)this.tweens.add({targets:c,y,duration:130,ease:'Sine.easeOut'});this.hideTip();});
    const click=()=>{if(!crew.alive)return;if(a){if(this.selectedCard)this.attach(crew.id,this.selectedCard);else this.openAssignment(crew.id);}else if(store.editable){this.selected=sel?null:crew.id;this.selectedCard=null;this.audioFx.play('pick');this.paint();}};
    c.on('pointerup',()=>{if(!this.dragging)click();});this.actions.push({label:`${crew.role} ${crew.onDuty?'当值':'休班'}${a?' 已安排':''}`,fn:click,enabled:crew.alive&&store.editable});
  }
  drawHand(){const v=store.view!;this.text(this.board,58,876,'筹码',15,C.light);
    v.hand.forEach((card,i)=>{const x=54+i*185,used=store.plan.find(a=>a.card===card.id),selected=this.selectedCard===card.id;const c=this.add.container(x,905);this.board.add(c);this.panel(c,0,0,174,61,true,selected?C.cyan:C.edge);this.icon(c,33,31,`card-${card.type}`,32,C.ink);this.text(c,58,13,card.title,15,C.ink).setFontStyle('bold');this.text(c,58,36,used?`→ ${v.crew.find(k=>k.id===used.actor)?.role}`:card.kind,12,0x856c4a);if(used)c.setAlpha(.5);
      c.setSize(174,61).setInteractive(new Phaser.Geom.Rectangle(87,30.5,174,61),Phaser.Geom.Rectangle.Contains);c.setData('card',card.id);if(store.editable&&!used)this.input.setDraggable(c);c.input!.cursor=used?'default':'grab';
      const click=()=>{if(!store.editable||used)return;this.selectedCard=selected?null:card.id;this.selected=null;this.paint();};c.on('pointerup',()=>{if(!this.dragging)click();});c.on('pointerover',()=>this.tip(`${card.title}\n${card.description}`,x,780));c.on('pointerout',()=>this.hideTip());this.actions.push({label:`选择${card.title} ${i+1}${used?' 已投入':''}`,fn:click,enabled:store.editable&&!used});
    });
    if(!v.hand.length)this.text(this.board,68,926,'暂无筹码',18,C.light);
    this.button(this.board,1244,903,298,65,`航程记录 · 痕迹 ${v.evidence.length}  ›`,()=>{this.archivePage=0;this.openArchives();},{paper:true,size:22,icon:'evidence'});
  }
  drawFooter(){const v=store.view!;const hint=this.selected?`${v.crew.find(c=>c.id===this.selected)?.role} · 选择任务`:this.selectedCard?'选择已派遣的船员，或将筹码拖到他的任务':'';if(hint)this.text(this.board,800,986,hint,14,0xdac4a4).setOrigin(.5);
    this.button(this.board,45,592,205,29,'航程菜单',()=>this.openMenu(),{size:15,icon:'menu'});this.button(this.board,1351,592,208,29,this.audioFx.muted?'声音：关  [M]':'声音：开  [M]',()=>{this.audioFx.toggle();this.paint();},{size:15,icon:this.audioFx.muted?'sound-off':'sound-on'});
    if(!store.connected)this.text(this.board,800,152,'连接中断，重连中…',16,0xffbb80).setOrigin(.5);
  }
  tip(value:string,x:number,y:number){if(this.modalOpen||this.dragging)return;this.hideTip();const w=340,c=this.add.container(Math.min(W-w-15,Math.max(15,x)),y).setDepth(70);this.tooltip=c;const t=this.text(c,16,15,value,16,C.light,w-32);const h=t.height+30;const g=this.panel(c,0,0,w,h);c.sendToBack(g);c.y=Math.min(y,H-h-15);}

  hideTip(){this.tooltip?.destroy();this.tooltip=undefined;}
  pulse(x:number,y:number){const g=this.add.graphics();g.lineStyle(3,C.cyan,.9).strokeCircle(0,0,15);g.setPosition(x,y);this.fx.add(g);this.tweens.add({targets:g,scaleX:3,scaleY:3,alpha:0,duration:380,onComplete:()=>g.destroy()});}
  beginModal(title:string,w=860,h=620){this.hideTip();this.modal.removeAll(true);this.modalActions=[];this.modalContent=[];this.inModal=true;this.modalOpen=true;this.detailActor=null;
    const shade=this.add.rectangle(0,0,W,H,0x030810,.81).setOrigin(0).setInteractive();this.modal.add(shade);
    const c=this.add.container((W-w)/2,(H-h)/2);this.modal.add(c);this.panel(c,0,0,w,h,true);c.setAlpha(.3);this.tweens.add({targets:c,alpha:1,duration:160});this.text(c,35,29,title,26,C.ink,w-140).setFontStyle('bold');this.button(c,w-85,22,54,42,'×',()=>this.closeModal(),{size:28});return c;
  }
  finishModal(){this.inModal=false;this.syncAccess();}
  closeModal(repaint=true){this.modal?.removeAll(true);this.modalOpen=false;this.inModal=false;this.modalActions=[];this.modalContent=[];this.detailActor=null;if(repaint)this.syncAccess();}
  openRoutes(slotId:string,actor?:string,pages:Record<string,number>={},followUpId?:string){
    const root=store.view!.slots.find(s=>s.id===slotId);if(!root?.routes)return;
    const future=followUpId?root.routes.find(r=>r.id===followUpId)?.followUpEvent:undefined;
    const s=future||root;
    const c=this.beginModal(`${s.title} / ${future?'之后会发生什么':'怎么处理'}`,1160,840);
    const expiry=s.penalty===0?'错过不扣资源':`未处理将损失 ${resourceNames[s.asset||'supplies']} ${s.penalty}`;
    this.text(c,38,81,future?`所选分支完成后入队；入台后 ${future.duration} 日限期，${expiry}。`:`${s.penalty===0?'机会窗口 · ':''}第 ${root.deadline} 日末关闭；${expiry}。`,17,0x69573e,root.inspected&&!future?770:1080);
    if(root.inspected&&!future)this.button(c,850,76,270,38,'查看调查发现',()=>this.openSlot(slotId),{size:17});
    const assigned=future?[]:store.plan.filter(a=>a.slot===slotId);
    const probe=this.add.text(0,0,'',{fontFamily:font,fontSize:18,wordWrap:{width:306,useAdvancedWrap:true}});
    (s.routes||[]).forEach((r,i)=>{
      const x=(1160-(s.routes!.length*366-16))/2+i*366;this.panel(c,x,136,350,596,false,assigned[0]?.route===r.id?C.cyan:C.edge);
      this.text(c,x+20,158,r.label,23,C.gold,306).setFontStyle('bold');
      const block=routeBlock(store.view!,future?[]:store.plan,slotId,r);
      const missing=!future&&store.editable?routeNeeds(store.view!,store.plan,slotId,r):[];
      const chunks=paginateEntries([`需要\n${r.requirements}`,`结果\n${r.outcome}`,...(missing.length?[missing.join('；')]:[]),...(r.consequence&&r.consequence!=='无后续事件'?[`代价与后续\n${r.consequence}`]:[]),...(block?[block]:[])].map(t=>probe.getWrappedText(t)),12);
      const page=Math.min(pages[r.id]||0,chunks.length-1);
      this.text(c,x+20,230,chunks[page],18,C.light);
      this.button(c,x+20,575,105,34,'‹ 上一页',()=>this.openRoutes(slotId,actor,{...pages,[r.id]:page-1},followUpId),{enabled:page>0,size:15});
      this.text(c,x+175,584,`${page+1}/${chunks.length}`,15,C.light).setOrigin(.5,0);
      this.button(c,x+225,575,105,34,'下一页 ›',()=>this.openRoutes(slotId,actor,{...pages,[r.id]:page+1},followUpId),{enabled:page<chunks.length-1,size:15});
      this.button(c,x+20,628,310,43,future?'完成上一步后可安排':block|| (assigned[0]?.route===r.id?'● 已选办法':`选择 ${r.label}`),()=>{
        if(store.selectRoute(slotId,r.id)){if(actor)this.openAssignment(actor);else this.openRoutes(slotId);}
      },{paper:assigned[0]?.route===r.id,enabled:!future&&!block&&store.editable&&assigned.length>0,size:18});
      if(r.followUpEvent)this.button(c,x+20,685,310,30,'看看后续 ›',()=>this.openRoutes(slotId,actor,{},r.id),{size:16});
    });
    probe.destroy();
    if(future)this.button(c,38,764,240,42,'‹ 返回当前选择',()=>this.openRoutes(slotId,actor),{size:18});
    else this.text(c,38,770,assigned.length?'同一件事的人一起执行所选办法。':'先派一名船员，再选处理办法；需要时加人或带上手牌。',17,C.ink,1080);
    this.finishModal();
  }
  openSlot(id:string){const v=store.view!,s=v.slots.find(s=>s.id===id)!;const c=this.beginModal(s.title,800,580);this.text(c,36,94,isBuildSlot(s)?s.brief||s.description:s.description,17,0x6a583f,728);if(isBuildSlot(s))this.button(c,456,183,302,42,`查看 ${s.routes?.length} 种办法`,()=>this.openRoutes(id),{size:17});this.text(c,36,190,this.selectedCard?'把筹码交给哪名船员？':'选择承担这项任务的船员',18,C.ink);
    if(this.selectedCard){store.plan.filter(a=>a.slot===id).forEach((a,i)=>this.button(c,36+i*237,248,221,75,v.crew.find(k=>k.id===a.actor)!.role,()=>this.attach(a.actor,this.selectedCard),{size:23}));}
    else v.crew.forEach((crew,i)=>this.button(c,36+(i%4)*184,248+Math.floor(i/4)*105,169,84,`${crew.role}\n${crew.alive?crew.onDuty?'当值':'休班':'已离船'}`,()=>this.place(crew.id,id),{enabled:store.editable&&crew.alive,size:19}));this.finishModal();}
  openAssignment(actor:string){const v=store.view!,a=store.plan.find(a=>a.actor===actor);if(!a){this.closeModal();return;}const crew=v.crew.find(k=>k.id===actor)!,s=v.slots.find(k=>k.id===a.slot);if(!s||v.state.phase!=='planning'){this.openReport(actor);return;}const c=this.beginModal(`${crew.role} · ${crew.name}  /  ${assignmentTitle(s,a)}`,900,666);this.detailActor=actor;
    this.portrait(c,38,98,crew.id,132,108);const route=s.routes?.find(r=>r.id===a.route);this.text(c,195,102,route?`${route.label}\n${route.requirements}`:s.description,18,0x66573f,658).setMaxLines(3);this.text(c,195,172,`${crew.onDuty?'当值':'休班'}  ·  精力剩余 ${v.rules.energy-energyUsed(v,store.plan)}`,17,C.ink);
    if(s.kind!=='airlock'){
      if(isBuildSlot(s)){this.button(c,38,221,450,47,`办法：${route?.label}  /  更换`,()=>this.openRoutes(s.id,actor),{paper:true,size:20});this.text(c,515,226,(route?routeNeeds(v,store.plan,s.id,route):['请选择路线']).join('；')||'投入齐备 · 整组只结算一次',15,C.red,342);}else{
      this.text(c,38,237,'准备怎么做',18,C.ink);taskActions(s).forEach(([id,label],i)=>this.button(c,156+i*150,226,137,44,`${displayedVerb(s,a.verb)===id?'● ':''}${label}`,()=>{store.patch(actor,{verb:id});},{paper:displayedVerb(s,a.verb)===id,enabled:store.editable}));
      if(s.kind==='event'&&a.verb==='talk')this.text(c,477,237,'保留旧版谈话安排，可改选或撤回。',15,0x735e45,380);}
      this.text(c,38,300,'带上什么牌',18,C.ink);this.button(c,156,289,202,43,a.card?'撤回已投入筹码':'● 不带额外的牌',()=>this.attach(actor,null),{enabled:store.editable});
      v.hand.forEach((card,i)=>{const used=store.plan.some(k=>k.actor!==actor&&k.card===card.id);this.button(c,38+(i%3)*276,351+Math.floor(i/3)*59,263,47,`${a.card===card.id?'◆ ':''}${card.title}${used?' · 已占用':''}`,()=>this.attach(actor,card.id),{paper:a.card===card.id,enabled:store.editable&&!used,size:18});});
      this.button(c,38,491,400,46,`${a.attend?'●':'○'} 监察官亲自到场 · 花费 ${v.rules.supervisionCost??1} 点精力`,()=>store.patch(actor,{attend:!a.attend}),{paper:a.attend,enabled:store.editable&&Boolean(s.asset),size:19});this.text(c,462,503,'本日保护该系统免受隐藏干扰，不增加产出。',16,0x735e45,387);
    }else{this.text(c,50,276,'这是不能反悔的命令。',31,C.red);this.text(c,50,340,'一旦提交，目标会永久离船。\n猜错会少一个人，也会留下岗位空缺；猜对则直接结束航程。',21,C.ink,780);}
    if(store.message)this.text(c,38,550,store.message,16,C.red,816).setMaxLines(2);
    this.button(c,38,595,190,43,'从安排中撤下',()=>{this.closeModal(false);store.remove(actor);this.paint();},{danger:true,enabled:store.editable});this.button(c,641,590,221,50,'完成安排',()=>this.closeModal(),{size:22});this.finishModal();
  }
  resolve(page=0){const v=store.view!;if(v.state.phase==='ended'){this.openReport();return;}if(v.state.phase==='review'){this.closeModal(false);void store.act('next');return;}
    const issues=routeIssues(v,store.plan);if(issues.length){store.fail(new Error(issues.join('；')));this.closeModal();return;}
    const exile=store.plan.find(a=>a.slot==='airlock');const c=this.beginModal(exile?'确认气闸指令':'提交今日安排',1000,800);
    this.text(c,38,90,`第 ${v.state.day} 日 · ${store.plan.length} 名船员 · 精力 ${energyUsed(v,store.plan)} / ${v.rules.energy}`,21,C.ink);
    const assignments=store.plan.map(a=>{const s=v.slots.find(s=>s.id===a.slot)!;return [`${v.crew.find(k=>k.id===a.actor)?.role} → ${assignmentTitle(s,a)}${a.route?` → ${s.routes?.find(r=>r.id===a.route)?.label}`:` / ${taskActions(s).find(([id])=>id===displayedVerb(s,a.verb))?.[1]||'放逐'}`}${a.card?` / ${v.hand.find(k=>k.id===a.card)?.title}`:''}${a.attend?' / 亲临':''}`];});
    const entries=[...(assignments.length?assignments:[['今日没有派遣船员。日常损耗和隐藏行动仍会结算。']]),...planReview(v,store.plan)];
    const probe=this.add.text(0,0,'',{fontFamily:font,fontSize:18,wordWrap:{width:918,useAdvancedWrap:true}});
    const pages=paginateEntries(entries.map(e=>probe.getWrappedText(e.join('\n'))),17);probe.destroy();page=Math.max(0,Math.min(page,pages.length-1));
    this.text(c,38,141,pages[page],18,C.ink);
    this.button(c,38,594,135,40,'‹ 上一页',()=>this.resolve(page-1),{enabled:page>0,size:17});
    this.button(c,188,594,135,40,'下一页 ›',()=>this.resolve(page+1),{enabled:page<pages.length-1,size:17});
    this.text(c,960,603,`${page+1} / ${pages.length} · 派遣与代价`,17,C.ink).setOrigin(1,0);
    this.text(c,38,654,exile?'目标会永久离船。结算一过，不能撤回。':v.mode==='live'?'真实模型将开始处理；结果回来前不能重复提交。':'固定策略演练 · 不调用模型',exile?20:17,exile?C.red:0x745f43,924);
    this.button(c,38,716,200,48,'继续布牌',()=>this.closeModal());this.button(c,686,716,276,48,exile?'确认让他离船':'提交并执行',()=>{this.closeModal(false);this.audioFx.play('resolve');void store.act('resolve');},{danger:!!exile,size:22});this.finishModal();
  }
  logPages(entries:LogEntry[],width:number,height:number){
    const probe=this.add.text(0,0,'',{fontFamily:font,wordWrap:{width,useAdvancedWrap:true}});
    const pages=layoutLogEntries(entries,width,height,(value,size,limit)=>{if(!value)return [];probe.setFontSize(size).setFontStyle(size===24?'bold':'normal').setWordWrapWidth(limit,true);return probe.getWrappedText(value);});
    probe.destroy();return pages;
  }
  resourceStrip(c:Phaser.GameObjects.Container,x:number,y:number,width:number){
    const v=store.view!,keys=['oxygen','power','supplies'],labels=['氧气','电力','物资'],w=(width-24)/3;
    keys.forEach((key,i)=>{const left=x+i*(w+12),g=this.add.graphics();g.fillStyle(C.navy,.94).fillRoundedRect(left,y,w,78,6).lineStyle(1,C.edge,.7).strokeRoundedRect(left,y,w,78,6);c.add(g);this.icon(c,left+29,y+38,`res-${key}`,30,C.cyan);this.text(c,left+55,y+17,labels[i],20,C.light);this.text(c,left+55,y+43,resourceNames[key],13,C.muted);this.text(c,left+w-21,y+20,String(v.state.resources[key]),33,v.state.resources[key]<25?0xffa68d:C.light).setOrigin(1,0);});
    this.modalContent.push(`航程储备：氧气 ${v.state.resources.oxygen}，电力 ${v.state.resources.power}，物资 ${v.state.resources.supplies}。`);
  }
  resourceChanges(c:Phaser.GameObjects.Container,x:number,y:number,delta:Record<string,number>,width=150){
    const changes=['oxygen','power','supplies'].filter(k=>delta[k]).map(k=>[k,delta[k]] as [string,number]);
    changes.forEach(([key,n],i)=>{const left=x+i*(width+8),ink=n>0?C.green:C.red,g=this.add.graphics();g.fillStyle(ink,.09).fillRoundedRect(left,y,width,32,4).lineStyle(1,ink,.3).strokeRoundedRect(left,y,width,32,4);c.add(g);this.icon(c,left+20,y+16,`res-${key}`,20,ink);this.text(c,left+39,y+7,`${resourceNames[key]} ${n>0?'+':''}${n}`,17,ink).setFontStyle('bold');});
  }
  logCards(c:Phaser.GameObjects.Container,cards:LogCard[],x:number,y:number,width:number){
    for(const e of cards){const g=this.add.graphics();g.fillStyle(0xfff8e6,.24).fillRoundedRect(x,y,width,e.height,6).lineStyle(1,0xad8a55,.6).strokeRoundedRect(x,y,width,e.height,6);g.fillStyle(e.warning?C.red:C.edge,.7).fillRoundedRect(x,y,4,e.height,2);c.add(g);
      let cy=y+16;this.text(c,x+20,cy,e.heading.join('\n'),24,C.ink).setFontStyle('bold');if(e.continued)this.text(c,x+width-22,cy+4,'续',15,0x796449).setOrigin(1,0);cy+=e.heading.length*30;
      if(e.meta){this.text(c,x+20,cy,e.meta,18,0x776449);cy+=e.meta.split('\n').length*24;}
      if(e.warning){this.text(c,x+20,cy+3,e.warning,18,C.red);cy+=34;}
      if(e.body.length){this.text(c,x+20,cy+3,e.body.join('\n'),20,0x5d523f);cy+=e.body.length*28;}
      if(e.people){this.text(c,x+20,cy+4,'接触范围',16,0x796449);cy+=30;const cols=Math.max(1,Math.floor((width-40)/166)),chipW=(width-40-(cols-1)*8)/cols;
        const people=e.people.length?e.people:[''];people.forEach((id,i)=>{const left=x+20+(i%cols)*(chipW+8),top=cy+Math.floor(i/cols)*36,chip=this.add.graphics();chip.fillStyle(0xdbc9a5,.55).fillRoundedRect(left,top,chipW,29,4).lineStyle(1,0xac9367,.35).strokeRoundedRect(left,top,chipW,29,4);c.add(chip);if(id&&store.view!.crew.some(k=>k.id===id))this.icon(c,left+16,top+14,`chip-${id}`,26);this.text(c,left+(id?33:10),top+6,id?crewLabel(id,store.view!):'无人',18,C.ink);});
        cy+=Math.max(1,Math.ceil(people.length/cols))*36;
      }
      if(e.delta&&Object.values(e.delta).some(n=>n)){this.resourceChanges(c,x+20,cy+5,e.delta);cy+=44;}
      if(e.factIds?.length){this.button(c,x+20,cy+4,226,34,`查看 ${e.factIds.length} 条操作痕迹 ›`,()=>{this.archiveEvidence=true;this.openArchives(e.factIds![0]);},{size:16,icon:'evidence',a11y:`查看${e.title}的 ${e.factIds.length} 条操作痕迹`});}
      this.modalContent.push([e.title,e.continued?'续':'',e.meta,e.warning,...e.body,e.people?`接触范围：${e.people.map(id=>crewLabel(id,store.view!)).join('、')||'无人'}`:'',e.delta?Object.entries(e.delta).filter(([,n])=>n).map(([k,n])=>`${resourceNames[k]} ${n>0?'+':''}${n}`).join('；'):''].filter(Boolean).join('；'));
      y+=e.height+12;
    }
  }
  openReport(actor?:string){const v=store.view!,ending=v.state.ending,c=this.beginModal(ending?ending.title:`第 ${v.state.day} 日 · 航程报告`,1140,840);
    this.resourceStrip(c,38,94,1064);
    let pages:{r?:Report;cards:LogCard[]}[];
    if(ending){const entries:LogEntry[]=[{key:'ending',title:'航程结果',meta:'',lines:[ending.text]},...ending.history.map((h,i)=>({key:`hidden-${i}`,title:'隐藏操作',meta:`第 ${h.day} 日`,lines:[h.text]})),...ending.missed.map((m,i)=>m.fact?factEntry(m.fact,v):{key:`missed-${i}`,title:'未公开记录',meta:m.owner,lines:[m.text||'']})];pages=this.logPages(entries,808,500).map(cards=>({cards}));}
    else{pages=v.results.flatMap(r=>this.logPages(reportEntries(r,v),808,500).map(cards=>({r,cards})));
      const fixed=`第${v.state.day}日结束。O₂ ${v.state.resources.oxygen} / PWR ${v.state.resources.power} / SUP ${v.state.resources.supplies}。`;
      if(v.roundSummary&&v.roundSummary!==fixed)pages.unshift(...this.logPages([{key:'summary',title:'船况简报',meta:`第 ${v.state.day} 日`,lines:[v.roundSummary]}],808,500).map(cards=>({cards})));
      if(!pages.length)pages=[{cards:[]}];
    }
    if(actor)this.reportIndex=Math.max(0,pages.findIndex(p=>p.r?.actor===actor));this.reportIndex=Math.max(0,Math.min(this.reportIndex,pages.length-1));const page=pages[this.reportIndex],r=page.r;
    const rail=this.add.graphics();rail.fillStyle(0x7c6440,.08).fillRoundedRect(38,210,232,500,6);c.add(rail);
    if(r){const crew=v.crew.find(k=>k.id===r.actor),a=v.plan.find(a=>a.actor===r.actor),slot=a&&v.slots.find(s=>s.id===a.slot);this.portrait(c,54,228,r.actor,200,170);this.text(c,54,416,crew?`${crew.role} · ${crew.name}`:r.actor,24,C.ink,200).setFontStyle('bold');this.text(c,54,458,slot?assignmentTitle(slot,a):r.title,20,0x776449,200);
      this.text(c,54,538,'本次资源变化',16,0x796449);const delta=Object.entries(r.delta).filter(([,n])=>n);if(!delta.length)this.text(c,54,571,'无直接变化',18,0x776449);else delta.forEach(([key,n],i)=>this.resourceChanges(c,54,568+i*42,{[key]:n},200));
      this.modalContent.push(`${crewLabel(r.actor,v)}；${slot?assignmentTitle(slot,a):r.title}；本次资源变化：${delta.map(([k,n])=>`${resourceNames[k]} ${n>0?'+':''}${n}`).join('，')||'无直接变化'}`);
    }else{this.icon(c,154,274,ending?'airlock':'evidence',64,C.edge);this.text(c,54,336,ending?'航程结束':'本日船况',24,C.ink,200).setFontStyle('bold');if(ending){this.text(c,54,396,'拟态宿主',15,0x796449);this.text(c,54,425,ending.host,20,C.red,200);this.text(c,54,497,`幸存 ${ending.survivors} 人`,22,C.ink);this.modalContent.push(`拟态宿主：${ending.host}；幸存 ${ending.survivors} 人。`);}else this.text(c,54,393,`派遣 ${v.results.length} 人\n公开痕迹 ${v.evidence.filter(f=>f.revealedDay===v.state.day).length} 条`,18,0x776449,200);}
    if(page.cards.length)this.logCards(c,page.cards,294,210,808);else this.text(c,322,263,r?'本次没有新增回报。':'本日未派遣船员。',23,0x796449);
    this.text(c,570,724,`${this.reportIndex+1} / ${pages.length}`,17,0x77624a).setOrigin(.5);
    this.button(c,38,769,140,43,'‹ 上一页',()=>{this.reportIndex--;this.openReport();},{enabled:this.reportIndex>0});this.button(c,190,769,140,43,'下一页 ›',()=>{this.reportIndex++;this.openReport();},{enabled:this.reportIndex<pages.length-1});this.button(c,352,769,224,43,'查看航程记录',()=>{this.archivePage=0;this.openArchives();});
    if(ending)this.button(c,866,761,236,51,'开启新航程',()=>this.openMenu(),{size:21});else this.button(c,866,761,236,51,'开始下一日 →',()=>{this.closeModal(false);void store.act('next');},{size:21});this.finishModal();
  }
  openArchives(focusId?:string){const v=store.view!,c=this.beginModal('航程记录',1140,840);
    this.button(c,38,94,200,42,'派遣与船况',()=>{this.archiveEvidence=false;this.archivePage=0;this.openArchives();},{paper:!this.archiveEvidence,size:19});this.button(c,254,94,232,42,`操作痕迹 · ${v.evidence.length}`,()=>{this.archiveEvidence=true;this.archivePage=0;this.openArchives();},{paper:this.archiveEvidence,size:19});
    const entries=this.archiveEvidence?[...v.evidence].reverse().map(f=>factEntry(f,v)):archiveEntries(v);const pages=this.logPages(entries,1064,550);
    if(focusId){const target=pages.findIndex(page=>page.some(e=>e.key===focusId));if(target>=0)this.archivePage=target;}
    this.archivePage=Math.max(0,Math.min(this.archivePage,pages.length-1));this.text(c,1102,106,`${entries.length} 条记录`,16,0x776449).setOrigin(1,0);
    if(entries.length)this.logCards(c,pages[this.archivePage],38,158,1064);else{this.icon(c,570,319,'evidence',64,C.edge);this.text(c,570,398,this.archiveEvidence?'尚无已公开的操作痕迹。':'尚无航程记录。',23,0x796449).setOrigin(.5);}
    this.text(c,570,728,`${this.archivePage+1} / ${pages.length}`,18,0x776449).setOrigin(.5);this.button(c,38,769,151,43,'‹ 上一页',()=>{this.archivePage--;this.openArchives();},{enabled:this.archivePage>0});this.button(c,205,769,151,43,'下一页 ›',()=>{this.archivePage++;this.openArchives();},{enabled:this.archivePage<pages.length-1});
    this.button(c,866,761,236,51,'导出公开记录',()=>{const a=document.createElement('a');a.href=`/api/recording?id=${v.id}`;a.download=`guysfall-${v.id}-public.json`;a.click();},{size:20});this.finishModal();
  }
  openMenu(){const v=store.view;const c=this.beginModal('最后指令号 / 航程菜单',760,614);this.text(c,40,99,'七日寄生',44,C.ink).setFontStyle('bold');this.text(c,40,166,'八名船员，一个拟态体。\n把人派出去，把后果带回来。',23,0x766048,678);
    this.button(c,40,263,325,68,'开始固定策略航程',()=>{this.closeModal(false);void store.newGame('fixture');},{enabled:!store.busy&&v?.status!=='running',size:23});this.button(c,388,263,332,68,'开始真实模型航程',()=>{this.closeModal(false);void store.newGame('live');},{enabled:!!store.config?.liveReady&&!store.busy&&v?.status!=='running',size:23});
    this.text(c,40,352,store.config?.liveReady?`真实模式：${store.config.model}\n新航程会保留旧存档，并切换当前航程。`:'尚未配置真实模型。固定策略演练可完整试玩七天。\n开始新航程会保留旧存档，并切换当前航程。',17,0x756148,676);
    this.button(c,40,442,214,45,'怎么操作',()=>this.openHelp());this.button(c,273,442,214,45,'清空今日安排',()=>{this.closeModal(false);store.edit([]);this.paint();},{enabled:store.editable});this.button(c,506,442,214,45,'看今天的结果',()=>{this.reportIndex=0;this.openReport();},{enabled:!!v&&v.state.phase!=='planning'});this.text(c,40,537,`${v?.mode==='live'?'真实模型':'固定策略演练'}  ·  本地自动保存  ·  ESC 关闭面板`,17,0x756148);this.finishModal();
  }
  openHelp(){const c=this.beginModal('操作说明',800,624);this.text(c,42,108,`01  点选或拖动船员，安排到事件、系统、谈话区或气闸。\n      系统可选维护或调查；调查核对往日痕迹，不恢复资源。\n\n02  亲临花 ${store.view?.rules.supervisionCost??2} 点精力，阻止该系统本日的隐藏干扰。\n      船员改派后，接触范围随任务变动。\n\n03  日结后看报告，航程记录中可翻阅操作痕迹。\n      谈话可确认船员本人往日的普通领用。\n\n04  撑过七天，或根据多日痕迹放逐宿主。\n      放逐错人会永久失去一名船员。`,22,C.ink,714);this.text(c,42,520,'船员和牌都能拖动，也可以点选。休班船员要带调遣令才能上岗。\nESC 关闭面板 · M 开关声音 · 横屏体验更好。',18,0x756148,714);this.finishModal();}
  syncAccess(){const root=document.getElementById('accessible')!;root.replaceChildren();const v=store.view;const status=document.createElement('p');status.setAttribute('role','status');status.textContent=v?`第${v.state.day}日 ${v.state.phase==='planning'?'安排中':v.state.phase==='review'?'日结':'已结束'}；氧气${v.state.resources.oxygen} 电力${v.state.resources.power} 物资${v.state.resources.supplies}；已安排${store.plan.length}人；${store.message}`:store.message||'加载中';root.append(status);if(this.modalOpen)for(const value of this.modalContent){const p=document.createElement('p');p.textContent=value;root.append(p);}for(const a of this.modalOpen?this.modalActions:this.actions){const b=document.createElement('button');b.textContent=a.label;b.disabled=!a.enabled;b.onclick=()=>{this.audioFx.play('pick');a.fn();};root.append(b);}}
}
new Phaser.Game({type:Phaser.AUTO,parent:'game',width:W,height:H,backgroundColor:'#0b151e',antialias:true,scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH},render:{roundPixels:false},input:{activePointers:2},scene:DeskScene,audio:{noAudio:true},banner:false});
