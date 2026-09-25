const steps=[
 [1,'Gather your first materials','Find ferrite and ribbon fiber near landing. Approach and hold Action.','Backpack','backpack'],
 [2,'Craft a field cutter','You need 3 ferrite and 2 fiber. The cutter doubles your gathering yield.','Fabrication','fabrication'],
 [4,'Place a deck','Equip the Fabrication driver with B or its belt slot. Choose Deck, then use Action on a valid preview.','Building','fabrication'],
 [8,'Put a canopy over your deck','Shelter restores suit charge. Walls are optional for this first shelter.','Building','fabrication'],
 [16,'Build a cargo locker','Gather 6 ferrite and 2 fiber. You can place lockers toward the deck edges.','Fabrication','fabrication'],
 [32,'Store supplies','Action opens a nearby locker. Use Store all, Store matching, or individual stacks.','Backpack','backpack'],
 [64,'Claim a home bunk','Build your bunk on a deck. Approach it, use Action, and choose Set home bunk.','Habitat','habitat']
];
export function createJourney({open}){const root=document.getElementById('journeySteps'),rows=[];for(const[bit,title,help,label,page]of steps){const row=document.createElement('section');row.className='journey-step';const heading=document.createElement('b'),description=document.createElement('p'),button=document.createElement('button');description.textContent=help;button.textContent=label;button.onclick=()=>open(page);row.append(heading,description,button);root.append(row);rows.push({bit,title,row,heading});}return{update(p){for(const{bit,title,row,heading}of rows){const done=!!((p.journey||0)&bit);row.classList.toggle('done',done);heading.textContent=`${done?'✓':'○'} ${title}`;}}};}
