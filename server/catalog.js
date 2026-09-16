export const SERVER_ID='quiet-basin';
export function catalog(players=0){return {creationEnabled:false,servers:[{id:SERVER_ID,name:'The Quiet Basin',players,maxPlayers:10,dailySaveUTC:'00:00',cycleSeconds:600}]};}
