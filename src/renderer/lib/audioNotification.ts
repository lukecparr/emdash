/**
 * In-app audio notification using the Web Audio API.
 *
 * Synthesizes a short two-tone chime (no external audio files needed).
 * The chime respects the user's notification-sound preference and will
 * play even when the window is focused (system notifications are suppressed
 * when focused, but the audio cue should still be audible).
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

/**
 * Play a short, pleasant two-tone chime to indicate task completion.
 *
 * Uses two sine-wave oscillators at musical intervals with a gentle
 * gain envelope so the sound is unobtrusive.
 */
export function playCompletionChime(): void {
  try {
    const ctx = getAudioContext();

    // Resume context if suspended (browsers require user gesture first;
    // Electron is more lenient but this is a safe guard).
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const now = ctx.currentTime;

    // Master gain (overall volume)
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.18, now);
    master.connect(ctx.destination);

    // First tone: E5 (659 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(1, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc1.connect(gain1);
    gain1.connect(master);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Second tone: A5 (880 Hz) — starts slightly after the first
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.12);
    gain2.gain.setValueAtTime(0, now + 0.12);
    gain2.gain.linearRampToValueAtTime(1, now + 0.14);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.connect(gain2);
    gain2.connect(master);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.55);

    // Clean up master gain after both tones finish
    setTimeout(() => {
      master.disconnect();
    }, 700);
  } catch {
    // Silently ignore audio errors — notifications are best-effort
  }
}

/**
 * Play the completion chime only if the user has enabled notification sounds.
 * Fetches the setting from the main process.
 */
export async function playCompletionChimeIfEnabled(): Promise<void> {
  try {
    const result = await window.electronAPI.getSettings();
    if (!result?.success) return;

    const settings = result.settings;
    if (!settings?.notifications?.enabled) return;
    if (!settings?.notifications?.sound) return;

    playCompletionChime();
  } catch {
    // Silently ignore — best effort
  }
}
