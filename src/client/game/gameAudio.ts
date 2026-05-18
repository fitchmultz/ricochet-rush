export type GameSoundKind =
  | "paddle"
  | "paddleEdge"
  | "grab"
  | "brickChip"
  | "hardBrick"
  | "brickDestroy"
  | "specialBrick"
  | "bossBrick"
  | "streak"
  | "bossDamage"
  | "volatilePowerup"
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

export interface GameAudioPlayOptions {
  pitch?: number;
  intensity?: number;
  streak?: number;
  rumble?: number;
}

export interface GameAudioDebugState {
  contextState: AudioContextState | "not-created" | "unavailable";
  sfxVolume: number;
  musicVolume: number;
  musicEnabled: boolean;
  musicPlaying: boolean;
  musicMasterGain: number;
  musicMelodyOutputPeak: number;
  lastSfxOutputPeak: number;
  lastSfxKind: GameSoundKind | null;
  sfxLimiterActive: boolean;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

const PROFILES: Record<GameSoundKind, SoundProfile> = {
  paddle: {
    cooldownMs: 24,
    voices: [
      { frequency: 170, duration: 0.07, peak: 0.035, type: "triangle", sweep: -24 },
      { frequency: 305, duration: 0.052, peak: 0.045, type: "triangle", sweep: 92 }
    ]
  },
  paddleEdge: {
    cooldownMs: 24,
    voices: [
      { frequency: 180, duration: 0.065, peak: 0.032, type: "triangle", sweep: -20 },
      { frequency: 400, duration: 0.052, peak: 0.05, type: "triangle", sweep: 210 },
      { frequency: 860, duration: 0.03, peak: 0.022, type: "sine", delay: 0.012 }
    ]
  },
  grab: {
    cooldownMs: 80,
    voices: [
      { frequency: 150, duration: 0.12, peak: 0.028, type: "triangle", sweep: -22 },
      { frequency: 250, duration: 0.1, peak: 0.038, type: "sine", sweep: -60 }
    ]
  },
  brickChip: { cooldownMs: 18, voices: [{ frequency: 560, duration: 0.038, peak: 0.036, type: "square", sweep: -76 }] },
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
      { frequency: 92, duration: 0.16, peak: 0.052, type: "sawtooth", sweep: -26, noise: true },
      { frequency: 238, duration: 0.075, peak: 0.032, type: "square", delay: 0.018 }
    ]
  },
  streak: {
    cooldownMs: 115,
    voices: [
      { frequency: 520, duration: 0.052, peak: 0.032, type: "triangle", sweep: 80 },
      { frequency: 780, duration: 0.06, peak: 0.024, type: "sine", delay: 0.035, sweep: 120 }
    ]
  },
  bossDamage: {
    cooldownMs: 90,
    voices: [
      { frequency: 70, duration: 0.18, peak: 0.052, type: "sawtooth", sweep: -16, noise: true },
      { frequency: 132, duration: 0.14, peak: 0.034, type: "triangle", delay: 0.02, sweep: -18 }
    ]
  },
  volatilePowerup: {
    cooldownMs: 95,
    voices: [
      { frequency: 330, duration: 0.12, peak: 0.038, type: "triangle", sweep: 220 },
      { frequency: 115, duration: 0.16, peak: 0.028, type: "sawtooth", delay: 0.02, sweep: -34, noise: true }
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
const SFX_MASTER_GAIN = 0.82;

export function createGameAudio() {
  let ctx: AudioContext | null = null;
  let musicGain: GainNode | null = null;
  let sfxGain: GainNode | null = null;
  let sfxLimiter: DynamicsCompressorNode | null = null;
  let musicTimer: number | null = null;
  let musicStep = 0;
  let sfxVolume = 1;
  let musicVolume = 1;
  let lastSfxOutputPeak = 0;
  let lastSfxKind: GameSoundKind | null = null;
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
      if (musicVolume > 0) startMusic(context);
    }).catch(() => undefined);
  };

  const play = (kind: GameSoundKind, volume: number, options: GameAudioPlayOptions = {}) => {
    sfxVolume = clamp(volume, 0, 1);
    if (sfxVolume <= 0 && musicVolume <= 0) return;
    const context = ensureContext();
    if (!context) return;
    if (musicVolume > 0) startMusic(context);
    if (sfxVolume <= 0) return;

    const profile = PROFILES[kind];
    const nowMs = performance.now();
    const lastMs = lastPlayed.get(kind) ?? 0;
    if (nowMs - lastMs < profile.cooldownMs) return;
    lastPlayed.set(kind, nowMs);

    const pitch = clamp(options.pitch ?? 1, 0.45, 2.35);
    const intensity = clamp(options.intensity ?? 1, 0.2, 1.45);
    const now = context.currentTime;
    const destination = sfxDestination(context);
    let outputPeak = 0;
    for (const voice of profile.voices) {
      const peak = clamp(voice.peak * sfxVolume * intensity, 0.0001, 0.085);
      outputPeak += peak;
      playTone(
        context,
        now + (voice.delay ?? 0),
        {
          ...voice,
          frequency: voice.frequency * pitch,
          sweep: voice.sweep === undefined ? undefined : voice.sweep * pitch,
          peak
        },
        destination
      );
    }
    if ((options.rumble ?? 0) > 0) {
      const rumblePeak = clamp((options.rumble ?? 0) * sfxVolume * 0.05, 0.0001, 0.06);
      outputPeak += rumblePeak;
      playNoise(context, now, 0.14 + clamp(options.rumble ?? 0, 0, 1) * 0.12, rumblePeak, destination);
    }
    lastSfxOutputPeak = outputPeak * SFX_MASTER_GAIN;
    lastSfxKind = kind;
  };

  const sfxDestination = (context: AudioContext): AudioNode => {
    if (!sfxGain || !sfxLimiter) {
      sfxGain = context.createGain();
      sfxGain.gain.value = SFX_MASTER_GAIN;
      sfxLimiter = context.createDynamicsCompressor();
      sfxLimiter.threshold.value = -10;
      sfxLimiter.knee.value = 8;
      sfxLimiter.ratio.value = 10;
      sfxLimiter.attack.value = 0.003;
      sfxLimiter.release.value = 0.18;
      sfxGain.connect(sfxLimiter);
      sfxLimiter.connect(context.destination);
    }
    return sfxGain;
  };

  const setSfxVolume = (volume: number) => {
    sfxVolume = clamp(volume, 0, 1);
  };

  const setMusicVolume = (volume: number) => {
    musicVolume = clamp(volume, 0, 1);
    if (musicVolume <= 0) {
      stopMusic();
      return;
    }
    if (ctx) startMusic(ctx);
  };

  const unlock = () => {
    if (musicVolume <= 0) return;
    const context = ensureContext();
    if (context) startMusic(context);
  };

  const debugSnapshot = (): GameAudioDebugState => ({
    contextState: audioContextState(),
    sfxVolume,
    musicVolume,
    musicEnabled: musicVolume > 0,
    musicPlaying: musicTimer !== null,
    musicMasterGain: musicTargetGain(),
    musicMelodyOutputPeak: musicTargetGain() * MUSIC_MELODY_PEAK,
    lastSfxOutputPeak,
    lastSfxKind,
    sfxLimiterActive: sfxLimiter !== null
  });

  const startMusic = (context: AudioContext) => {
    if (musicVolume <= 0) {
      stopMusic();
      return;
    }
    if (context.state === "suspended") {
      requestResume(context);
      return;
    }
    if (context.state === "closed") return;
    if (!musicGain) {
      musicGain = context.createGain();
      musicGain.connect(context.destination);
    }
    rampMusicGain(context, musicTargetGain(), 0.25);
    if (musicTimer !== null) return;

    const tick = () => {
      if (musicVolume <= 0 || !musicGain || !ctx || ctx.state !== "running") return;
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
    rampMusicGain(ctx, 0.0001, 0.18);
  };

  const musicTargetGain = () => MUSIC_MASTER_GAIN * musicVolume;

  const rampMusicGain = (context: AudioContext, target: number, duration: number) => {
    if (!musicGain) return;
    musicGain.gain.cancelScheduledValues(context.currentTime);
    musicGain.gain.setValueAtTime(Math.max(0.0001, musicGain.gain.value), context.currentTime);
    musicGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, target), context.currentTime + duration);
  };

  const audioContextState = (): GameAudioDebugState["contextState"] => {
    if (ctx) return ctx.state;
    if (typeof window === "undefined") return "unavailable";
    return window.AudioContext ?? window.webkitAudioContext ? "not-created" : "unavailable";
  };

  return { play, setSfxVolume, setMusicVolume, unlock, debugSnapshot };
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
