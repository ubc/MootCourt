import React from 'react';
import './LoginPage.css';
import ubcLogo from '../images/PALSOL-1.2b-Primary-UBC-Shield.png';
import { readLoginError } from '../../auth/useAuth';

/**
 * CWL sign-in screen.
 *
 * Rendered only when the server reports SHOW_LOGIN on. There is no local
 * username and password form and no guest button: the single way in is the
 * round trip through CWL, so this screen cannot be used to collect credentials
 * itself.
 */
export default function LoginPage() {
    const error = readLoginError();

    // A full navigation, not fetch — the browser has to follow the redirect to
    // the identity provider and come back with the assertion.
    const signIn = () => {
        const next = window.location.pathname + window.location.hash;
        window.location.href = `/auth/login?next=${encodeURIComponent(next || '/')}`;
    };

    return (
        <div className="loginPage">
            <div className="loginCard">
                <img src={ubcLogo} alt="" />
                <h1>Moot Court</h1>
                <h2>Sign in with your CWL account to begin a practice session.</h2>

                {error && <p className="loginError" role="alert">{error}</p>}

                <button className="loginButton" type="button" onClick={signIn}>
                    Sign in with CWL
                </button>

                <p className="loginNote">
                    Your practice sessions are saved to your account so you can review
                    your assessment later.
                </p>
            </div>
        </div>
    );
}
