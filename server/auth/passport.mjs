import fs from 'node:fs';
import { createRequire } from 'node:module';
import passport from 'passport';
import { extractCwlProfile } from './cwlProfile.mjs';
import { createOrUpdateCwlUser, getUserById } from '../models/user.mjs';

const require = createRequire(import.meta.url);

/**
 * UBC Shibboleth (CWL) authentication.
 *
 * Only ever called when SHOW_LOGIN is on. With it off this module is not
 * imported, no strategy is registered, and no CWL attribute is read.
 *
 * The same strategy serves the local simplesamlphp IdP and real UBC
 * Shibboleth — only the entry point, certificate and issuer differ, all from
 * environment variables.
 */
export function configurePassport(config, db) {
  const { saml } = config.auth;

  let ubcshib;
  try {
    ubcshib = require('passport-ubcshib');
  } catch (error) {
    throw new Error(`SHOW_LOGIN is on but passport-ubcshib could not be loaded: ${error.message}`);
  }

  const cert = fs.readFileSync(saml.certPath, 'utf8');

  passport.use('ubcshib', new ubcshib.Strategy(
    {
      entryPoint: saml.entryPoint,
      issuer: saml.issuer,
      callbackUrl: saml.callbackUrl,
      cert,
      privateKeyPath: saml.privateKeyPath || undefined,
      // Without this list the IdP releases only its default attribute set,
      // which does not include the PUID. The service provider must also be
      // registered to release these — see docs/cwl-login.md.
      attributeConfig: ['ubcEduCwlPuid', 'mail', 'eduPersonAffiliation', 'cwlLoginName', 'givenName', 'sn'],
      enableSLO: saml.enableSLO,
      validateInResponseTo: saml.validateInResponseTo,
      acceptedClockSkewMs: saml.clockSkewMs,
      logoutUrl: saml.logoutUrl || saml.entryPoint,
      metadataUrl: saml.metadataUrl || undefined,
    },
    async (samlProfile, done) => {
      try {
        const extracted = extractCwlProfile(samlProfile);
        if (!extracted.ok) return done(null, false, { message: extracted.error });

        const user = await createOrUpdateCwlUser(db, extracted.profile);
        return done(null, user);
      } catch (error) {
        return done(error);
      }
    },
  ));

  // Only the internal id goes into the cookie. The PUID and everything else
  // stays in the database and is re-read per request.
  passport.serializeUser((user, done) => done(null, user.userId));

  passport.deserializeUser(async (userId, done) => {
    try {
      const user = await getUserById(db, userId);
      done(null, user || false);
    } catch (error) {
      done(error);
    }
  });

  return passport;
}

export { passport };
