export type GameSoundKind =
  | "paddle"
  | "paddleEdge"
  | "grab"
  | "brickChip"
  | "hardBrick"
  | "brickDestroy"
  | "specialBrick"
  | "bossBrick"
  | "goodPowerup"
  | "badPowerup"
  | "extraLife"
  | "levelWarp"
  | "loseLife"
  | "laser"
  | "explosion"
  | "levelClear"
  | "gameOver"
  | "pause"
  | "resume";

interface ToneVoice {
  frequency: number;
  duration: number;
  peak: number;
  type?: OscillatorType;
  sweep?: number;
  delay?: number;
  noise?: boolean;
}

interface SoundProfile {
  cooldownMs: number;
  voices: ToneVoice[];
}

export interface GameAudioDebugState {
  contextState: AudioContextState | "not-created" | "unavailable";
  musicEnabled: boolean;
  musicPlaying: boolean;
  musicMasterGain: number;
  musicMelodyOutputPeak: number;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

const PROFILES: Record<GameSoundKind, SoundProfile> = {
  paddle: { cooldownMs: 24, voices: [{ frequency: 260, duration: 0.045, peak: 0.055, type: "triangle", sweep: 80 }] },
  paddleEdge: {
    cooldownMs: 24,
    voices: [
      { frequency: 360, duration: 0.048, peak: 0.056, type: "triangle", sweep: 190 },
      { frequency: 820, duration: 0.026, peak: 0.024, type: "sine", delay: 0.01 }
    ]
  },
  grab: { cooldownMs: 80, voices: [{ frequency: 240, duration: 0.09, peak: 0.045, type: "sine", sweep: -60 }] },
  brickChip: { cooldownMs: 18, voices: [{ frequency: 560, duration: 0.034, peak: 0.038, type: "square", sweep: -70 }] },
  hardBrick: {
    cooldownMs: 20,
    voices: [
      { frequency: 260, duration: 0.045, peak: 0.05, type: "square", sweep: -35 },
      { frequency: 880, duration: 0.018, peak: 0.02, type: "sine" }
    ]
  },
  brickDestroy: { cooldownMs: 18, voices: [{ frequency: 420, duration: 0.07, peak: 0.052, type: "triangle", sweep: -120 }] },
  specialBrick: {
    cooldownMs: 28,
    voices: [
      { frequency: 620, duration: 0.075, peak: 0.052, type: "triangle", sweep: 180 },
      { frequency: 930, duration: 0.035, peak: 0.024, type: "sine", delay: 0.025 }
    ]
  },
  bossBrick: {
    cooldownMs: 40,
    voices: [
      { frequency: 110, duration: 0.12, peak: 0.062, type: "sawtooth", sweep: -28 },
      { frequency: 260, duration: 0.07, peak: 0.036, type: "square", delay: 0.018 }
    ]
  },
  goodPowerup: {
    cooldownMs: 80,
    voices: [
      { frequency: 560, duration: 0.07, peak: 0.042, type: "triangle", sweep: 150 },
      { frequency: 760, duration: 0.08, peak: 0.035, type: "triangle", delay: 0.045, sweep: 180 }
    ]
  },
  badPowerup: { cooldownMs: 80, voices: [{ frequency: 260, duration: 0.13, peak: 0.052, type: "sawtooth", sweep: -120 }] },
  extraLife: {
    cooldownMs: 140,
    voices: [
      { frequency: 660, duration: 0.08, peak: 0.045, type: "triangle" },
      { frequency: 880, duration: 0.09, peak: 0.04, type: "triangle", delay: 0.06 },
      { frequency: 1180, duration: 0.12, peak: 0.036, type: "sine", delay: 0.12 }
    ]
  },
  levelWarp: {
    cooldownMs: 200,
    voices: [
      { frequency: 420, duration: 0.16, peak: 0.045, type: "sine", sweep: 420 },
      { frequency: 210, duration: 0.22, peak: 0.03, type: "triangle", sweep: 240 }
    ]
  },
  loseLife: { cooldownMs: 120, voices: [{ frequency: 150, duration: 0.24, peak: 0.065, type: "triangle", sweep: -80 }] },
  laser: { cooldownMs: 55, voices: [{ frequency: 960, duration: 0.045, peak: 0.04, type: "square", sweep: 260 }] },
  explosion: {
    cooldownMs: 80,
    voices: [
      { frequency: 92, duration: 0.2, peak: 0.075, type: "sawtooth", sweep: -42, noise: true },
      { frequency: 54, duration: 0.16, peak: 0.045, type: "triangle", delay: 0.02, sweep: -14 }
    ]
  },
  levelClear: {
    cooldownMs: 300,
    voices: [
      { frequency: 520, duration: 0.11, peak: 0.04, type: "triangle" },
      { frequency: 660, duration: 0.12, peak: 0.038, type: "triangle", delay: 0.08 },
      { frequency: 880, duration: 0.18, peak: 0.04, type: "sine", delay: 0.16 }
    ]
  },
  gameOver: {
    cooldownMs: 300,
    voices: [
      { frequency: 220, duration: 0.22, peak: 0.055, type: "triangle", sweep: -55 },
      { frequency: 150, duration: 0.34, peak: 0.055, type: "triangle", delay: 0.18, sweep: -70 }
    ]
  },
  pause: { cooldownMs: 80, voices: [{ frequency: 260, duration: 0.07, peak: 0.04, type: "sine", sweep: -45 }] },
  resume: { cooldownMs: 80, voices: [{ frequency: 360, duration: 0.07, peak: 0.04, type: "sine", sweep: 60 }] }
};

const MUSIC_NOTES = [196, 246.94, 293.66, 329.63, 293.66, 246.94, 220, 261.63];
export const MUSIC_MASTER_GAIN = 0.35;
export const MUSIC_MELODY_PEAK = 0.026;
const MUSIC_BASS_PEAK = 0.018;

export function createGameAudio() {
  let ctx: AudioContext | null = null;
  let musicGain: GainNode | null = null;
  let musicTimer: number | null = null;
  let musicStep = 0;
  let musicEnabled = false;
  const lastPlayed = new Map<GameSoundKind, number>();

  const ensureContext = (): AudioContext | null => {
    if (typeof window === "undefined") return null;
    if (!ctx) {
      const Ctx = window.AudioContext ?? window.webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
    }
    requestResume(ctx);
    return ctx;
  };

  const requestResume = (context: AudioContext) => {
    if (context.state !== "suspended") return;
    void context.resume().then(() => {
      if (musicEnabled) startMusic(context);
    }).catch(() => undefined);
  };

  const play = (kind: GameSoundKind, enabled: boolean) => {
    if (!enabled && !musicEnabled) return;
    const context = ensureContext();
    if (!context) return;
    if (musicEnabled) startMusic(context);
    if (!enabled) return;

    const profile = PROFILES[kind];
    const nowMs = performance.now();
    const lastMs = lastPlayed.get(kind) ?? 0;
    if (nowMs - lastMs < profile.cooldownMs) return;
    lastPlayed.set(kind, nowMs);

    const now = context.currentTime;
    for (const voice of profile.voices) {
      playTone(context, now + (voice.delay ?? 0), voice, context.destination);
    }
  };

  const setMusicEnabled = (enabled: boolean) => {
    musicEnabled = enabled;
    if (!enabled) {
      stopMusic();
      return;
    }
    if (ctx) startMusic(ctx);
  };

  const unlock = () => {
    if (!musicEnabled) return;
    const context = ensureContext();
    if (context) startMusic(context);
  };

  const debugSnapshot = (): GameAudioDebugState => ({
    contextState: audioContextState(),
    musicEnabled,
    musicPlaying: musicTimer !== null,
    musicMasterGain: MUSIC_MASTER_GAIN,
    musicMelodyOutputPeak: MUSIC_MASTER_GAIN * MUSIC_MELODY_PEAK
  });

  const startMusic = (context: AudioContext) => {
    if (context.state === "suspended") {
      requestResume(context);
      return;
    }
    if (context.state === "closed") return;
    if (musicTimer !== null) return;
    if (!musicGain) {
      musicGain = context.createGain();
      musicGain.connect(context.destination);
    }
    musicGain.gain.cancelScheduledValues(context.currentTime);
    musicGain.gain.setValueAtTime(Math.max(0.0001, musicGain.gain.value), context.currentTime);
    musicGain.gain.exponentialRampToValueAtTime(MUSIC_MASTER_GAIN, context.currentTime + 0.25);

    const tick = () => {
      if (!musicEnabled || !musicGain || !ctx || ctx.state !== "running") return;
      const note = MUSIC_NOTES[musicStep % MUSIC_NOTES.length] ?? MUSIC_NOTES[0];
      const now = ctx.currentTime;
      playTone(ctx, now, { frequency: note, duration: 0.18, peak: MUSIC_MELODY_PEAK, type: "triangle" }, musicGain);
      if (musicStep % 4 === 0) playTone(ctx, now, { frequency: note / 2, duration: 0.32, peak: MUSIC_BASS_PEAK, type: "sine" }, musicGain);
      musicStep += 1;
    };

    tick();
    musicTimer = window.setInterval(tick, 360);
  };

  const stopMusic = () => {
    if (musicTimer !== null) {
      window.clearInterval(musicTimer);
      musicTimer = null;
    }
    if (!musicGain || !ctx) return;
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.setValueAtTime(Math.max(0.0001, musicGain.gain.value), ctx.currentTime);
    musicGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
  };

  const audioContextState = (): GameAudioDebugState["contextState"] => {
    if (ctx) return ctx.state;
    if (typeof window === "undefined") return "unavailable";
    return window.AudioContext ?? window.webkitAudioContext ? "not-created" : "unavailable";
  };

  return { play, setMusicEnabled, unlock, debugSnapshot };
}

function playTone(context: AudioContext, start: number, voice: ToneVoice, destination: AudioNode) {
  const osc = context.createOscillator();
  const gain = context.createGain();
  const duration = Math.max(0.01, voice.duration);
  osc.type = voice.type ?? "sine";
  osc.frequency.setValueAtTime(voice.frequency, start);
  if (voice.sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(40, voice.frequency + voice.sweep), start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(voice.peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(destination);
  osc.addEventListener("ended", () => {
    osc.disconnect();
    gain.disconnect();
  });
  osc.start(start);
  osc.stop(start + duration + 0.04);
  if (voice.noise) playNoise(context, start, duration * 0.72, voice.peak * 0.45, destination);
}

function playNoise(context: AudioContext, start: number, duration: number, peak: number, destination: AudioNode) {
  const buffer = context.createBuffer(1, Math.max(1, Math.floor(context.sampleRate * duration)), context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < channel.length; index += 1) {
    channel[index] = (Math.random() * 2 - 1) * (1 - index / channel.length);
  }
  const source = context.createBufferSource();
  const gain = context.createGain();
  gain.gain.setValueAtTime(peak, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.buffer = buffer;
  source.connect(gain);
  gain.connect(destination);
  source.addEventListener("ended", () => {
    source.disconnect();
    gain.disconnect();
  });
  source.start(start);
  source.stop(start + duration);
}
