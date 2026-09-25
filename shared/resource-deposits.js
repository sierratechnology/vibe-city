// Stable visual provenance for existing deposits: never changes their saved contents.
export function depositKind(node){if(String(node.id).startsWith('drop'))return null;let hash=2166136261;for(const char of String(node.id))hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;if(node.type==='ice')return hash%2?'glacier':'frozenBasin';if(['ferrite','copper','scrap','crystal'].includes(node.type)&&hash%3===0&&!String(node.id).includes('coral'))return 'meteor';return null;}
export const depositLabels={meteor:'Mine meteor',glacier:'Mine glacial ice',frozenBasin:'Harvest frozen basin'};
