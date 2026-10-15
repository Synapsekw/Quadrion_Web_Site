const rest = Object.freeze({x:0,y:0,rx:0,ry:0,rz:0,spin:0,scale:1,open:0,tail:0,tailY:0,eyeL:1,eyeR:1,eyeWide:1,gazeX:0,gazeY:0,smile:.55,mouth:0,browL:0,browR:0,pupil:1,glow:1});
const expressions = {
  idle:{}, listening:{rz:.09,eyeWide:1.05,eyeL:1.12,eyeR:1.12,y:.035,open:.018,smile:.4},
  thinking:{rz:-.15,eyeL:.7,eyeR:.58,gazeX:.045,gazeY:.045,smile:.12,browL:.4,browR:.1},
  speaking:{smile:.5,mouth:.022,open:.01}, curious:{rz:-.2,eyeL:1.16,eyeR:.92,eyeWide:1.05,gazeX:.03,browL:.45,y:.03},
  focused:{eyeL:.65,eyeR:.65,smile:.08,rx:-.025,gazeY:-.015}, happy:{eyeL:.22,eyeR:.22,smile:1,y:.04,open:.025},
  concerned:{eyeL:.83,eyeR:.83,rz:.12,smile:-.35,browL:.5,browR:.5,y:-.02},
  surprised:{eyeL:1.2,eyeR:1.2,eyeWide:1.13,mouth:.09,smile:0,open:.07,y:.05,pupil:.72},
  sleepy:{eyeL:.35,eyeR:.42,rz:.12,smile:.16,gazeY:-.03,y:-.04},
  sleeping:{eyeL:.035,eyeR:.035,smile:.2,rz:.1,y:-.06,pupil:0},
};
const durations={hello:2.8,wink:1.5,nod:2,shake:2.1,laugh:2.7,celebrate:3.5,hop:2.2,spin:3.3,unfold:4.2,wake:2.6,shy:2.7,scan:3.6};
export const STATES=Object.freeze(Object.keys(expressions));
export const GESTURES=Object.freeze(Object.keys(durations));
export const GESTURE_DURATIONS=Object.freeze({...durations});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=v=>{v=clamp(v,0,1);return v*v*(3-2*v);};
const pulse=(t,at,width)=>t<at||t>at+width?0:Math.sin((t-at)/width*Math.PI)**2;
const wrap=v=>Math.atan2(Math.sin(v),Math.cos(v));

/** A deterministic active-time clock. Passing zero freezes; false gives a static pose. */
export function createMotion() {
  let state='idle',gesture=null,time=0,elapsed=0,current={...rest};
  function cancel(){gesture=null;elapsed=0;current.spin=wrap(current.spin);}
  return {
    setState(value){state=STATES.includes(value)?value:'idle';cancel();},
    play(value){cancel();if(GESTURES.includes(value))gesture=value;},
    status(){return {state,gesture,time,elapsed};},
    tick(delta=0,animated=true){
      const dt=Number.isFinite(delta)?clamp(delta,0,.1):0;
      const p={...rest,...expressions[state]};
      if(!animated){cancel();current={...p};return {...current};}
      if(!dt)return {...current};
      time+=dt;elapsed+=dt;
      p.y+=Math.sin(time*1.32)*.026;p.rz+=Math.sin(time*.75)*.012;
      p.tail+=Math.sin(time*1.1)*.014;
      const cycle=time%8.9;
      const blink=1-.975*Math.max(pulse(cycle,2.9,.17),pulse(cycle,7.15,.13),pulse(cycle,7.44,.14));
      p.eyeL*=blink;p.eyeR*=blink;
      if(state==='idle'){p.gazeX+=.025*Math.sin(time*.4);p.gazeY+=.012*Math.sin(time*.7);}
      if(state==='thinking'){p.gazeX+=Math.sin(time*1.2)*.018;p.tail+=Math.sin(time*2)*.08;p.glow=1+.13*Math.sin(time*2);}
      if(state==='speaking'){p.mouth=.014+(.5+.5*Math.sin(time*13))* (.022+.016*Math.sin(time*5)**2);p.rx+=Math.sin(time*3)*.016;}
      if(state==='sleeping'){p.y+=Math.sin(time*1.1)*.012;p.scale+=Math.sin(time*1.1)*.006;}
      if(gesture){
        const u=clamp(elapsed/durations[gesture],0,1),e=Math.sin(u*Math.PI)**2;
        switch(gesture){
          case 'hello':p.rz+=Math.sin(u*Math.PI*4)*e*.16;p.y+=e*.13;p.tail+=Math.sin(u*Math.PI*6)*e*.3;p.tailY=e*.08;p.smile=.8;break;
          case 'wink':p.eyeR*=1-.97*Math.sin(u*Math.PI)**2;p.rz-=e*.1;p.smile=.8;break;
          case 'nod':p.rx+=Math.sin(u*Math.PI*4)*e*.2;p.y-=Math.sin(u*Math.PI*4)*e*.035;break;
          case 'shake':p.ry+=Math.sin(u*Math.PI*4)*e*.28;p.smile=.15;break;
          case 'laugh':p.eyeL=p.eyeR=.12;p.smile=1;p.mouth=.05+Math.sin(u*Math.PI*10)**2*.045;p.y+=Math.abs(Math.sin(u*Math.PI*6))*e*.12;p.rz+=Math.sin(u*Math.PI*5)*e*.08;break;
          case 'celebrate':p.y+=Math.abs(Math.sin(u*Math.PI*3))*e*.24;p.rz+=Math.sin(u*Math.PI*6)*e*.19;p.open+=e*.13;p.tail+=Math.sin(u*Math.PI*8)*e*.4;p.eyeL=p.eyeR=.18;p.smile=1;break;
          case 'hop':p.y+=e*.42;p.scale-=pulse(u,0,.2)*.035;p.rx-=e*.07;break;
          case 'spin':p.spin=smooth(u)*Math.PI*2;p.y+=e*.23;p.rz+=e*.07;break;
          case 'unfold':p.open+=e*.32;p.tail+=e*.42;p.tailY+=e*.12;p.y+=e*.09;p.eyeL=p.eyeR=1.1;p.smile=.7;break;
          case 'wake':p.eyeL=p.eyeR=.05+.95*smooth(u*2);p.y+=e*.15;p.open+=e*.085;p.rx-=e*.12;p.smile=.8;break;
          case 'shy':p.ry-=e*.22;p.rz+=e*.18;p.gazeX-=e*.055;p.gazeY-=e*.035;p.eyeL*=1-e*.25;p.eyeR*=1-e*.25;p.smile=.65;break;
          case 'scan':p.gazeX+=Math.sin(u*Math.PI*2)*e*.11;p.ry+=Math.sin(u*Math.PI*2)*e*.22;p.gazeY+=Math.cos(u*Math.PI*2)*e*.04;p.tail+=e*.12;break;
        }
        if(u>=1){if(gesture==='spin'){current.spin-=Math.PI*2;p.spin=0;}gesture=null;elapsed=0;}
      }
      const blend=1-Math.exp(-dt*12);
      for(const key in current){const speed=key==='eyeL'||key==='eyeR'?1-Math.exp(-dt*32):blend;current[key]+=(p[key]-current[key])*speed;}
      return {...current};
    },
  };
}
