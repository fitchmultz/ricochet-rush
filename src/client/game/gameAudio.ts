export type GameSoundKind =
  | "paddle"
  | "brickChip"
  | "brickDestroy"
  | "powerup"
  | "loseLife"
  | "laser"
  | "explosion"
  | "levelClear"
  | "gameOver"
  | "pause"
  | "resume";

const PROFILES: Record<GameSoundKind, { frequency: number; duration: number; peak: number; type?: OscillatorType; sweep?: number; noise?: boolean }> = {
  paddle: { frequency: 320, duration: 0.06, peak: 0.07 },
  brickChip: { frequency: 520, duration: 0.04, peak: 0.05 },
  brickDestroy: { frequency: 380, duration: 0.09, peak: 0.07 },
  powerup: { frequency: 660, duration: 0.08, peak: 0.06 },
  loseLife: { frequency: 140, duration: 0.22, peak: 0.08, type: "triangle", sweep: -70 },
  laser: { frequency: 920, duration: 0.045, peak: 0.045, type: "square", sweep: 220 },
  explosion: { frequency: 92, duration: 0.2, peak: 0.08, type: "sawtooth", sweep: -40, noise: true },
  levelClear: { frequency: 520, duration: 0.28, peak: 0.065, type: "triangle", sweep: 360 },
  gameOver: { frequency: 180, duration: 0.42, peak: 0.075, type: "triangle", sweep: -120 },
  pause: { frequency: 260, duration: 0.07, peak: 0.045, type: "sine", sweep: -45 },
  resume: { frequency: 360, duration: 0.07, peak: 0.045, type: "sine", sweep: 60 }
};

export function createGameAudio() {
  let ctx: AudioContext | null = null;

  const ensureContext = (): AudioContext | null => {
    if (typeof window === "undefined") return null;
    if (!ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  };

  const play = (kind: GameSoundKind, enabled: boolean) => {
    if (!enabled) return;
    const context = ensureContext();
    if (!context) return;
    const { frequency, duration, peak, sweep, type, noise } = PROFILES[kind];
    const now = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type ?? "sine";
    osc.frequency.setValueAtTime(frequency, now);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(40, frequency + sweep), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start(now);
    osc.stop(now + duration + 0.04);
    if (noise) playNoise(context, now, duration * 0.72, peak * 0.45);
  };

  return { play };
}

function playNoise(context: AudioContext, start: number, duration: number, peak: number) {
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
  gain.connect(context.destination);
  source.start(start);
  source.stop(start + duration);
}
