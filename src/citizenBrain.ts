import { Citizen } from "./citizenData";
import { WorldTimeState } from "./worldTime";

export type CitizenBrain = {
  generateGreeting(citizen: Citizen, worldTime: WorldTimeState): string;
  generateCitizenSmallTalk(citizenA: Citizen, citizenB: Citizen, worldTime: WorldTimeState): string;
  evaluateTrustChange(citizen: Citizen, event: string): number;
};

const friendly = ["Hey! Good to see you.", "What's up? I've got a minute.", "Nice seeing you around."];
const neutral = ["Hey.", "Need something?", "What's going on?"];
const rushed = ["Sorry, I'm on my way to work.", "I can't talk right now.", "Make it quick."];
const strained = ["Sorry, my head's somewhere else.", "Long day. What do you need?", "I'm a little out of it right now."];

function pick(lines: string[], seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return lines[hash % lines.length];
}

export const fallbackCitizenBrain: CitizenBrain = {
  generateGreeting(citizen, worldTime) {
    const seed = `${citizen.id}:${worldTime.seasonDay}:${citizen.currentState}:${citizen.currentMood}`;
    if (citizen.currentState === "walking_to_work" || citizen.currentState === "walking_home" || citizen.currentMood === "rushed" || citizen.currentMood === "annoyed") {
      return pick(rushed, seed);
    }
    if (citizen.currentMood === "tired" || citizen.currentMood === "distracted" || citizen.currentMood === "lonely" || citizen.currentMood === "stressed") return pick(strained, seed);
    if (citizen.relationshipToPlayer >= 25) return pick(friendly, seed);
    return pick(neutral, seed);
  },
  generateCitizenSmallTalk(citizenA, citizenB) {
    return `${citizenA.name} and ${citizenB.name} trade a quick hello.`;
  },
  evaluateTrustChange(citizen, event) {
    return event.includes(citizen.id) ? 1 : 0;
  }
};
