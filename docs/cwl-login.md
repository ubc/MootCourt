# MongoDB and CWL login

Moot Court stores practice sessions in MongoDB and can identify students through
UBC CWL. Both are optional and controlled entirely by environment variables, so
the same build runs locally, in staging and in production.

This follows the pattern BiocBot and GRASP already use: the application code has
no per-environment branches, only different values for `MONGODB_URI`,
`MONGODB_DB_NAME` and the `SAML_*` variables.

## The privacy switch

`SHOW_LOGIN` decides whether this deployment collects personal information.

| | `SHOW_LOGIN=false` (default) | `SHOW_LOGIN=true` |
|---|---|---|
| Login screen | Not shown | CWL sign-in required before the courtroom loads |
| `/auth/*` routes | **Not mounted — they return 404** | Mounted |
| SAML strategy | Never registered | UBC Shibboleth |
| CWL attributes read | None | PUID, CWL login name, email, name, affiliation |
| `users` collection | Never written | One document per person |
| Practice sessions | `userId: null, puid: null, anonymous: true` | Linked to the signed-in user |
| Session cookie | None issued | `mootcourt.sid` |

The distinction that matters while a PIA is pending is that anonymous mode does
not merely hide a button. The routes that could receive a SAML assertion are
never registered with Express, so there is no endpoint through which CWL data
could arrive. `server/showLogin.test.mjs` asserts this directly, including that
a POST to `/auth/saml/callback` returns 404.

The flag defaults to off and only `true`, `True`, `TRUE` or `1` turn it on — a
typo leaves login disabled rather than silently enabling collection.

**Anonymous mode still saves transcripts.** A row in `practice_sessions` holds
the spoken transcript and word-level timings with no identity attached. That is
what the assessment page needs, but it is still content a person produced, so it
is worth naming explicitly in the PIA rather than assuming "anonymous" means
"no personal information". To store nothing at all, leave `MONGODB_URI` unset.

## Local setup

### 1. MongoDB

Moot Court does not ship a compose file. It uses the shared
[`ubc/tlef-mongodb-docker`](https://github.com/ubc/tlef-mongodb-docker)
instance — the same one BiocBot and GRASP connect to — and simply takes its own
database name on it. If it is not already running:

```bash
git clone https://github.com/ubc/tlef-mongodb-docker
cd tlef-mongodb-docker && cp .env.example .env && docker compose up -d
```

That gives you MongoDB on `localhost:27017` and mongo-express on
[http://localhost:8081](http://localhost:8081).

Then in `.env.server.local`:

```bash
MONGODB_URI=mongodb://mongoadmin:secret@127.0.0.1:27017/?authSource=admin
MONGODB_DB_NAME=mootcourt_dev
```

Databases on one MongoDB instance are isolated from each other, so
`mootcourt_dev` sits alongside `biocbot-dev` and `tlef_grasp` without
interfering. Use a distinct name per environment — never point staging at the
production database.

`npm run dev` is enough at this point — sessions save anonymously.

### 2. The fake CWL identity provider

Login uses [`ubc/docker-simple-saml`](https://github.com/ubc/docker-simple-saml),
the same local IdP BiocBot uses, on port 8080.

Moot Court must be registered there as a service provider. The default
attribute set in that project does **not** include `ubcEduCwlPuid`, so a plain
entry is not enough — Moot Court needs its own block. Append this to
`config/simplesamlphp/saml20-sp-remote.php`:

```php
$metadata['http://localhost:43127'] = array(
	'AssertionConsumerService' => array(
		array(
			'index'    => 0,
			'Binding'  => 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
			'Location' => 'http://localhost:43127/auth/saml/callback',
		),
	),
	'SingleLogoutService'      => array(
		array(
			'Binding'  => 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
			'Location' => 'http://localhost:43127/auth/logout',
		),
	),
	'NameIDFormat'             => 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
	'simplesaml.attributes'    => true,
	'attributes'               => array_merge( $default_attributes, array( 'ubcEduCwlPuid', 'mail', 'cwlLoginName' ) ),
	'saml20.sign.assertion'    => true,
	'saml20.sign.response'     => true,
	'validate.authnrequest'    => false,
	'validate.logout'          => false,
);
```

That file is a bind mount and SimpleSAMLphp reads flatfile metadata per request,
so no container restart is needed.

### 3. Turn login on

In `.env.server.local`:

```bash
SHOW_LOGIN=true
SESSION_SECRET=<openssl rand -base64 32>
SAML_ISSUER=http://localhost:43127
SAML_CALLBACK_URL=http://localhost:43127/auth/saml/callback
SAML_ENTRY_POINT=http://localhost:8080/simplesaml/saml2/idp/SSOService.php
SAML_LOGOUT_URL=http://localhost:8080/simplesaml/saml2/idp/SingleLogoutService.php
SAML_CERT_PATH=/absolute/path/to/docker-simple-saml/cert/server.crt
```

Restart `npm run dev` and sign in at http://localhost:43127.

Test accounts from the IdP's `authsources.php`:

| Username / password | Affiliation | PUID | Role in Moot Court |
|---|---|---|---|
| `bio_student` | student | 34567890 | student |
| `bio_student2` | student | 56789012 | student |
| `bio_prof` | faculty | 23456789 | instructor |
| `bio_prof2` | faculty | 45678901 | instructor |

## Why the React dev server proxies /auth

SAML sends the browser to the IdP, and the IdP posts the assertion back to a
callback URL. That URL and the app have to be the same origin, or the session
cookie set by the callback is invisible to the app.

In development the app is on 43127 (react-scripts) and the API on 43128 (Node).
`src/setupProxy.js` forwards `/api` and `/auth` from 43127 to 43128, so the
browser only ever sees `http://localhost:43127` — which is why that is the
origin registered as the service provider. In production the Node server serves
the built frontend itself and the question does not arise.

## What is stored

### `users` — only ever written with `SHOW_LOGIN=true`

```js
{
  userId:       'user_<uuid>',    // internal id; what the session cookie carries
  puid:         '34567890',       // ubcEduCwlPuid — the CWL identifier, unique
  cwlLoginName: 'bio_student',
  email:        'bio_student@student.ubc.ca',
  displayName:  'Bruno Student',
  givenName:    'Bruno',
  surname:      'Student',
  affiliations: ['student'],      // eduPersonAffiliation as released by the IdP
  role:         'student',        // derived from affiliation, never self-asserted
  samlNameId:   '_27dea21d...',   // transient; kept for single logout only
  authProvider: 'cwl',
  isActive:     true,
  lastLogin:    ISODate, createdAt: ISODate, updatedAt: ISODate
}
```

PUID is the primary key, matching BiocBot. The nameID is transient with this IdP
and changes every login, so it is never used to look a user up.

Attributes are refreshed on every login, so a name change or an affiliation
change (a student who becomes faculty) is picked up without manual editing.

### Role determination

`role` comes from `eduPersonAffiliation` and nothing else:

- `faculty` and **not** `student` → `instructor`
- everything else → `student`

Someone holding both faculty and student affiliations is treated as a student.
`staff`, `member` and `employee` are never sufficient on their own. This is the
conservative reading and matches BiocBot.

### `practice_sessions` — written in both modes

```js
{
  sessionId:         'session_<uuid>',
  userId:            'user_<uuid>' | null,
  puid:              '34567890'    | null,
  anonymous:         false | true,
  playerPosition:    'Appellant' | 'Respondent',
  startedAt:         ISODate, endedAt: ISODate | null,
  judgeElapsedTime:  4200,
  wordCount:         312,
  conversation:      [{ role, content, at }],
  runningTimestamps: [[word, startTime, endTime]],   // drives the assessment plot
  settings:          { totalTime, questionInterval, isInteliJudge }
}
```

Reads are scoped by identity: with login on, one student cannot fetch another's
session even with the id.

### `sessions`

Express session store, managed by `connect-mongo`, 24-hour TTL. Only exists
when login is on.

## Staging and production

Nothing in the code changes. Set:

```bash
NODE_ENV=production
PUBLIC_URL=https://mootcourt.example.ubc.ca
MONGODB_URI=<managed connection string>
MONGODB_DB_NAME=mootcourt_staging      # or mootcourt_prod
SHOW_LOGIN=false                       # until the PIA is approved
SESSION_SECRET=<secret store>
```

`NODE_ENV=production` turns on secure cookies and `trust proxy`, so the app must
be behind TLS. When the PIA clears, register the deployed ACS URL
(`https://.../auth/saml/callback`) with UBC IAM, point the `SAML_*` variables at
the real Shibboleth IdP, set `SAML_ENVIRONMENT=PRODUCTION`, and flip
`SHOW_LOGIN=true`.

Use a separate database name per environment, as BiocBot and GRASP do
(`biocbot-dev`, `biocbot-ci`). Never point staging at the production database.

## API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/health` | Status, login mode, masked database URI |
| `GET` | `/api/auth/config` | Always available; tells the frontend whether to show a login screen |
| `GET` | `/auth/login` | Starts the CWL round trip — 404 when login is off |
| `POST` | `/auth/saml/callback` | Assertion consumer — 404 when login is off |
| `GET` | `/api/auth/me` | Current user — 404 when login is off |
| `POST` | `/auth/logout` | Ends the session |
| `POST` | `/api/sessions` | Start a practice session |
| `PATCH` | `/api/sessions/:id` | Save transcript, timings, elapsed time |
| `GET` | `/api/sessions/:id` | Read one session |
| `GET` | `/api/sessions` | List own sessions (empty when anonymous) |

## Tests

```bash
npm run test:server
```

`server/cwlProfile.test.mjs` covers attribute extraction across all three
encodings the IdP may use and the role rules.
`server/showLogin.test.mjs` covers the flag parsing, the startup validation, and
that anonymous mode exposes no CWL route and issues no cookie.
