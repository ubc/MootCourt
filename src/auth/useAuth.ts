import { useCallback, useEffect, useState } from 'react';

export interface AuthUser {
    userId: string;
    puid: string;
    cwlLoginName: string | null;
    email: string | null;
    displayName: string;
    role: 'student' | 'instructor';
    authProvider: 'cwl';
}

export type AuthStatus = 'loading' | 'anonymous' | 'signedIn' | 'signedOut' | 'unavailable';

export interface AuthState {
    status: AuthStatus;
    user: AuthUser | null;
    /** True only when the server is running with SHOW_LOGIN on. */
    showLogin: boolean;
    error: string;
    signOut: () => Promise<void>;
}

/**
 * Decides whether this deployment has a login screen, and who is signed in.
 *
 * The server is the authority, not the frontend: it reports SHOW_LOGIN through
 * /api/auth/config. While that flag is off the /auth routes do not exist at
 * all, so there is nothing here to fall back to and nothing to bypass.
 *
 * `unavailable` means the API could not be reached. The app still runs — the
 * courtroom never depended on a backend — it just cannot save anything.
 */
export function useAuth(): AuthState {
    const [status, setStatus] = useState<AuthStatus>('loading');
    const [user, setUser] = useState<AuthUser | null>(null);
    const [showLogin, setShowLogin] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const configResponse = await fetch('/api/auth/config', { credentials: 'same-origin' });
                if (!configResponse.ok) throw new Error(`config responded ${configResponse.status}`);
                const config = await configResponse.json();
                if (cancelled) return;

                setShowLogin(Boolean(config.showLogin));

                if (!config.showLogin) {
                    setStatus('anonymous');
                    return;
                }

                const meResponse = await fetch('/api/auth/me', { credentials: 'same-origin' });
                if (cancelled) return;

                if (meResponse.ok) {
                    const body = await meResponse.json();
                    setUser(body.user);
                    setStatus('signedIn');
                } else {
                    setStatus('signedOut');
                }
            } catch (caught) {
                if (cancelled) return;
                // Treat an unreachable API as anonymous rather than locking the
                // user out of an app that works offline.
                setError(caught instanceof Error ? caught.message : 'Unknown error');
                setStatus('unavailable');
            }
        })();

        return () => { cancelled = true; };
    }, []);

    const signOut = useCallback(async () => {
        try {
            await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
        } finally {
            setUser(null);
            setStatus('signedOut');
        }
    }, []);

    return { status, user, showLogin, error, signOut };
}

/** Reads the ?loginError= marker the SAML callback sets when a sign-in fails. */
export function readLoginError(search = window.location.search): string {
    const code = new URLSearchParams(search).get('loginError');
    if (!code) return '';
    if (code === 'rejected') return 'CWL did not release the information Moot Court needs. Contact the course administrator.';
    if (code === 'session') return 'Signed in, but the session could not be created. Try again.';
    if (code === 'server') return 'The sign-in service had a problem. Try again in a moment.';
    return 'Sign-in did not complete. Try again.';
}
