export const JUDGE_INSTRUCTIONS = "Play the role of a Judge in Canada in a Judicial Interrogation System practiced in the Socratic method and the user is orally presenting at a Moot Court practice. Keep the response under 4 sentences: Find their weakest point and ask a question about that single idea to challenge, provoke thought, and deepen the student's understanding of law.";

/**
 * Appended to the judge's instructions only when the student uploaded
 * materials. Without this the model has a search_materials tool and no reason
 * to reach for it — realtime models rarely call a tool they were not told to
 * prefer, and a judge that never opens the brief is the whole feature failing
 * silently.
 */
export const MATERIALS_INSTRUCTIONS = [
  'The student has filed written materials for this moot. Use the search_materials',
  'tool to look up what they actually wrote before challenging a submission, and',
  'again whenever they cite a fact, authority, or figure you should verify.',
  'Ground your questions in what the search returns: quote or paraphrase their own',
  'words back to them and press on it. If a search returns nothing relevant, ask',
  'your question from the oral argument alone and do not invent a citation.',
].join(' ');

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
    origins: [`http://localhost:${appPort}`, `http://127.0.0.1:${appPort}`, publicUrl],
    mongo: readMongoConfig(env),
    auth: readAuthConfig(env, publicUrl),
    materials: readMaterialsConfig(env, env.OPENAI_API_KEY?.trim() || ''),
  };
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

/**
 * Retrieval configuration for uploaded practice materials.
 *
 * QDRANT_URL is the switch, matching how MONGODB_URI works above: leave it
 * unset and the upload step never appears, no routes are mounted, and the judge
 * is given no search tool. A laptop with no Docker still gets the courtroom.
 */
function readMaterialsConfig(env, apiKey) {
  const qdrantUrl = env.QDRANT_URL?.trim() || '';
  const stub = readFlag(env.MATERIALS_STUB);
  const embeddingModel = env.OPENAI_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small';

  return {
    // Real embeddings need the OpenAI key; stub mode deliberately does not, so
    // the pipeline stays developable with no provider account at all.
    enabled: Boolean(qdrantUrl) && (stub || Boolean(apiKey)),
    stub,
    apiKey,
    qdrant: {
      url: qdrantUrl,
      apiKey: env.QDRANT_API_KEY?.trim() || '',
      collectionBase: env.QDRANT_COLLECTION_NAME?.trim() || 'mootcourt_materials',
    },
    embeddingModel,
    vectorSize: readVectorSize(env, embeddingModel),
    // Reads charts, exhibits and screenshots inside an upload into text.
    visionModel: env.OPENAI_VISION_MODEL?.trim() || 'gpt-5.6-luna',
    visionReasoningEffort: env.OPENAI_VISION_REASONING_EFFORT?.trim() || 'medium',
    chunking: {
      size: Number(env.CHUNK_SIZE || 1000),
      overlap: Number(env.CHUNK_OVERLAP || 200),
      min: Number(env.CHUNK_MIN || 100),
    },
    upload: {
      maxFileBytes: Number(env.MATERIALS_MAX_FILE_BYTES || 25 * 1024 * 1024),
      maxFiles: Number(env.MATERIALS_MAX_FILES || 5),
    },
    search: {
      // Small on purpose: these chunks are read aloud through a voice model, so
      // more context buys less than it costs in latency.
      limit: Number(env.MATERIALS_SEARCH_LIMIT || 4),
      scoreThreshold: Number(env.MATERIALS_SCORE_THRESHOLD || 0),
    },
    // 0 keeps uploaded text indefinitely. Anything else is swept from MongoDB
    // and Qdrant together by pruneExpiredBriefs.
    retentionDays: Number(env.MATERIALS_RETENTION_DAYS || 7),
  };
}

/**
 * Qdrant fixes a collection's dimensionality at creation, so an embedding model
 * whose size is not known here must be declared rather than guessed.
 */
const EMBEDDING_VECTOR_SIZES = Object.freeze({
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
});

function readVectorSize(env, embeddingModel) {
  const known = EMBEDDING_VECTOR_SIZES[embeddingModel];
  if (known) return known;
  const declared = Number(env.QDRANT_VECTOR_SIZE);
  if (!Number.isInteger(declared) || declared <= 0) {
    throw new Error(
      `Unknown embedding model "${embeddingModel}". Set QDRANT_VECTOR_SIZE to its output dimension.`,
    );
  }
  return declared;
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

/**
 * The realtime session the relay opens upstream.
 *
 * `hasMaterials` is per connection, not per deployment: two students can be
 * arguing at once and only one of them may have filed a brief. The tool is
 * offered only to the session that has something to search, so a judge with no
 * materials cannot call a tool that would return nothing.
 */
/**
 * The judge's one tool: a semantic lookup over this student's own filed
 * materials, and nothing else. It takes a natural-language query rather than a
 * document or page reference because retrieval is by meaning — the judge asks
 * for "the standard of review argued" and gets the passage that argues it.
 */
export const SEARCH_MATERIALS_TOOL = Object.freeze({
  type: 'function',
  name: 'search_materials',
  description:
    "Search the written materials this student filed for this moot (their factum, thesis chapters, "
    + 'authorities and exhibits, including text read out of images and charts). Use it to check what '
    + 'they actually argued before challenging them, and to verify any fact or citation they assert '
    + 'aloud. Returns the passages that best match the query, with the file they came from.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'What to look for, in natural language — a legal issue, a claim the student made, or a '
          + 'phrase they used. Full questions work better than keywords.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
});

export function sessionConfig(config, { hasMaterials = false } = {}) {
  return {
    type: 'realtime',
    model: config.model,
    instructions: hasMaterials
      ? `${JUDGE_INSTRUCTIONS} ${MATERIALS_INSTRUCTIONS}`
      : JUDGE_INSTRUCTIONS,
    ...(hasMaterials ? { tools: [SEARCH_MATERIALS_TOOL], tool_choice: 'auto' } : {}),
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
