// The short spoken line after a result (F-1, spec M2 §7 rule 13), with the browser's own Web
// Speech voices. An Indian English voice first, else any English one; voices that run on the
// device are preferred. The NAME IS NEVER SPOKEN: every line comes from the translation file
// (kiosk.voice.*, kiosk.punch.<CODE>.voice), so no personal data reaches an online voice.
// Without an English voice the kiosk plays only the tones.

type Voice = Pick<SpeechSynthesisVoice, "lang" | "localService" | "name">;

export function pickVoice<V extends Voice>(voices: V[]): V | null {
  const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith("en"));
  const indian = english.filter((voice) => voice.lang.toLowerCase().replace("_", "-") === "en-in");
  const ranked = [
    indian.find((voice) => voice.localService),
    indian[0],
    english.find((voice) => voice.localService),
    english[0],
  ];
  return ranked.find((voice) => voice !== undefined) ?? null;
}

export class VoicePlayer {
  private voice: SpeechSynthesisVoice | null = null;

  constructor() {
    const synthesis = globalThis.speechSynthesis;
    if (!synthesis) return;
    const choose = () => {
      this.voice = pickVoice(synthesis.getVoices());
    };
    choose();
    // Chrome loads its voice list a moment after the page starts.
    synthesis.addEventListener?.("voiceschanged", choose);
  }

  canSpeak(): boolean {
    return this.voice !== null;
  }

  speak(line: string): void {
    const synthesis = globalThis.speechSynthesis;
    if (!synthesis || !this.voice || !line) return;
    synthesis.cancel(); // a new result interrupts the last line
    const utterance = new SpeechSynthesisUtterance(line);
    utterance.voice = this.voice;
    utterance.lang = this.voice.lang;
    utterance.rate = 1;
    synthesis.speak(utterance);
  }
}
