export function createReconnectController({
  attempt,
  exhausted,
  delays = [500, 1000, 2000, 4000, 4000],
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let active = false;
  let attemptIndex = 0;
  let timer = null;

  function cancelTimer() {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  }

  return {
    connected() {
      active = true;
      attemptIndex = 0;
      cancelTimer();
    },
    disconnected() {
      if (!active || timer !== null) return;
      if (attemptIndex >= delays.length) {
        active = false;
        exhausted();
        return;
      }
      const delay = delays[attemptIndex++];
      timer = setTimer(() => {
        timer = null;
        if (active) attempt();
      }, delay);
    },
    stop() {
      active = false;
      cancelTimer();
    },
    get active() {
      return active;
    },
  };
}
