export const AUDIO_STORAGE_KEY = 'vc-audio-settings';
export const AUDIO_DEFAULTS = Object.freeze({muted:false, interfaceVolume:40, worldVolume:55});

function validPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 3 || !['muted','interfaceVolume','worldVolume'].every(key => Object.hasOwn(value, key))) return false;
  return typeof value.muted === 'boolean'
    && Number.isInteger(value.interfaceVolume) && value.interfaceVolume >= 0 && value.interfaceVolume <= 100
    && Number.isInteger(value.worldVolume) && value.worldVolume >= 0 && value.worldVolume <= 100;
}

export function loadAudioPreferences(storage) {
  try {
    const raw = storage?.getItem(AUDIO_STORAGE_KEY);
    if (raw === null) return {...AUDIO_DEFAULTS};
    const value = JSON.parse(raw);
    return validPreferences(value) ? {...value} : {...AUDIO_DEFAULTS};
  } catch {
    return {...AUDIO_DEFAULTS};
  }
}

export function createAudioSettings(storage) {
  let preferences = loadAudioPreferences(storage);
  const persist = next => {
    if (!validPreferences(next)) return false;
    try {
      storage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(next));
      preferences = next;
      return true;
    } catch {
      return false;
    }
  };
  return {
    get: () => ({...preferences}),
    setMuted: muted => typeof muted === 'boolean' && persist({...preferences, muted}),
    setCategory: (category, volume) => {
      const key = category === 'interface' ? 'interfaceVolume' : category === 'world' ? 'worldVolume' : null;
      return !!key && Number.isInteger(volume) && volume >= 0 && volume <= 100 && persist({...preferences, [key]:volume});
    },
    effectiveVolume: category => {
      if (preferences.muted) return 0;
      if (category === 'interface') return preferences.interfaceVolume / 100;
      if (category === 'world') return preferences.worldVolume / 100;
      return 0;
    },
  };
}

export function createAudioEngine({settings, createContext, maxVoices=4}) {
  let context = null;
  const voices = new Set();
  const stopVoices = () => {
    for (const voice of voices) {
      try { voice.oscillator.stop(); } catch {}
      try { voice.oscillator.disconnect(); } catch {}
      try { voice.gain.disconnect(); } catch {}
    }
    voices.clear();
  };
  return {
    setMuted(muted) {
      const applied = settings.setMuted(muted);
      if (applied && muted) stopVoices();
      return applied;
    },
    async activate(userActivated) {
      if (!userActivated) return false;
      try {
        if (!context) context = createContext();
        if (context.state === 'suspended') await context.resume();
        return context.state === 'running';
      } catch {
        const failedContext = context;
        context = null;
        try { if (failedContext && failedContext.state !== 'closed') await failedContext.close(); } catch {}
        return false;
      }
    },
    play(category) {
      const volume = settings.effectiveVolume(category);
      if (!context || context.state !== 'running' || !volume || voices.size >= maxVoices) return false;
      let oscillator, gain;
      try {
        oscillator = context.createOscillator();
        gain = context.createGain();
        const now = context.currentTime, duration = category === 'interface' ? .08 : category === 'world' ? .14 : 0;
        if (!duration) return false;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(category === 'interface' ? 520 : 240, now);
        gain.gain.setValueAtTime(Math.max(.0001, volume), now);
        gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
        oscillator.connect(gain); gain.connect(context.destination);
        const voice = {oscillator, gain};
        oscillator.onended = () => {
          voices.delete(voice);
          try { oscillator.disconnect(); } catch {}
          try { gain.disconnect(); } catch {}
        };
        voices.add(voice);
        oscillator.start(now); oscillator.stop(now + duration);
        return true;
      } catch {
        try { oscillator?.disconnect(); } catch {}
        try { gain?.disconnect(); } catch {}
        return false;
      }
    },
    async suspend() {
      stopVoices();
      try { if (context?.state === 'running') await context.suspend(); } catch {}
    },
    async destroy() {
      stopVoices();
      try { if (context && context.state !== 'closed') await context.close(); } catch {}
      context = null;
    },
    status: () => ({hasContext:!!context, activeVoices:voices.size, state:context?.state || 'unavailable'}),
  };
}
