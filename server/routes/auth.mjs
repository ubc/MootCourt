import express from 'express';
import { toPublicUser } from '../models/user.mjs';

/**
 * The identity behind a request, or null in anonymous mode.
 * Everything that writes data goes through this rather than reading req.user
 * directly, so anonymous mode has exactly one definition.
 */
export function getIdentity(req) {
  if (!req.user) return null;
  return { userId: req.user.userId, puid: req.user.puid };
}

/**
 * Rejects unauthenticated requests — but only when login is switched on.
 * With SHOW_LOGIN off there is no identity to require and every caller is
 * legitimately anonymous, so this becomes a passthrough.
 */
export function requireAuth(config) {
  return (req, res, next) => {
    if (!config.auth.showLogin) return next();
    if (req.user) return next();
    res.status(401).json({ error: 'Not signed in', loginUrl: '/auth/login' });
  };
}

/**
 * Always mounted, in both modes. The frontend calls this before rendering
 * anything to find out whether a login screen belongs on screen.
 */
export function createPublicAuthRouter(config) {
  const router = express.Router();

  router.get('/api/auth/config', (req, res) => {
    res.json({
      showLogin: config.auth.showLogin,
      loginUrl: config.auth.showLogin ? '/auth/login' : null,
      provider: config.auth.showLogin ? 'cwl' : null,
    });
  });

  return router;
}

/**
 * Mounted only when SHOW_LOGIN is on. While the flag is off none of these
 * paths exist, so there is no route through which a CWL attribute could be
 * received or stored.
 */
export function createAuthRouter(config, passport) {
  const router = express.Router();

  router.get('/auth/login', (req, res, next) => {
    // Where to land after the round trip through the IdP. Only a local path is
    // accepted — an absolute URL here would make this an open redirect.
    const target = typeof req.query.next === 'string' ? req.query.next : '/';
    req.session.returnTo = target.startsWith('/') && !target.startsWith('//') ? target : '/';
    passport.authenticate('ubcshib', { failureRedirect: '/?loginError=1' })(req, res, next);
  });

  router.post(
    '/auth/saml/callback',
    express.urlencoded({ extended: false, limit: '2mb' }),
    (req, res, next) => {
      passport.authenticate('ubcshib', (error, user, info) => {
        if (error) {
          console.error('CWL callback error:', error.message);
          return res.redirect('/?loginError=server');
        }
        if (!user) {
          console.warn('CWL login rejected:', info?.message);
          return res.redirect('/?loginError=rejected');
        }
        req.logIn(user, loginError => {
          if (loginError) {
            console.error('CWL session error:', loginError.message);
            return res.redirect('/?loginError=session');
          }
          const target = req.session.returnTo || '/';
          delete req.session.returnTo;
          return res.redirect(target);
        });
      })(req, res, next);
    },
  );

  router.get('/api/auth/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    res.json({ user: toPublicUser(req.user) });
  });

  router.post('/auth/logout', (req, res) => {
    req.logout(error => {
      if (error) console.error('Logout error:', error.message);
      req.session.destroy(() => {
        res.clearCookie('mootcourt.sid');
        res.json({ ok: true, redirect: '/' });
      });
    });
  });

  // The IdP uses a redirect binding for single logout, so this must be a GET.
  router.get('/auth/logout', (req, res) => {
    req.logout(() => {
      req.session.destroy(() => {
        res.clearCookie('mootcourt.sid');
        res.redirect('/');
      });
    });
  });

  return router;
}
