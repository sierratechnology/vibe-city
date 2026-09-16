import {DEFAULT_SETTINGS} from '../shared/settings.js';
export const SERVER_ID='quiet-basin';
export function catalog(players=0,settings=DEFAULT_SETTINGS){return{creationEnabled:false,servers:[{id:SERVER_ID,name:settings.name,players,maxPlayers:settings.maxPlayers,dailySaveUTC:'00:00',cycleSeconds:settings.daySeconds+settings.nightSeconds,pvp:settings.pvp}]};}
