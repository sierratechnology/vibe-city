"""Original Vibe City field equipment and fauna, authored locally in Blender.
Coordinates passed to helpers use game metres, Y up and +Z forward.
No downloaded or generated third-party assets. Rebuild with Blender --background --python.
"""
import bpy, math, random, sys, os, json, hashlib
from mathutils import Vector
random.seed(7319)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
out=sys.argv[sys.argv.index('--')+1];os.makedirs(out,exist_ok=True)
COL={'ivory':(0.78,.82,.72,1),'teal':(.09,.26,.28,1),'dark':(.023,.054,.073,1),'coral':(.91,.32,.20,1),'mint':(.35,.95,.72,1),'gold':(.76,.48,.18,1),'moss':(.25,.46,.26,1),'violet':(.29,.22,.43,1),'blue':(.17,.55,.68,1)}
def mat(name,rough,metal,emission=False):
 m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;bs=n.get('Principled BSDF');bs.inputs['Roughness'].default_value=rough;bs.inputs['Metallic'].default_value=metal;vc=n.new('ShaderNodeVertexColor');vc.layer_name='Col';m.node_tree.links.new(vc.outputs['Color'],bs.inputs['Base Color'])
 if emission:m.node_tree.links.new(vc.outputs['Color'],bs.inputs['Emission Color']);bs.inputs['Emission Strength'].default_value=.7
 return m
BASE=mat('Field enamel / vertex palette',.58,.2);GLASS=mat('Obsidian glass',.19,.7);GLOW=mat('Luminous inlay',.35,.1,True)
def cv(p):return(p[0],-p[2],p[1])
def empty(name,parent=None,pos=(0,0,0)):
 o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.parent=parent;o.location=cv(pos);return o
def finish(o,parent,color='ivory',material=BASE):
 o.parent=parent;o.data.materials.clear();o.data.materials.append(material);layer=o.data.color_attributes.new(name='Col',type='FLOAT_COLOR',domain='CORNER');c=COL.get(color,color)
 for poly in o.data.polygons:
  for i in poly.loop_indices:layer.data[i].color=c
 return o
def cube(parent,pos,size,color='ivory',bevel=.04,material=BASE):
 bpy.ops.mesh.primitive_cube_add(size=1,location=cv(pos));o=bpy.context.object;o.scale=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if bevel:
  mod=o.modifiers.new('Manufactured rounded edges','BEVEL');mod.width=min(bevel,min(size)*.25);mod.segments=2;bpy.ops.object.modifier_apply(modifier=mod.name)
 return finish(o,parent,color,material)
def ball(parent,pos,size,color='ivory',material=BASE,segments=16):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=8,radius=1,location=cv(pos));o=bpy.context.object;o.scale=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 for p in o.data.polygons:p.use_smooth=True
 return finish(o,parent,color,material)
def rod(parent,a,b,r,color='dark',r2=None,vertices=10):
 A=Vector(cv(a));B=Vector(cv(b));d=B-A;bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=r,radius2=r if r2 is None else r2,depth=d.length,location=(A+B)/2);o=bpy.context.object;o.rotation_quaternion=d.to_track_quat('Z','Y');o.rotation_mode='QUATERNION';o.rotation_quaternion=d.to_track_quat('Z','Y');return finish(o,parent,color)
def loft(parent,sections,color='ivory',n=12):
 verts=[];faces=[]
 for y,rx,rz,z in sections:
  for i in range(n):a=2*math.pi*i/n;verts.append(cv((math.cos(a)*rx,y,math.sin(a)*rz+z)))
 for j in range(len(sections)-1):
  for i in range(n):a=j*n+i;b=j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
 faces.extend([tuple(reversed(range(n))),tuple((len(sections)-1)*n+i for i in range(n))]);me=bpy.data.meshes.new('sculpted-profile');me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new('profile',me);bpy.context.collection.objects.link(o);return finish(o,parent,color)
roots=[]
def root(name):o=empty(name);roots.append(o);return o
# Explorer: separated pivots, shaped pressure suit, segmented joints and expedition pack.
e=root('explorer');body=empty('explorer_body',e,pos=(0,.94,0))
loft(body,[(-.13,.23,.16,0),(0,.25,.18,0),(.32,.34,.20,0),(.43,.28,.17,0)],'teal')
cube(body,(0,.25,.15),(.48,.29,.15),'ivory',.07);cube(body,(0,.24,.235),(.19,.16,.035),'dark',.015);cube(body,(0,.25,.259),(.12,.04,.015),'mint',.005,GLOW)
for x in [-.20,.20]:cube(body,(x,.18,.23),(.055,.22,.045),'coral',.01)
cube(body,(0,.10,-.26),(.48,.53,.23),'ivory',.07);cube(body,(0,.12,-.4),(.27,.3,.08),'teal');cube(body,(0,.25,-.447),(.18,.025,.015),'mint',.003,GLOW)
for x in [-.23,.23]:rod(body,(x,-.1,-.29),(x,.32,-.29),.085,'dark');rod(body,(x,.28,-.29),(x,.4,-.29),.065,'coral')
rod(body,(.20,.35,-.32),(.20,.77,-.32),.012,'dark')
head=empty('explorer_head',body,(0,.54,0));ball(head,(0,.05,0),(.30,.33,.28),'ivory');ball(head,(0,.07,.193),(.267,.19,.126),'dark',GLASS);cube(head,(0,.15,.304),(.24,.025,.015),'mint',.004,GLOW)
for x in [-.30,.30]:ball(head,(x,.02,0),(.048,.10,.12),'coral')
rod(body,(0,.37,0),(0,.44,0),.16,'dark')
for side,x in [('l',-.34),('r',.34)]:
 arm=empty('explorer_arm_'+side,body,(x,.31,0));ball(arm,(0,0,0),(.14,.15,.16),'ivory');cube(arm,(x*.10,-.17,0),(.19,.27,.23),'teal');lower=empty('explorer_forearm_'+side,arm,(0,-.33,0));ball(lower,(0,0,0),(.10,.10,.11),'dark');cube(lower,(0,-.14,.012),(.19,.23,.21),'ivory');cube(lower,(0,-.12,.12),(.14,.08,.022),'coral');ball(lower,(0,-.31,.035),(.09,.105,.11),'dark')
 leg=empty('explorer_leg_'+side,e,(x*.48,.87,0));ball(leg,(0,-.03,0),(.13,.16,.15),'dark');loft(leg,[(-.04,.13,.14,0),(-.30,.11,.12,0),(-.38,.105,.10,0)],'ivory');knee=empty('explorer_shin_'+side,leg,(0,-.38,0));ball(knee,(0,-.01,0),(.10,.10,.10),'dark');cube(knee,(0,-.02,.10),(.15,.14,.08),'coral');cube(knee,(0,-.21,0),(.19,.29,.21),'teal');cube(knee,(0,-.39,.065),(.24,.15,.37),'dark');cube(knee,(0,-.30,.04),(.20,.09,.25),'ivory')
parent=bpy.data.objects['explorer_forearm_r']
tool=empty('explorer_tool',parent,(0,-.29,.10))
rod(tool,(0,-.12,0),(0,.10,0),.038,'dark');cube(tool,(0,.14,.12),(.12,.14,.35),'teal',.025);cube(tool,(0,.14,.08),(.13,.05,.19),'ivory',.01)
for x in [-.06,.06]:cube(tool,(x,.14,.32),(.035,.16,.20),'ivory',.01)
cube(tool,(0,.14,.35),(.06,.05,.14),'mint',.008,GLOW)
# Fabrication driver: compact induction hammer with split flux head and projector.
driver=empty('explorer_fabricator',parent,(0,-.29,.10))
rod(driver,(0,-.15,0),(0,.15,0),.043,'dark')
cube(driver,(0,.18,.07),(.34,.17,.21),'teal',.028)
for x in [-.19,.19]:
 cube(driver,(x,.18,.07),(.10,.22,.25),'ivory',.025)
 cube(driver,(x,.18,.205),(.07,.13,.025),'mint',.008,GLOW)
cube(driver,(0,.28,.07),(.12,.025,.12),'coral',.008)
cube(driver,(0,-.07,.055),(.06,.11,.025),'gold',.008)
rifle=empty('explorer_rifle',parent,(0,-.27,.11))
cube(rifle,(0,.04,.13),(.13,.16,.52),'teal',.025);cube(rifle,(0,.04,-.20),(.16,.18,.22),'ivory',.03);rod(rifle,(0,.04,.37),(0,.04,.68),.035,'dark');cube(rifle,(0,.15,.25),(.07,.08,.16),'mint',.01,GLOW)
for side in ['l','r']:bpy.data.objects['explorer_arm_'+side].scale.x=.92
# Three fauna with different silhouettes, articulated legs and tails.
for species in ['grazer','skitter','prowler']:
 r=root(species);body=empty(species+'_body',r);color={'grazer':'moss','skitter':'coral','prowler':'violet'}[species]
 if species=='grazer':
  ball(body,(0,.88,-.04),(.68,.60,1.03),'moss');ball(body,(0,.81,.94),(.37,.36,.48),'teal');ball(body,(0,.70,1.29),(.34,.18,.25),'dark')
  for i in range(5):
   z=-.72+i*.34;ball(body,(0,1.32,z),(.57-.07*abs(i-2),.21,.24),'ivory');rod(body,(-.2,1.43,z),(-.17,1.72,z-.13),.08,'mint',.015)
  for x in [-.28,.28]:ball(body,(x,.91,1.19),(.07,.045,.07),'gold',GLOW);rod(body,(x,.97,.96),(x*1.5,1.35,.81),.08,'ivory',.025)
 elif species=='skitter':
  ball(body,(0,.54,-.22),(.62,.39,.86),'dark');ball(body,(0,.73,-.30),(.6,.3,.76),'coral');ball(body,(0,.48,.63),(.35,.27,.36),'teal')
  for x in [-.2,0,.2]:ball(body,(x,.58,.90),(.055,.055,.05),'gold',GLOW)
  for x in [-.24,.24]:rod(body,(x,.4,.8),(x*.6,.27,1.15),.085,'ivory',.018)
  for z in [-.65,-.25,.15]:rod(body,(0,.92,z),(0,1.16,z-.10),.10,'ivory',.01)
 else:
  ball(body,(0,.85,-.08),(.38,.38,.91),'violet');ball(body,(0,1.12,.55),(.32,.35,.48),'teal');loft(body,[(.90,.22,.28,.83),(1.1,.25,.38,.93),(1.22,.18,.22,.89)],'violet')
  for x in [-.22,.22]:rod(body,(x,1.29,.65),(x*1.5,1.68,.45),.13,'violet',.015);ball(body,(x*.8,1.15,1.23),(.07,.034,.04),'mint',GLOW)
  for z in [-.66,-.32,0,.32]:rod(body,(0,1.15,z),(0,1.41,z-.16),.10,'teal',.01)
  tail=empty('prowler_tail',body,(0,.92,-.88));rod(tail,(0,0,0),(.06,.10,-.7),.10,'violet',.035);rod(tail,(.06,.10,-.7),(.15,.32,-1.08),.035,'mint',.012)
 count=3 if species=='skitter' else 2
 for side,x in [('l',-1),('r',1)]:
  for j in range(count):
   z=-.56+j*(1.05/(count-1));leg=empty(f'{species}_leg_{side}{j}',body,(x*(.47 if species!='prowler' else .27),.65,z));rod(leg,(0,0,0),(x*.21,-.20,.05),.12,color,.08);rod(leg,(x*.21,-.20,.05),(x*.27,-.60,.16),.08,'dark',.04);ball(leg,(x*.27,-.58,.18),(.12,.08,.20),'teal')
# Rover shell with six independently rotating wheels; variants share the manufactured family.
for name,scale in [('scout',1),('rover',1.4),('crawler',2)]:
 r=root(name);body=empty(name+'_body',r)
 cube(body,(0,.85,0),(1.72,.65,2.95),'teal',.15);cube(body,(0,1.2,.1),(1.55,.24,2.7),'ivory',.09);cube(body,(0,1.58,.43),(1.32,.65,1.24),'dark',.16,GLASS)
 for x in [-.72,.72]:cube(body,(x,1.51,.40),(.10,.72,1.5),'ivory',.035);cube(body,(x,1.19,-.7),(.09,.09,.7),'coral')
 cube(body,(0,1.95,.4),(1.55,.12,1.53),'ivory');cube(body,(0,.72,1.55),(1.88,.18,.20),'dark')
 for x in [-.6,.6]:cube(body,(x,1.05,1.48),(.33,.14,.075),'mint',.025,GLOW);cube(body,(x,1.08,-1.51),(.25,.10,.035),'coral',.02,GLOW)
 cube(body,(0,1.33,-.95),(1.20,.24,.6),'dark');rod(body,(.65,1.8,-.12),(.65,2.50,-.12),.018,'dark')
 for side,x in [('l',-.99),('r',.99)]:
  for j,z in enumerate([-1.02,1.02] if name=='scout' else [-1.06,0,1.06]):
   wheel=empty(f'{name}_wheel_{side}{j}',r,(x,.48,z));rod(wheel,(-.16,0,0),(.16,0,0),.46,'dark',vertices=16);rod(wheel,(x/abs(x)*.17,0,0),(x/abs(x)*.20,0,0),.26,'ivory',vertices=12)
   for k in range(8):a=k*math.pi/4;cube(wheel,(0,math.cos(a)*.43,math.sin(a)*.43),(.36,.10,.15),'teal',.025)
 r.scale=(scale,scale,scale)
# Renderable deposits: irregular ore clusters, real leaves and identifiable dropped supplies.
for typ,col in [('ice','blue'),('copper','coral'),('silica','ivory'),('carbon','dark'),('ferrite','gold'),('crystal','violet'),('fiber','mint'),('scrap','teal'),('water','blue'),('ration','gold'),('meat','coral')]:
 r=root('resource_'+typ)
 if typ=='fiber':
  for i in range(7):
   a=i*2.4;dx=math.cos(a);dz=math.sin(a);loft(r,[(-.5,.035,.035,0),(.0,.12,.05,0),(.45,.14,.035,0),(.95,.005,.005,0)],'mint',6);o=bpy.context.collection.objects[-1] if False else list(r.children)[-1];o.rotation_euler=(.25*dx,.25*dz,a);o.location=cv((dx*.16,-.15,dz*.16))
 elif typ in ['water','ration','meat','scrap']:
  if typ=='water':cube(r,(0,0,0),(.48,.82,.34),'blue');cube(r,(0,.45,0),(.18,.12,.18),'ivory');cube(r,(0,.06,.18),(.24,.3,.025),'ivory')
  elif typ=='ration':cube(r,(0,-.20,0),(.60,.3,.43),'gold');cube(r,(0,-.02,0),(.49,.06,.34),'ivory')
  elif typ=='meat':ball(r,(0,-.1,0),(.4,.22,.3),'coral');ball(r,(.13,.05,.05),(.12,.04,.13),'ivory')
  else:
   for i in range(3):o=cube(r,((i-1)*.28,-.20+i*.12,0),(.40,.20,.75),'teal');o.rotation_euler.z=i*.5
 else:
  for i in range(5):
   x=math.cos(i*2.4)*.38;z=math.sin(i*2.4)*.3;h=.5+(i%3)*.23
   if typ in ['crystal','ice','silica']:loft(r,[(-.5,.16,.17,0),(h*.35,.19,.18,0),(h,.01,.01,0)],col,6);o=list(r.children)[-1];o.location=cv((x,0,z));o.rotation_euler=(.12*math.sin(i),.18*math.cos(i),i)
   else:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=cv((x,-.15+i*.07,z)));o=bpy.context.object
    for v in o.data.vertices:v.co*=random.uniform(.80,1.20)
    o.scale=(.39,.33,.40);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);finish(o,r,col)
    if i%2==0:loft(r,[(-.25,.12,.1,0),(.22,.15,.12,0),(.48,.04,.02,0)],'teal' if typ=='carbon' else 'ivory',5);list(r.children)[-1].location=cv((x,0,z))
# Base equipment: proportions are normalized at import to the existing collision bounds.
for typ in ['cargo','workbench','lifeSupport','iceProcessor','garden','bed','heater']:
 r=root('prop_'+typ)
 if typ=='cargo':
  cube(r,(0,0,0),(1.5,1.1,1),'teal',.09);cube(r,(0,.36,0),(1.48,.32,.98),'ivory');cube(r,(0,.15,.51),(1.25,.045,.02),'dark');cube(r,(0,.10,.54),(.25,.28,.07),'dark');cube(r,(0,.15,.583),(.15,.07,.015),'mint',.008,GLOW)
  for x in [-.62,.62]:cube(r,(x,-.05,.51),(.10,.72,.04),'coral')
 elif typ=='workbench':
  cube(r,(0,.32,0),(1.8,.17,1.1),'ivory');
  for x in [-.7,.7]:cube(r,(x,-.15,0),(.25,.8,.8),'teal')
  cube(r,(0,.56,-.28),(.85,.32,.10),'dark');cube(r,(0,.56,-.217),(.71,.21,.025),'mint',.01,GLOW);cube(r,(.6,.46,.15),(.30,.1,.32),'coral')
 elif typ=='bed':
  cube(r,(0,-.40,0),(1.2,.26,2),'dark');cube(r,(0,-.18,0),(1.05,.26,1.84),'teal');cube(r,(0,-.04,.63),(.85,.16,.43),'ivory');cube(r,(0,.02,-.15),(1.04,.08,.85),'coral')
 elif typ=='garden':
  cube(r,(0,-.30,0),(1.5,.60,1.2),'ivory');cube(r,(0,.025,0),(1.30,.06,1),'dark')
  for x in [-.45,0,.45]:
   for z in [-.28,.28]:rod(r,(x,.05,z),(x,.55,z),.02,'teal');ball(r,(x,.35,z),(.18,.12,.12),'moss');ball(r,(x+.06,.48,z),(.13,.07,.13),'mint')
 else:
  cube(r,(0,-.06,0),(1.12,1.02,.88),'teal',.10);cube(r,(0,.47,0),(1.3,.16,1.0),'ivory');cube(r,(0,-.52,0),(1.3,.14,1.0),'dark')
  for x in [-.3,.3]:rod(r,(x,-.35,.49),(x,.26,.49),.16,'blue' if typ=='iceProcessor' else 'mint');cube(r,(x,.34,.49),(.27,.12,.14),'ivory')
  cube(r,(0,.35,-.49),(.4,.16,.03),'mint',.01,GLOW)
# Merge rigid details by joint/material to keep the draw-call budget bounded.
for parent in [o for o in bpy.data.objects if o.type=='EMPTY']:
 for material in [BASE,GLASS,GLOW]:
  parts=[o for o in parent.children if o.type=='MESH' and o.data.materials[0]==material]
  if not parts:continue
  bpy.ops.object.select_all(action='DESELECT')
  for o in parts:o.select_set(True)
  bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();bpy.context.object.name=parent.name+'_surface_'+material.name.split()[0]
# Export standard GLB, keep procedural source separate from runtime payload.
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(out,'field-kit.glb'),export_format='GLB',export_animations=False,export_yup=True,export_apply=True)
summary={'author':'Original models authored locally for Vibe City','license':'Project-owned original artwork; no third-party model content','source':'scripts/art/create_models.py','models':[o.name for o in roots],'meshes':sum(o.type=='MESH' for o in bpy.data.objects),'vertices':sum(len(o.data.vertices) for o in bpy.data.objects if o.type=='MESH'),'bytes':os.path.getsize(os.path.join(out,'field-kit.glb'))}
summary['sha256']=hashlib.sha256(open(os.path.join(out,'field-kit.glb'),'rb').read()).hexdigest();summary['units']='metres';summary['animation']='Articulated rigid-part rigs animated by client/field-art.js; Blender live study has editable keyframes.'
open(os.path.join(out,'field-kit.provenance.json'),'w').write(json.dumps(summary,indent=2));print('FIELD_KIT',json.dumps(summary))
