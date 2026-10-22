// Result tones (F-1, spec M2 §7 rule 13), made in the browser with the Web Audio API: no audio
// files. Success = two rising notes, "already" = one soft note, reject = two low notes, and a
// short tick when a card is read. Browsers allow sound only after a tap (or with the kiosk-mode
// autoplay setting from the setup guide); until then nothing plays and the screen shows all.

export type Tone = "tick" | "success" | "already" | "reject";

type Note = { frequency: number; startS: number; lengthS: number; volume: number };

export const TONES: Record<Tone, Note[]> = {
  tick: [{ frequency: 1200, startS: 0, lengthS: 0.06, volume: 0.25 }],
  success: [
    { frequency: 660, startS: 0, lengthS: 0.14, volume: 0.35 },
    { frequency: 880, startS: 0.16, lengthS: 0.2, volume: 0.35 },
  ],
  already: [{ frequency: 520, startS: 0, lengthS: 0.22, volume: 0.25 }],
  reject: [
    { frequency: 300, startS: 0, lengthS: 0.2, volume: 0.4 },
    { frequency: 220, startS: 0.24, lengthS: 0.28, volume: 0.4 },
  ],
};

type AudioContextClass = new () => AudioContext;

function audioContextClass(): AudioContextClass | null {
  const scope = globalThis as {
    AudioContext?: AudioContextClass;
    webkitAudioContext?: AudioContextClass;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

export class TonePlayer {
  private context: AudioContext | null = null;

  /** Called on start and again after the banner tap; sound works once the context runs. */
  async unlock(): Promise<boolean> {
    const Context = audioContextClass();
    if (!Context) return false;
    this.context ??= new Context();
    if (this.context.state !== "running") {
      await this.context.resume().catch(() => undefined);
    }
    return this.isReady();
  }

  isReady(): boolean {
    return this.context?.state === "running";
  }

  play(tone: Tone): void {
    const context = this.context;
    if (context?.state !== "running") return;
    const start = context.currentTime + 0.01;
    for (const note of TONES[tone]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = note.frequency;
      // A short fade in and out, so the notes do not click.
      const noteStart = start + note.startS;
      const noteEnd = noteStart + note.lengthS;
      gain.gain.setValueAtTime(0, noteStart);
      gain.gain.linearRampToValueAtTime(note.volume, noteStart + 0.02);
      gain.gain.linearRampToValueAtTime(0, noteEnd);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd + 0.02);
    }
  }
}
