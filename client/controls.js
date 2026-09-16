// Pointer Events support mouse, pen and simultaneous touch contacts without mouse capture.
export function bindControls({canvas,orbit,groundClick,interact,build,rotate,place,dismantle,zoom}) {
 document.documentElement.classList.toggle('touch-enabled',navigator.maxTouchPoints>0);
 const input={x:0,z:0,gather:false,sprint:false};
 const stick=document.getElementById('stick'),knob=document.getElementById('stickKnob');let stickId=null,look=null;
 function reset(){input.x=input.z=0;input.gather=false;stickId=null;look=null;knob.style.transform='translate(0,0)';}
 function update(e){const r=stick.getBoundingClientRect(),dx=e.clientX-r.left-r.width/2,dy=e.clientY-r.top-r.height/2,len=Math.hypot(dx,dy),scale=Math.min(1,40/(len||1));input.x=dx*scale/40;input.z=dy*scale/40;knob.style.transform=`translate(${dx*scale}px,${dy*scale}px)`;}
 stick.onpointerdown=e=>{if(stickId!==null)return;e.preventDefault();stickId=e.pointerId;stick.setPointerCapture(stickId);update(e);};
 stick.onpointermove=e=>{if(e.pointerId===stickId)update(e);};
 const stopStick=e=>{if(e.pointerId===stickId){input.x=input.z=0;stickId=null;knob.style.transform='translate(0,0)';}};
 stick.onpointerup=stopStick;stick.onpointercancel=stopStick;stick.onlostpointercapture=stopStick;
 const gather=document.getElementById('gatherAction');let gatherId=null;
 gather.onpointerdown=e=>{e.preventDefault();if(gatherId!==null)return;gatherId=e.pointerId;gather.setPointerCapture(e.pointerId);input.gather=true;interact();};
 const stopGather=e=>{if(e.pointerId===gatherId){input.gather=false;gatherId=null;}};gather.onpointerup=stopGather;gather.onpointercancel=stopGather;gather.onlostpointercapture=stopGather;
 document.getElementById('buildAction').onclick=build;document.getElementById('rotateAction').onclick=rotate;document.getElementById('placeAction').onclick=place;document.getElementById('removeAction').onclick=dismantle;
 document.getElementById('sprintAction').onclick=e=>{input.sprint=!input.sprint;e.currentTarget.setAttribute('aria-pressed',String(input.sprint));};
 document.getElementById('zoomIn').onclick=()=>zoom(-1);document.getElementById('zoomOut').onclick=()=>zoom(1);
 canvas.onpointerdown=e=>{if(look)return;look={id:e.pointerId,x:e.clientX,y:e.clientY,total:0,type:e.pointerType,button:e.button};canvas.setPointerCapture(e.pointerId);};
 canvas.onpointermove=e=>{if(!look||e.pointerId!==look.id)return;const dx=e.clientX-look.x,dy=e.clientY-look.y;look.total+=Math.abs(dx)+Math.abs(dy);look.x=e.clientX;look.y=e.clientY;if(look.total>5)orbit(dx,dy);};
 canvas.onpointerup=e=>{if(!look||e.pointerId!==look.id)return;const tap=look.total<6&&look.button===0;look=null;if(tap)groundClick(e.clientX,e.clientY);};
 canvas.onpointercancel=()=>look=null;canvas.onlostpointercapture=()=>look=null;canvas.oncontextmenu=e=>e.preventDefault();
 window.addEventListener('blur',reset);document.addEventListener('visibilitychange',()=>{if(document.hidden)reset();});
 return{input,reset};
}
