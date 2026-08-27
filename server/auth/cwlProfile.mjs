/**
 * Turns a raw SAML assertion from UBC CWL into the fields Moot Court stores.
 *
 * Kept free of passport and MongoDB so the attribute handling — the part that
 * actually breaks between the local simplesamlphp IdP and real Shibboleth — can
 * be tested directly.
 *
 * Every CWL attribute arrives under any of three spellings depending on whether
 * the IdP sends friendly names or raw URNs, so each is checked in turn. This
 * mirrors what BiocBot does in src/config/passport.js.
 */

const OIDS = {
  ubcEduCwlPuid: 'urn:oid:1.3.6.1.4.1.60.6.1.6',
  mail: 'urn:oid:0.9.2342.19200300.100.1.3',
  displayName: 'urn:oid:2.16.840.1.113730.3.1.241',
  eduPersonAffiliation: 'urn:oid:1.3.6.1.4.1.5923.1.1.1.1',
  givenName: 'urn:oid:2.5.4.42',
  sn: 'urn:oid:2.5.4.4',
  cwlLoginName: 'urn:oid:1.3.6.1.4.1.60.6.1.1',
};

/** SAML attributes may arrive as a scalar or a single-element array. */
function first(value) {
  if (Array.isArray(value)) return value.length ? first(value[0]) : undefined;
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text === '' ? undefined : text;
}

function attribute(profile, name) {
  const attributes = profile?.attributes || {};
  return first(
    attributes[name]
      ?? profile?.[name]
      ?? profile?.[`urn:mace:dir:attribute-def:${name}`]
      ?? attributes[`urn:mace:dir:attribute-def:${name}`]
      ?? profile?.[OIDS[name]]
      ?? attributes[OIDS[name]],
  );
}

function attributeList(profile, name) {
  const attributes = profile?.attributes || {};
  const raw = attributes[name]
    ?? profile?.[name]
    ?? profile?.[`urn:mace:dir:attribute-def:${name}`]
    ?? attributes[`urn:mace:dir:attribute-def:${name}`]
    ?? profile?.[OIDS[name]]
    ?? attributes[OIDS[name]];
  if (raw === null || raw === undefined) return [];
  return (Array.isArray(raw) ? raw : [raw])
    .map(entry => String(entry).trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Role comes from CWL affiliation and nothing else.
 *
 * Only a pure 'faculty' affiliation earns instructor. Someone who is both
 * faculty and student — a grad student who also teaches — is treated as a
 * student, which is the conservative reading and matches BiocBot. 'staff',
 * 'member' and 'employee' are never sufficient on their own.
 */
export function deriveRole(affiliations) {
  const list = Array.isArray(affiliations) ? affiliations : [];
  const isFaculty = list.includes('faculty');
  const isStudent = list.includes('student');
  return isFaculty && !isStudent ? 'instructor' : 'student';
}

/**
 * @returns {{ok: true, profile: object} | {ok: false, error: string}}
 */
export function extractCwlProfile(samlProfile) {
  const puid = attribute(samlProfile, 'ubcEduCwlPuid');

  // PUID is the stable per-person identifier and the key every session record
  // hangs off. Without it there is no dependable identity, so the login is
  // rejected rather than silently creating a duplicate account on each visit.
  if (!puid) {
    return {
      ok: false,
      error: 'CWL response did not include ubcEduCwlPuid. Confirm the service provider is registered to release that attribute.',
    };
  }

  const email = attribute(samlProfile, 'mail') || attribute(samlProfile, 'email');
  const givenName = attribute(samlProfile, 'givenName');
  const surname = attribute(samlProfile, 'sn');
  const assembledName = [givenName, surname].filter(Boolean).join(' ');
  const affiliations = attributeList(samlProfile, 'eduPersonAffiliation');

  return {
    ok: true,
    profile: {
      puid,
      cwlLoginName: attribute(samlProfile, 'cwlLoginName') || attribute(samlProfile, 'uid') || null,
      email: email ? email.toLowerCase() : null,
      givenName: givenName || null,
      surname: surname || null,
      displayName: attribute(samlProfile, 'displayName')
        || attribute(samlProfile, 'cn')
        || assembledName
        || email
        || puid,
      affiliations,
      role: deriveRole(affiliations),
      // nameID is transient with this IdP, so it is recorded for audit and
      // single-logout only — never used to look a user up.
      samlNameId: samlProfile?.nameID || null,
    },
  };
}

export const __testing = { first, attribute, attributeList, OIDS };
