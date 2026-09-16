import React, { useEffect, useState } from 'react';
import { DEFAULT_SITE_SETTINGS, fetchSiteSettings, saveSiteSettings, SiteSettings } from '../../settings/siteSettings';

/**
 * Instructor settings panel on the landing page.
 *
 * Everything here is site-wide: it changes what every student on this
 * deployment gets. There is no login on this deployment yet, so there is no
 * gate on the panel either — see server/routes/settings.mjs for where the
 * instructor-role check belongs once CWL is turned on.
 */
export default function InstructorSettingsMenu({ onBack, onSaved }: { onBack: () => void; onSaved?: (settings: SiteSettings) => void }) {
    const [form, setForm] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
    const [defaults, setDefaults] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
    const [status, setStatus] = useState<{ kind: 'idle' | 'loading' | 'saving' | 'saved' | 'error'; messages: string[] }>({ kind: 'loading', messages: [] });

    useEffect(() => {
        let cancelled = false;
        fetchSiteSettings().then(result => {
            if (cancelled) return;
            if (!result) {
                setStatus({ kind: 'error', messages: ['Could not load settings from the local service. Is npm run dev running?'] });
                return;
            }
            setForm(result.settings);
            setDefaults(result.defaults);
            setStatus({ kind: 'idle', messages: [] });
        });
        return () => { cancelled = true; };
    }, []);

    const setWpm = (name: keyof SiteSettings['wpm'], raw: string) => {
        setForm(prev => ({ ...prev, wpm: { ...prev.wpm, [name]: raw === '' ? ('' as unknown as number) : Number(raw) } }));
        setStatus({ kind: 'idle', messages: [] });
    };

    const save = async () => {
        setStatus({ kind: 'saving', messages: [] });
        const result = await saveSiteSettings(form);
        if (result.errors) {
            setStatus({ kind: 'error', messages: result.errors });
            return;
        }
        setForm(result.settings!);
        onSaved?.(result.settings!);
        setStatus({ kind: 'saved', messages: ['Saved. New practice sessions will use these settings.'] });
    };

    const resetPrompt = () => setForm(prev => ({ ...prev, judgePrompt: defaults.judgePrompt }));
    const resetThresholds = () => setForm(prev => ({ ...prev, wpm: { ...defaults.wpm } }));

    const busy = status.kind === 'loading' || status.kind === 'saving';
    const { wpm } = form;

    return (
        <div className="sideMenuInner">
            <div className="sideMenuTitleText">
                <h1>Instructor Settings</h1>
                <div className="hr-2"></div>
            </div>
            <div className="sideMenuSetUp instructorSettings">
                <p className="instructorSettingsNote">These settings apply to every student using this site.</p>

                <div className="formitem instructorField">
                    <label htmlFor="judgePrompt">IntelliJudge prompt</label>
                    <p>The instructions the AI judge follows in every IntelliJudge session.</p>
                    <textarea
                        id="judgePrompt"
                        value={form.judgePrompt}
                        onChange={e => { setForm(prev => ({ ...prev, judgePrompt: e.target.value })); setStatus({ kind: 'idle', messages: [] }); }}
                        rows={7}
                        disabled={busy}
                    />
                    <button className="button small-button" type="button" onClick={resetPrompt} disabled={busy}>Reset prompt to default</button>
                </div>

                <div className="formitem instructorField">
                    <label>Speaking pace (words per minute)</label>
                    <p>Green between the first two numbers. Yellow below the first or between the last two. Red above the last.</p>
                    <div className="wpmRow">
                        <span>Slow below</span>
                        <input id="wpmSlowBelow" type="number" min="1" max="1000" value={wpm.slowBelow} onChange={e => setWpm('slowBelow', e.target.value)} disabled={busy} />
                        <span>Fast above</span>
                        <input id="wpmFastAbove" type="number" min="1" max="1000" value={wpm.fastAbove} onChange={e => setWpm('fastAbove', e.target.value)} disabled={busy} />
                        <span>Too fast above</span>
                        <input id="wpmTooFastAbove" type="number" min="1" max="1000" value={wpm.tooFastAbove} onChange={e => setWpm('tooFastAbove', e.target.value)} disabled={busy} />
                    </div>
                    <button className="button small-button" type="button" onClick={resetThresholds} disabled={busy}>Reset thresholds to default</button>
                </div>

                <div className="formitem instructorField">
                    <label htmlFor="showPaceByDefault">Show pace indicator by default</label>
                    <div className="toggle-container">
                        <input
                            id="showPaceByDefault"
                            type="checkbox"
                            checked={form.showPaceByDefault}
                            onChange={e => { setForm(prev => ({ ...prev, showPaceByDefault: e.target.checked })); setStatus({ kind: 'idle', messages: [] }); }}
                            disabled={busy}
                        />
                        <div className="slider round"></div>
                    </div>
                    <p>Students can still turn it on or off for their own session on the Timer screen.</p>
                </div>

                {status.messages.length > 0 && (
                    <div className={`instructorStatus ${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}>
                        {status.messages.map(message => <div key={message}>{message}</div>)}
                    </div>
                )}
            </div>
            <div className="sideMenuBottom">
                <button className="button large-button" type="button" onClick={onBack}>Back</button>
                <button className="button large-button" type="button" onClick={save} disabled={busy}>
                    {status.kind === 'saving' ? 'Saving…' : 'Save'}
                </button>
            </div>
        </div>
    );
}
