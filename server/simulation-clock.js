// Monotonic elapsed time keeps survival, tools and motion in real time under load.
// Small steps preserve collision/jump behavior; long process stalls catch up at most 1 s.
export function advanceSimulation(game,elapsed){let remaining=Number.isFinite(elapsed)?Math.min(1,Math.max(0,elapsed)):0;while(remaining>1e-9){const step=Math.min(.05,remaining);game.tick(step);remaining-=step;}}
