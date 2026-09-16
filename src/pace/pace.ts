import type { WpmThresholds } from '../settings/siteSettings';

/**
 * Speaking-pace maths shared by the live indicator and the assessment data.
 *
 * Everything here is per turn. A turn is one hold-and-release of Enter: its
 * transcript comes back from OpenAI after the audio is committed, and its
 * duration is how long the key was held. Word-level timing is not available
 * from the transcription model, so the per-word timestamps produced below are
 * an even spread across the turn — good enough for a pacing graph, and honest
 * about being an approximation.
 */

export type PaceBand = 'slow' | 'good' | 'fast' | 'tooFast';

export interface PaceTurn {
    words: number;
    durationMs: number;
    wpm: number;
}

export function countWords(text: string): number {
    return text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}

/** Words per minute for one turn, or null when the turn is too short to mean anything. */
export function wordsPerMinute(words: number, durationMs: number): number | null {
    if (!Number.isFinite(durationMs) || durationMs < 1000 || words <= 0) return null;
    return Math.round(words / (durationMs / 60000));
}

export function paceBand(wpm: number, thresholds: WpmThresholds): PaceBand {
    if (wpm < thresholds.slowBelow) return 'slow';
    if (wpm < thresholds.fastAbove) return 'good';
    if (wpm < thresholds.tooFastAbove) return 'fast';
    return 'tooFast';
}

export const PACE_COLORS: Record<PaceBand, string> = {
    slow: '#F5D247',
    good: '#199E54',
    fast: '#F5D247',
    tooFast: '#FA5F55',
};

export const PACE_LABELS: Record<PaceBand, string> = {
    slow: 'A bit slow',
    good: 'Good pace',
    fast: 'A bit fast',
    tooFast: 'Too fast',
};

/** Session average weighted by speaking time, not a mean of per-turn rates. */
export function averageWpm(turns: PaceTurn[]): number | null {
    const words = turns.reduce((sum, turn) => sum + turn.words, 0);
    const duration = turns.reduce((sum, turn) => sum + turn.durationMs, 0);
    return wordsPerMinute(words, duration);
}

/**
 * Expands one turn into the [word, startMs, endMs] entries AssessmentPage and
 * the saved session expect, spreading the words evenly across the turn.
 */
export function spreadWordTimestamps(transcript: string, startMs: number, durationMs: number): Array<[string, number, number]> {
    const words = transcript ? transcript.trim().split(/\s+/).filter(Boolean) : [];
    if (!words.length || !Number.isFinite(startMs) || !(durationMs > 0)) return [];
    const step = durationMs / words.length;
    return words.map((word, index): [string, number, number] => {
        const start = Math.round(startMs + index * step);
        return [word, start, Math.round(start + step)];
    });
}
