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

// Original synthesized cues: no sampled audio from other games.
export const WORLD_CUES=Object.freeze({
 gather:[740,130,.11,'triangle',.24], build:[220,640,.24,'sine',.28], dismantle:[480,80,.22,'triangle',.2], repair:[960,320,.16,'triangle',.16],
 craft:[440,880,.22,'sine',.22], transfer:[460,680,.09,'sine',.15], transferBulk:[460,780,.16,'sine',.2],
 drop:[280,110,.1,'triangle',.18], home:[330,990,.3,'sine',.2], jump:[150,330,.09,'sine',.13],
 footstep:[90,38,.055,'triangle',.13], land:[120,35,.14,'triangle',.23], attack:[160,45,.12,'triangle',.22],
 eat:[340,480,.12,'sine',.15], drink:[560,760,.13,'sine',.14], light:[700,520,.07,'sine',.1],
});
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
    play(category, cue) {
      const volume = settings.effectiveVolume(category);
      if (!context || context.state !== 'running' || !volume || voices.size >= maxVoices) return false;
      let oscillator, gain;
      try {
        oscillator = context.createOscillator();
        gain = context.createGain();
        const sound=category==='world'&&Object.hasOwn(WORLD_CUES,cue)?WORLD_CUES[cue]:null;
        const now = context.currentTime, duration = sound?.[2] ?? (category === 'interface' ? .08 : category === 'world' ? .14 : 0);
        if (!duration) return false;
        oscillator.type = sound?.[3]||'sine';
        oscillator.frequency.setValueAtTime(sound?.[0]??(category === 'interface' ? 520 : 240), now);
        if(sound)oscillator.frequency.exponentialRampToValueAtTime(sound[1],now+duration);
        gain.gain.setValueAtTime(Math.max(.0001, volume*(sound?.[4]??1)), now);
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
