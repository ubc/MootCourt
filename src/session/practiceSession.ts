/**
 * Saves a practice run to the backend.
 *
 * Every call here is best-effort and never throws. Moot Court worked with no
 * backend at all before session storage existed, and it has to keep working
 * that way: if MONGODB_URI is unset the session routes are not even mounted,
 * and a student mid-argument must not see the courtroom break because a save
 * failed. Failures are logged and swallowed.
 */

let currentSessionId: string | null = null;
let saved = false;

/** Words the student spoke, taken from their own turns only. */
function countWords(conversation: Array<{ role?: string; content?: string }>): number {
    if (!Array.isArray(conversation)) return 0;
    return conversation
        .filter(turn => turn?.role === 'user' && typeof turn.content === 'string')
        .reduce((total, turn) => total + (turn.content as string).trim().split(/\s+/).filter(Boolean).length, 0);
}

/**
 * Opens a session when the student enters the courtroom. Returns nothing —
 * callers carry on regardless of whether storage is available.
 */
export async function startPracticeSession(config: any): Promise<void> {
    currentSessionId = null;
    saved = false;

    try {
        const response = await fetch('/api/sessions', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                playerPosition: config?.playerPosition,
                settings: {
                    totalTime: config?.totalTime,
                    questionInterval: config?.questionInterval,
                    introductionTime: config?.introductionTime,
                    isInteliJudge: config?.isInteliJudge,
                    setRandomized: config?.setRandomized,
                    setDelay: config?.setDelay,
                },
            }),
        });

        if (!response.ok) {
            // 404 = storage not configured, 401 = login required. Both are
            // ordinary states, not errors worth alarming anyone about.
            console.info(`Practice session not being saved (server responded ${response.status}).`);
            return;
        }

        currentSessionId = (await response.json()).sessionId;
    } catch (error) {
        console.info('Practice session not being saved (backend unreachable).', error);
    }
}

/**
 * Writes the transcript and timings at the end of a run. Safe to call more than
 * once — the app can reach the end page by more than one route, and a second
 * call must not overwrite a completed session with a partial one.
 */
export async function savePracticeSession(config: any, judgeElapsedTime: number): Promise<void> {
    if (!currentSessionId || saved) return;
    saved = true;

    try {
        const response = await fetch(`/api/sessions/${currentSessionId}`, {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversation: config?.conversation || [],
                runningTimestamps: config?.runningTimestamps || [],
                wordCount: countWords(config?.conversation),
                judgeElapsedTime: Number.isFinite(judgeElapsedTime) ? judgeElapsedTime : 0,
                ended: true,
            }),
        });
        if (!response.ok) console.info(`Could not save practice session (server responded ${response.status}).`);
    } catch (error) {
        console.info('Could not save practice session (backend unreachable).', error);
    }
}

export function getCurrentSessionId(): string | null {
    return currentSessionId;
}

export const __testing = { countWords };
