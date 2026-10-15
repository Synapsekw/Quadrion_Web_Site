import * as THREE from './vendor/three.module.js';
import { createQuoriModel, createStudio } from './model.js';
import { createMotion } from './motion.mjs';

const mounts=new WeakMap();
export function createQuori(host,{compact=false,interactive=true,onError=()=>{}}={}){
  if(mounts.has(host))return mounts.get(host);
  const motion=createMotion(),canvas=document.createElement('canvas');
  canvas.className='quori-canvas';canvas.setAttribute('aria-hidden','true');
  let renderer,scene,camera,model,environment,shadow,shadowTexture,floorGlow,aura,glowTexture,underlight;
  let destroyed=false,lost=false,ready=false,enabled=true,visible=true,intersecting=true;
  let width=0,height=0,frame=0,last=0,drawTime=0,frames=0,lookX=0,lookY=0,mx=0,my=0,yaw=0,pitch=0,dragYaw=0,dragPitch=0,drag=null;
  let heldPose=motion.tick(0,false);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),offs=[];
  const on=(target,type,fn,opts)=>{target.addEventListener(type,fn,opts);offs.push(()=>target.removeEventListener(type,fn,opts));};
  const isVisible=()=>visible&&intersecting&&!document.hidden&&width>0&&height>0;
  const moving=()=>enabled&&!reduced.matches;
  const running=()=>!destroyed&&!lost&&ready&&isVisible()&&moving();
  function draw(dt=0){
    if(!ready||lost||destroyed||!isVisible())return;
    const animate=moving();
    heldPose=animate?motion.tick(dt):reduced.matches?motion.tick(0,false):motion.tick(0);
    const ease=dt?1-Math.exp(-dt*8):reduced.matches?1:0;
    lookX+=(animate?mx-lookX:-lookX)*ease;lookY+=(animate?my-lookY:-lookY)*ease;
    yaw+=((animate?dragYaw:0)-yaw)*ease;pitch+=((animate?dragPitch:0)-pitch)*ease;
    if(!drag){dragYaw*=Math.exp(-dt*3.2);dragPitch*=Math.exp(-dt*3.2);}
    model.update(heldPose,lookX,lookY,yaw,pitch);
    const h=Math.max(0,heldPose.y);
    shadow.scale.set(1-h*.35,1-h*.3,1);shadow.material.opacity=.6-h*.45;
    // Keep the light on the ground as he rises, with a softer, wider pool.
    const warmth=heldPose.glow*(1+Math.max(0,heldPose.smile)*.10);
    floorGlow.scale.set(1+h*.28,1+h*.18,1);
    floorGlow.material.opacity=(.74-h*.4)*warmth;
    floorGlow.position.x=heldPose.x*.35;
    aura.material.opacity=.15*warmth;
    aura.position.set(heldPose.x*.5,heldPose.y+.10,-1.35);
    underlight.intensity=1.5*warmth;
    renderer.render(scene,camera);frames++;
    host.dataset.gesture=motion.status().gesture||'';
  }
  function tick(now){
    frame=0;if(!running())return;
    const dt=last?Math.min(.1,(now-last)/1000):1/60;last=now;drawTime+=dt;
    if(!compact||drawTime>=1/30){draw(drawTime);drawTime=0;}
    frame=requestAnimationFrame(tick);
  }
  function sync(){
    cancelAnimationFrame(frame);frame=0;last=0;drawTime=0;
    if(destroyed)return;
    host.dataset.motion=running()?'running':'paused';
    if(running())frame=requestAnimationFrame(tick);else draw();
  }
  function resize(){
    if(destroyed)return;
    const r=host.getBoundingClientRect();width=Math.round(r.width);height=Math.round(r.height);
    if(renderer&&width&&height){
      renderer.setSize(width,height,false);
      const aspect=width/height;camera.aspect=aspect;
      camera.position.z=7.2*Math.max(1,1/aspect);camera.updateProjectionMatrix();
    }
    sync();
  }
  function fallback(error){ready=false;host.dataset.renderer='fallback';sync();onError(error);}
  const api={
    setState(state){if(destroyed)return;motion.setState(state);if(!moving())heldPose=motion.tick(0,false);host.dataset.state=motion.status().state;draw(0);},
    play(name){if(destroyed||!moving())return;motion.play(name);host.dataset.gesture=motion.status().gesture||'';},
    setMotion(value){if(destroyed)return;enabled=!!value;if(!moving()){drag=null;dragYaw=dragPitch=mx=my=0;}sync();},
    setVisible(value){if(destroyed)return;visible=!!value;sync();},
    getStatus(){return {...motion.status(),frames,renderer:host.dataset.renderer,motion:host.dataset.motion,destroyed};},
    destroy(){
      if(destroyed)return;destroyed=true;cancelAnimationFrame(frame);ro.disconnect();io.disconnect();offs.forEach(fn=>fn());
      model?.dispose();environment?.dispose();shadow?.geometry.dispose();shadow?.material.dispose();shadowTexture?.dispose();
      floorGlow?.geometry.dispose();floorGlow?.material.dispose();aura?.material.dispose();glowTexture?.dispose();
      renderer?.dispose();renderer?.forceContextLoss();canvas.remove();mounts.delete(host);
    },
  };
  mounts.set(host,api);host.dataset.renderer='loading';host.dataset.state='idle';host.append(canvas);
  const ro=new ResizeObserver(resize),io=new IntersectionObserver(entries=>{intersecting=entries[0].isIntersecting;sync();});
  ro.observe(host);io.observe(host);on(document,'visibilitychange',sync);on(reduced,'change',sync);
  try{
    renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:compact?'low-power':'high-performance'});
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
    renderer.setClearColor(0x000000,0);
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(32,1,.1,30);camera.position.set(0,.08,7.2);
    environment=createStudio(renderer);scene.environment=environment.texture;
    scene.add(new THREE.HemisphereLight(0xeef2f2,0x2b3738,.8));
    const key=new THREE.DirectionalLight(0xfffaf2,1.4);key.position.set(-3,5,5);scene.add(key);
    const fill=new THREE.DirectionalLight(0xe6f5f0,.65);fill.position.set(4,1,3);scene.add(fill);
    const rim=new THREE.DirectionalLight(0xa2f5dc,1.7);rim.position.set(3,1,-3);scene.add(rim);
    underlight=new THREE.PointLight(0x79e4c2,1.5,7,1.3);underlight.position.set(.6,-2,1.6);scene.add(underlight);
    model=createQuoriModel({compact});scene.add(model.root);
    const sc=document.createElement('canvas');sc.width=256;sc.height=64;const ctx=sc.getContext('2d');ctx.scale(1,.25);
    const gradient=ctx.createRadialGradient(128,128,0,128,128,128);gradient.addColorStop(0,'rgba(0,0,0,.85)');gradient.addColorStop(.3,'rgba(0,0,0,.5)');gradient.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,256,256);
    shadowTexture=new THREE.CanvasTexture(sc);shadow=new THREE.Mesh(new THREE.PlaneGeometry(3,.38),new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false,opacity:.6}));shadow.position.set(0,-1.86,-1);scene.add(shadow);
    const gc=document.createElement('canvas');gc.width=gc.height=256;const gx=gc.getContext('2d');
    const light=gx.createRadialGradient(128,128,0,128,128,128);
    light.addColorStop(0,'rgba(160,255,222,.9)');light.addColorStop(.16,'rgba(104,232,192,.7)');light.addColorStop(.44,'rgba(77,206,169,.28)');light.addColorStop(.72,'rgba(67,177,151,.07)');light.addColorStop(1,'rgba(67,177,151,0)');
    gx.fillStyle=light;gx.fillRect(0,0,256,256);glowTexture=new THREE.CanvasTexture(gc);glowTexture.colorSpace=THREE.SRGBColorSpace;
    floorGlow=new THREE.Mesh(new THREE.PlaneGeometry(3.65,.70),new THREE.MeshBasicMaterial({map:glowTexture,transparent:true,depthWrite:false,toneMapped:false,opacity:.74}));
    floorGlow.position.set(0,-1.82,-.85);scene.add(floorGlow);
    aura=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture,transparent:true,depthWrite:false,toneMapped:false,opacity:.15}));
    aura.position.set(0,.1,-1.35);aura.scale.set(4.8,4.8,1);scene.add(aura);
    on(canvas,'webglcontextlost',e=>{e.preventDefault();lost=true;host.dataset.renderer='fallback';sync();});
    on(canvas,'webglcontextrestored',()=>{if(destroyed)return;try{environment.dispose();environment=createStudio(renderer);scene.environment=environment.texture;lost=false;host.dataset.renderer='webgl';resize();}catch(error){fallback(error);}});
    if(interactive){
      on(host,'pointermove',e=>{
        if(!moving())return;const r=host.getBoundingClientRect();
        if(e.pointerType!=='touch'){mx=Math.max(-1,Math.min(1,((e.clientX-r.left)/r.width-.5)*2));my=Math.max(-1,Math.min(1,(.5-(e.clientY-r.top)/r.height)*2));}
        if(drag&&e.pointerId===drag.id){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.moved ||=Math.hypot(dx,dy)>5;dragYaw=Math.max(-1.1,Math.min(1.1,drag.yaw+dx*.005));dragPitch=Math.max(-.55,Math.min(.55,drag.pitch+dy*.004));}
      });
      on(host,'pointerleave',()=>{mx=my=0;});
      on(host,'pointerdown',e=>{if(!moving()||drag||e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,yaw:dragYaw,pitch:dragPitch,moved:false};host.setPointerCapture(e.pointerId);host.classList.add('is-dragging');});
      const release=e=>{if(!drag||drag.id!==e.pointerId)return;const clicked=!drag.moved;drag=null;host.classList.remove('is-dragging');if(host.hasPointerCapture(e.pointerId))host.releasePointerCapture(e.pointerId);if(clicked&&e.type==='pointerup')api.play('hello');};
      on(host,'pointerup',release);on(host,'pointercancel',release);on(host,'lostpointercapture',()=>{drag=null;host.classList.remove('is-dragging');});
      on(host,'keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();dragYaw=Math.max(-1,Math.min(1,dragYaw+(e.key==='ArrowLeft'?-.3:.3)));}if(e.key==='Enter'||e.key===' '){e.preventDefault();api.play('hello');}});
    }
    ready=true;host.dataset.renderer='webgl';resize();
  }catch(error){fallback(error);}
  return api;
}
