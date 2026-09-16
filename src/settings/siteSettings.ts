/**
 * Site-wide instructor settings, served by the Node service from a JSON file.
 *
 * Reads are best-effort: the courtroom has never depended on a backend, so if
 * the API is unreachable the built-in defaults apply and nothing breaks. Saves
 * come only from the instructor screen and report their errors to it.
 */

export interface WpmThresholds {
    /** Below this is too slow. */
    slowBelow: number;
    /** From here up is faster than ideal. */
    fastAbove: number;
    /** From here up is too fast. */
    tooFastAbove: number;
}

export interface SiteSettings {
    judgePrompt: string;
    showPaceByDefault: boolean;
    wpm: WpmThresholds;
}

// Mirrors server/siteSettings.mjs. The prompt default is intentionally empty
// here: the browser never needs the real one, the server always has it.
export const DEFAULT_SITE_SETTINGS: SiteSettings = {
    judgePrompt: '',
    showPaceByDefault: true,
    wpm: { slowBelow: 120, fastAbove: 160, tooFastAbove: 180 },
};

export async function fetchSiteSettings(): Promise<{ settings: SiteSettings; defaults: SiteSettings } | null> {
    try {
        const response = await fetch('/api/settings', { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) return null;
        const body = await response.json();
        if (!body?.settings?.wpm) return null;
        return { settings: body.settings, defaults: body.defaults || DEFAULT_SITE_SETTINGS };
    } catch {
        return null;
    }
}

export async function saveSiteSettings(settings: SiteSettings): Promise<{ settings?: SiteSettings; errors?: string[] }> {
    try {
        const response = await fetch('/api/settings', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return { errors: body.errors || [`The server responded ${response.status}.`] };
        return { settings: body.settings };
    } catch {
        return { errors: ['Could not reach the local service. Is npm run dev running?'] };
    }
}
