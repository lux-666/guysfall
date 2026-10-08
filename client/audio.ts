// Synthesized demo feedback. No network, no downloaded sound library.
export class DeskAudio {
  ctx?:AudioContext; muted=localStorage.getItem('guysfall-muted')==='true';
  toggle(){this.muted=!this.muted;localStorage.setItem('guysfall-muted',String(this.muted));if(!this.muted)this.play('pick');}
  play(kind:'pick'|'drop'|'error'|'resolve'|'reveal'){
    if(this.muted)return;
    try{this.ctx??=new AudioContext();void this.ctx.resume();const t=this.ctx.currentTime;
      const tones={pick:[520,720],drop:[240,140],error:[120,95],resolve:[180,270,360],reveal:[460,620,820]}[kind];
      tones.forEach((f,i)=>{const osc=this.ctx!.createOscillator(),gain=this.ctx!.createGain();osc.type=kind==='error'?'sawtooth':'sine';osc.frequency.setValueAtTime(f,t+i*.065);gain.gain.setValueAtTime(0,t+i*.065);gain.gain.linearRampToValueAtTime(.07,t+i*.065+.008);gain.gain.exponentialRampToValueAtTime(.001,t+i*.065+.13);osc.connect(gain).connect(this.ctx!.destination);osc.start(t+i*.065);osc.stop(t+i*.065+.15);});
    }catch{/* Audio is optional; the game remains playable without a device. */}
  }
}
