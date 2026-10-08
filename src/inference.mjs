// ponytail: a calibrated suspicion heuristic, not a probability model or an optimal player.
// Only the player projection enters this function; prose, private memories and host identity never do.
export function infer(view,{threshold=.85,mode='weighted'}={}) {
  const alive=view.crew.filter(c=>c.alive).map(c=>c.id);
  const scores=Object.fromEntries(alive.map(id=>[id,0])),dates=Object.fromEntries(alive.map(id=>[id,new Set()]));
  const episodes=new Map(),conflicts=[];
  for(const fact of view.evidence) {
    if(!['sighting','access'].includes(fact.kind)||fact.window!=='aftermath')continue;
    const key=fact.incident||`${fact.day}:${fact.window}:${fact.location}`;
    const old=episodes.get(key);
    if(!old || fact.kind==='sighting'&&old.kind!=='sighting' || fact.kind===old.kind && fact.credibility>old.credibility)episodes.set(key,fact);
  }
  let intersection=new Set(alive);
  const episodeDays=new Set();
  for(const fact of episodes.values()) {
    const candidates=fact.suspects||fact.present;
    // A small admitted withdrawal accounts for that episode, but doesn't absolve its actor forever.
    const explained=fact.incident && view.evidence.some(e=>e.kind==='withdraw' && e.actor && e.amount<=3 && e.incident===fact.incident);
    if(explained)continue;
    if(fact.credibility>=2) {
      episodeDays.add(fact.day);
      intersection=new Set([...intersection].filter(id=>candidates.includes(id)));
    }
    const weight=fact.kind==='sighting'?(fact.credibility===2?1.25:1):fact.credibility===1?.2:.65;
    for(const id of alive) {
      scores[id]+=weight*(candidates.includes(id)?1.25:fact.credibility===1?0:-.25);
      if(candidates.includes(id))dates[id].add(fact.day);
    }
  }
  for(const claim of view.evidence.filter(e=>e.kind==='claim')) {
    if(!alive.includes(claim.subject))continue;
    const contradiction=view.evidence.find(e=>e.day===claim.day && e.window===claim.window && e.location!==claim.location &&
      (e.kind==='access' && e.present.includes(claim.subject) || e.kind==='sighting' && e.suspects.length===1 && e.suspects[0]===claim.subject));
    if(contradiction && !conflicts.some(c=>c.subject===claim.subject && c.day===claim.day && c.window===claim.window)) {
      conflicts.push({subject:claim.subject,day:claim.day,window:claim.window,claim:claim.id,evidence:contradiction.id,conclusive:contradiction.credibility===3});
      scores[claim.subject]+=contradiction.credibility===3?5:1.5;
      dates[claim.subject].add(claim.day);
    }
  }
  const max=Math.max(...Object.values(scores)),total=alive.reduce((n,id)=>n+Math.exp(scores[id]-max),0);
  const ranking=alive.map(id=>({id,score:scores[id],confidence:Math.exp(scores[id]-max)/total,days:dates[id].size})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  let target=null;
  if(mode==='intersection') {if(episodeDays.size>=2 && intersection.size===1)target=[...intersection][0];}
  else if(ranking[0]?.confidence>=threshold && (ranking[0].days>=3 || conflicts.some(c=>c.subject===ranking[0].id && c.conclusive)))target=ranking[0].id;
  return {target,ranking,conflicts,intersection:[...intersection]};
}
