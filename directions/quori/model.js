import * as THREE from './vendor/three.module.js';

function quarterShape(start) {
  // A densely sampled, indexed surface keeps the broad curved faces smooth.
  // Triangulating an extruded annulus produces long, visibly flat triangles.
  const mid=1.20,halfU=(Math.PI/4-.027)*mid,halfV=.28;
  const vertices=[],indices=[];
  function boundary(inset){
    const hu=halfU-inset,hv=halfV-inset,r=.055-inset*.35,out=[];
    for(let corner=0;corner<4;corner++){
      const centers=[[hu-r,hv-r],[-hu+r,hv-r],[-hu+r,-hv+r],[hu-r,-hv+r]];
      const [cx,cy]=centers[corner],a=corner*Math.PI/2;
      for(let k=0;k<12;k++){const q=a+k/12*Math.PI/2;out.push([cx+r*Math.cos(q),cy+r*Math.sin(q)]);}
      const end=[cx+r*Math.cos(a+Math.PI/2),cy+r*Math.sin(a+Math.PI/2)];
      const [nx,ny]=centers[(corner+1)%4],next=[nx+r*Math.cos(a+Math.PI/2),ny+r*Math.sin(a+Math.PI/2)];
      for(let k=0;k<24;k++){const t=k/24;out.push([end[0]+(next[0]-end[0])*t,end[1]+(next[1]-end[1])*t]);}
    }
    return out;
  }
  function vertex(u,v,z){const a=start+Math.PI/4+u/mid,r=mid+v;vertices.push(Math.cos(a)*r,Math.sin(a)*r,z+.04+.27*(1-r*r/2.25));return vertices.length/3-1;}
  const N=144;
  const ring=(inset,z,q=1)=>boundary(inset).map(([u,v])=>vertex(u*q,v*q,z));
  const stitch=(a,b,flip=false)=>{for(let i=0;i<N;i++){const n=(i+1)%N;if(flip)indices.push(a[i],b[n],b[i],a[i],a[n],b[n]);else indices.push(a[i],b[i],b[n],a[i],b[n],a[n]);}};
  let prev=null;
  for(let k=0;k<=10;k++){
    const a=k/10*Math.PI/2;
    const curr=ring(.04*(1-Math.sin(a)),.14+.04*Math.cos(a));
    if(prev)stitch(prev,curr);prev=curr;
  }
  const side=ring(0,-.10);stitch(prev,side);prev=side;
  for(let k=1;k<=10;k++){
    const a=k/10*Math.PI/2,curr=ring(.04*(1-Math.cos(a)),-.10-.04*Math.sin(a));stitch(prev,curr);prev=curr;
  }
  function cap(z,flip){
    let prev=ring(.04,z),last;
    for(let k=23;k>=1;k--){last=ring(.04,z,k/24);stitch(prev,last,flip);prev=last;}
    const c=vertex(0,0,z);for(let i=0;i<N;i++){if(flip)indices.push(prev[i],prev[(i+1)%N],c);else indices.push(prev[i],c,prev[(i+1)%N]);}
  }
  cap(.18,true);cap(-.14,false);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();return g;
}
function roundedTile(size=.83,r=.075) {
  const h=size/2,s=new THREE.Shape();
  s.moveTo(-h+r,-h);s.lineTo(h-r,-h);s.quadraticCurveTo(h,-h,h,-h+r);
  s.lineTo(h,h-r);s.quadraticCurveTo(h,h,h-r,h);s.lineTo(-h+r,h);s.quadraticCurveTo(-h,h,-h,h-r);
  s.lineTo(-h,-h+r);s.quadraticCurveTo(-h,-h,-h+r,-h);
  const g=new THREE.ExtrudeGeometry(s,{depth:.23,bevelEnabled:true,bevelSegments:6,bevelSize:.045,bevelThickness:.055,curveSegments:12});
  g.translate(0,0,-.115);return g;
}
const faceZ=(x,y)=>Math.sqrt(Math.max(.015,1.03**2-x*x-(y/1.025)**2))*.79;

function createFace(compact) {
  const size=compact?256:512,canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d'),tex=new THREE.CanvasTexture(canvas);
  tex.colorSpace=THREE.SRGBColorSpace;tex.generateMipmaps=false;tex.minFilter=THREE.LinearFilter;
  const g=new THREE.PlaneGeometry(1.9,1.9,36,36),p=g.attributes.position;
  for(let i=0;i<p.count;i++)p.setZ(i,faceZ(p.getX(i),p.getY(i))+.012);
  g.computeVertexNormals();
  const material=new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-1});
  const mesh=new THREE.Mesh(g,material);mesh.renderOrder=3;
  const ellipse=(x,y,rx,ry)=>{ctx.beginPath();ctx.ellipse(x,y,rx,Math.max(.002,ry),0,0,Math.PI*2);};
  function draw(p,lookX=0,lookY=0){
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,size,size);ctx.setTransform(size/1.9,0,0,-size/1.9,size/2,size/2);
    for(const side of [-1,1]){
      const eye=side<0?p.eyeL:p.eyeR;
      const x=side*.345+p.gazeX+lookX*.026,y=.13+p.gazeY+lookY*.019;
      const rx=.182*p.eyeWide,ry=.278*eye;
      const glow=ctx.createRadialGradient(x,y,.035,x,y,.36);
      glow.addColorStop(0,`rgba(255,231,190,${.27*p.glow})`);glow.addColorStop(.55,'rgba(255,220,170,.085)');glow.addColorStop(1,'rgba(255,210,150,0)');
      ctx.save();ctx.translate(x,y);ctx.scale(1,1.25);ctx.fillStyle=glow;ctx.translate(-x,-y);ctx.fillRect(x-.4,y-.4,.8,.8);ctx.restore();
      if(p.smile>.85&&eye<.32){
        ctx.strokeStyle='#fff1d9';ctx.lineWidth=.022;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x-rx,y-.015);ctx.quadraticCurveTo(x,y+.13,x+rx,y-.015);ctx.stroke();continue;
      }
      ellipse(x,y,rx+.016,ry+.013);ctx.fillStyle='rgba(197,157,109,.5)';ctx.fill();
      ellipse(x,y,rx,ry);ctx.fillStyle='#fff3df';ctx.fill();
      if(eye>.16&&p.pupil>.05){
        ctx.save();ellipse(x,y,rx,ry);ctx.clip();
        const px=x-rx*.22+(lookX*.035+p.gazeX*.4),py=y+ry*.06+lookY*.015;
        ellipse(px,py,rx*.68*p.pupil,ry*.81);const iris=ctx.createLinearGradient(px-rx,py,px+rx,py);iris.addColorStop(0,'#152322');iris.addColorStop(1,'#3c534b');ctx.fillStyle=iris;ctx.fill();
        ellipse(px-rx*.14,py+ry*.39,rx*.26,ry*.17);ctx.fillStyle='#e6fff6';ctx.fill();
        ellipse(px+rx*.30,py-ry*.25,rx*.12,ry*.075);ctx.fillStyle='#91dfc9';ctx.fill();
        ctx.restore();
      }
      const brow=side<0?p.browL:p.browR;
      if(brow>.04){ctx.globalAlpha=brow*.8;ctx.strokeStyle='#818b83';ctx.lineWidth=.012;ctx.beginPath();ctx.moveTo(x-rx*.8,y+.32);ctx.quadraticCurveTo(x,y+.37,x+rx*.8,y+.32);ctx.stroke();ctx.globalAlpha=1;}
    }
    // A very soft warmth below the eyes keeps the graphite face approachable.
    for(const side of [-1,1]){
      const x=side*.54,y=-.205,blush=ctx.createRadialGradient(x,y,0,x,y,.19);
      blush.addColorStop(0,`rgba(244,172,145,${.12+Math.max(0,p.smile)*.07})`);blush.addColorStop(1,'rgba(244,172,145,0)');
      ctx.fillStyle=blush;ctx.fillRect(x-.19,y-.19,.38,.38);
    }
    const y=-.31,half=.18+(p.smile*.025);
    ctx.strokeStyle='#fff0d4';ctx.fillStyle='#fff0d4';ctx.lineWidth=.013;ctx.lineCap='round';ctx.lineJoin='round';
    if(p.mouth>.011){
      ellipse(0,y,half*(p.smile>.8?.8:.58),p.mouth);ctx.fill();
      if(p.mouth>.045){ellipse(0,y+.008,half*.66,p.mouth*.65);ctx.fillStyle='#30362f';ctx.fill();}
    }else{ctx.beginPath();ctx.moveTo(-half,y);ctx.quadraticCurveTo(0,y-p.smile*.15,half,y);ctx.stroke();}
    tex.needsUpdate=true;
  }
  return {mesh,draw,texture:tex};
}

export function createQuoriModel({compact=false}={}){
  const root=new THREE.Group(),shell=new THREE.Group();shell.position.z=.13;root.add(shell);
  const coreMaterial=new THREE.MeshPhysicalMaterial({color:0x151d20,metalness:.2,roughness:.43,clearcoat:.15,clearcoatRoughness:.4,envMapIntensity:.48});
  const core=new THREE.Mesh(new THREE.SphereGeometry(1.03,compact?48:80,compact?32:60),coreMaterial);
  core.scale.set(1,1.025,.79);root.add(core);
  const pearl=new THREE.MeshPhysicalMaterial({color:0xd4d9d4,metalness:.42,roughness:.32,clearcoat:.38,clearcoatRoughness:.28,envMapIntensity:.85});
  const arcs=[0,Math.PI/2,Math.PI].map((start)=>{
    const mesh=new THREE.Mesh(quarterShape(start),pearl);shell.add(mesh);
    return {mesh,angle:start+Math.PI/4};
  });
  const mint=new THREE.MeshPhysicalMaterial({color:0x70d6b9,emissive:0x4acaa6,emissiveIntensity:.17,metalness:.35,roughness:.25,clearcoat:.65,clearcoatRoughness:.2,envMapIntensity:1.15});
  const tail=new THREE.Mesh(roundedTile(),mint);tail.position.set(.83,-.83,.37);tail.rotation.set(0,-.04,-.025);root.add(tail);
  const face=createFace(compact);root.add(face.mesh);
  function update(p,lookX=0,lookY=0,yaw=0,pitch=0){
    root.position.set(p.x,p.y+.08,0);root.rotation.set(.055+p.rx-lookY*.035+pitch,-.25+p.ry+lookX*.07+yaw+p.spin,-.105+p.rz);
    root.scale.setScalar(p.scale);
    for(const {mesh,angle} of arcs){mesh.position.set(Math.cos(angle)*p.open,Math.sin(angle)*p.open,-p.open*.15);mesh.rotation.z=p.open*.045;}
    tail.position.set(.83+p.open*.7,-.83-p.open*.7+p.tailY,.37+p.open*.18);tail.rotation.z=-.025+p.tail;
    face.draw(p,lookX,lookY);
  }
  function dispose(){
    const gs=new Set(),ms=new Set();root.traverse(o=>{if(o.geometry)gs.add(o.geometry);if(o.material)ms.add(o.material);});
    gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());face.texture.dispose();
  }
  return {root,update,dispose};
}

/** Broad photographic softboxes give the pearl shell its sculptural reflections. */
export function createStudio(renderer){
  const studio=new THREE.Scene();studio.background=new THREE.Color(.12,.13,.14);
  const panel=(color,intensity,w,h,pos,at)=>{
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:new THREE.Color(color).multiplyScalar(intensity),side:THREE.DoubleSide}));
    m.position.set(...pos);m.lookAt(...at);studio.add(m);
  };
  panel(0xffffff,2.2,5,7,[-4,3,4],[0,0,0]);panel(0xffffff,1.3,2.5,6,[4,1,2],[0,0,0]);
  panel(0xffffff,2,5,3,[0,5,-1],[0,0,0]);panel(0xadc7bf,.5,4,2,[0,-3,3],[0,0,0]);
  const pmrem=new THREE.PMREMGenerator(renderer),target=pmrem.fromScene(studio,.04,.1,30);
  pmrem.dispose();studio.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});return target;
}
