import { averageWpm, paceBand, spreadWordTimestamps, wordsPerMinute } from './pace';

const thresholds = { slowBelow: 120, fastAbove: 160, tooFastAbove: 180 };

test('words per minute is rounded and ignores turns too short to measure', () => {
    expect(wordsPerMinute(70, 30000)).toBe(140);
    expect(wordsPerMinute(3, 900)).toBeNull();
    expect(wordsPerMinute(0, 30000)).toBeNull();
});

test('bands follow the instructor thresholds with inclusive upper edges', () => {
    expect(paceBand(119, thresholds)).toBe('slow');
    expect(paceBand(120, thresholds)).toBe('good');
    expect(paceBand(159, thresholds)).toBe('good');
    expect(paceBand(160, thresholds)).toBe('fast');
    expect(paceBand(180, thresholds)).toBe('tooFast');
});

test('session average is weighted by speaking time', () => {
    // 60 words in 30s (120 wpm) and 30 words in 5s (360 wpm): 90 words in 35s.
    expect(averageWpm([
        { words: 60, durationMs: 30000, wpm: 120 },
        { words: 30, durationMs: 5000, wpm: 360 },
    ])).toBe(154);
    expect(averageWpm([])).toBeNull();
});

test('a turn expands to one evenly spaced [word, start, end] entry per word', () => {
    const entries = spreadWordTimestamps('may it please the court', 1000, 5000);
    expect(entries).toEqual([
        ['may', 1000, 2000], ['it', 2000, 3000], ['please', 3000, 4000], ['the', 4000, 5000], ['court', 5000, 6000],
    ]);
    expect(spreadWordTimestamps('', 1000, 5000)).toEqual([]);
    expect(spreadWordTimestamps('words', 1000, 0)).toEqual([]);
});
