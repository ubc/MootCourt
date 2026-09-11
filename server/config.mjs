export const JUDGE_INSTRUCTIONS = "Play the role of a Judge in Canada in a Judicial Interrogation System practiced in the Socratic method and the user is orally presenting at a Moot Court practice. Keep the response under 4 sentences: Find their weakest point and ask a question about that single idea to challenge, provoke thought, and deepen the student's understanding of law.";

// Accepts SHOW_LOGIN=true / True / TRUE / 1. Anything else — including unset,
// empty, or a typo — leaves login off, so a misconfigured deployment collects
// no personal information rather than collecting it by accident.
function readFlag(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
}

export function readConfig(env = process.env) {
  const port = Number(env.REALTIME_PORT || 43128);
  const appPort = Number(env.PORT || 43127);
  if (![port, appPort].every(value => Number.isInteger(value) && value > 0 && value <= 65535)) {
    throw new Error('REALTIME_PORT and PORT must be valid port numbers.');
  }

  // The origin the browser actually uses. In development that is the React dev
  // server, which proxies /auth and /api here (see src/setupProxy.js), so the
  // SAML assertion and the session cookie share one origin. In production this
  // server serves the built frontend and the value is the deployed URL.
  const publicUrl = (env.PUBLIC_URL || `http://localhost:${appPort}`).replace(/\/$/, '');

  return {
    port,
    appPort,
    publicUrl,
    apiKey: env.OPENAI_API_KEY?.trim() || '',
    model: env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1',
    transcriptionModel: env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe',
    voice: env.OPENAI_REALTIME_VOICE || 'alloy',
    origins: readOrigins(env, appPort, publicUrl),
    mongo: readMongoConfig(env),
    auth: readAuthConfig(env, publicUrl),
  };
}

// The origins the WebSocket relay will accept an upgrade from (server/relay.mjs).
//
// Development needs both loopback origins: the browser sits on the React dev
// server, or on the Express port directly. A deployed environment must trust
// the deployed origin alone, because a loopback address is loopback on the
// CLIENT's machine and not on ours -- trusting one there does not narrow the
// allowlist to us, it widens it to everybody.
//
// Do not add entries here to make something work against a deployed host.
// relay.mjs seeds allowedHosts with 127.0.0.1 and localhost independently of
// this list, so on-host health checks do not need them.
function readOrigins(env, appPort, publicUrl) {
  if (env.NODE_ENV === 'production') return [publicUrl];
  return [`http://localhost:${appPort}`, `http://127.0.0.1:${appPort}`, publicUrl];
}

function readMongoConfig(env) {
  return {
    // Unset means "run without persistence" so the app still starts on a laptop
    // with no Docker. Required once SHOW_LOGIN is on — see validateConfig.
    uri: env.MONGODB_URI?.trim() || '',
    dbName: env.MONGODB_DB_NAME?.trim() || 'mootcourt_dev',
    // Same 5s ceiling GRASP uses: a missing database fails fast and visibly
    // instead of hanging every request until the driver's 30s default.
    connectTimeoutMS: Number(env.MONGODB_CONNECT_TIMEOUT_MS || 5000),
    serverSelectionTimeoutMS: Number(env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 5000),
  };
}

function readAuthConfig(env, publicUrl) {
  const showLogin = readFlag(env.SHOW_LOGIN);
  return {
    // The single switch this whole feature hangs off. When false the SAML
    // strategy is never registered, the /auth routes are never mounted, and no
    // CWL attribute is read or stored anywhere.
    showLogin,
    sessionSecret: env.SESSION_SECRET?.trim() || '',
    sessionTtlHours: Number(env.SESSION_TTL_HOURS || 24),
    secureCookie: env.NODE_ENV === 'production',
    saml: {
      issuer: env.SAML_ISSUER?.trim() || publicUrl,
      callbackUrl: env.SAML_CALLBACK_URL?.trim() || `${publicUrl}/auth/saml/callback`,
      entryPoint: env.SAML_ENTRY_POINT?.trim() || '',
      logoutUrl: env.SAML_LOGOUT_URL?.trim() || '',
      metadataUrl: env.SAML_METADATA_URL?.trim() || '',
      certPath: env.SAML_CERT_PATH?.trim() || '',
      privateKeyPath: env.SAML_PRIVATE_KEY_PATH?.trim() || '',
      environment: env.SAML_ENVIRONMENT?.trim() || 'STAGING',
      enableSLO: env.ENABLE_SLO !== 'false',
      clockSkewMs: Number(env.SAML_CLOCK_SKEW_MS || 0),
      validateInResponseTo: env.SAML_VALIDATE_IN_RESPONSE_TO !== 'false',
    },
  };
}

/**
 * Fails startup on combinations that would otherwise half-work — a login screen
 * with nowhere to store the user, or signed cookies with no secret.
 * @returns {string[]} Human-readable problems; empty means the config is usable.
 */
export function validateConfig(config) {
  const problems = [];
  if (!config.auth.showLogin) return problems;

  if (!config.mongo.uri) {
    problems.push('SHOW_LOGIN is on but MONGODB_URI is not set. CWL login needs MongoDB for the user records and the session store.');
  }
  if (!config.auth.sessionSecret) {
    problems.push('SHOW_LOGIN is on but SESSION_SECRET is not set. Generate one with: openssl rand -base64 32');
  }
  if (!config.auth.saml.entryPoint) {
    problems.push('SHOW_LOGIN is on but SAML_ENTRY_POINT is not set (the IdP SSO URL).');
  }
  if (!config.auth.saml.certPath) {
    problems.push('SHOW_LOGIN is on but SAML_CERT_PATH is not set (the IdP signing certificate).');
  }
  return problems;
}

export function sessionConfig(config) {
  return {
    type: 'realtime',
    model: config.model,
    instructions: JUDGE_INSTRUCTIONS,
    output_modalities: ['audio'],
    // Keep answers short without applying the old text-token budget to audio tokens.
    max_output_tokens: 4096,
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: 24000 },
        transcription: { model: config.transcriptionModel },
        turn_detection: null,
      },
      output: { format: { type: 'audio/pcm', rate: 24000 }, voice: config.voice },
    },
  };
}
