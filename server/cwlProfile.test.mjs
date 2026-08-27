import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCwlProfile, deriveRole } from './auth/cwlProfile.mjs';

// The local simplesamlphp IdP, real UBC Shibboleth, and passport-saml's own
// normalization each spell the attributes differently. All three must land on
// the same stored record.

test('reads the PUID from the friendly attribute name', () => {
  const result = extractCwlProfile({
    nameID: '_transient123',
    attributes: { ubcEduCwlPuid: ['34567890'], mail: ['bio_student@student.ubc.ca'] },
  });
  assert.equal(result.ok, true);
  assert.equal(result.profile.puid, '34567890');
});

test('reads the PUID from the MACE urn form', () => {
  const result = extractCwlProfile({
    'urn:mace:dir:attribute-def:ubcEduCwlPuid': '23456789',
    attributes: {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.profile.puid, '23456789');
});

test('reads the PUID from the OID form', () => {
  const result = extractCwlProfile({
    attributes: { 'urn:oid:1.3.6.1.4.1.60.6.1.6': ['45678901'] },
  });
  assert.equal(result.ok, true);
  assert.equal(result.profile.puid, '45678901');
});

test('rejects a login with no PUID rather than creating an unidentifiable user', () => {
  const result = extractCwlProfile({ nameID: '_transient123', attributes: { mail: ['x@ubc.ca'] } });
  assert.equal(result.ok, false);
  assert.match(result.error, /ubcEduCwlPuid/);
});

test('faculty alone becomes an instructor', () => {
  assert.equal(deriveRole(['faculty']), 'instructor');
});

test('a dual faculty and student affiliation stays a student', () => {
  assert.equal(deriveRole(['faculty', 'student']), 'student');
});

test('staff, member and employee are not enough for instructor', () => {
  assert.equal(deriveRole(['staff', 'member', 'employee']), 'student');
});

test('no affiliation at all defaults to student', () => {
  assert.equal(deriveRole([]), 'student');
  assert.equal(deriveRole(undefined), 'student');
});

test('maps the local IdP bio_student fixture the way it will be stored', () => {
  // Matches config/simplesamlphp/authsources.php in ubc/docker-simple-saml.
  const result = extractCwlProfile({
    nameID: '_abc123',
    attributes: {
      uid: ['bio_student'],
      cwlLoginName: ['bio_student'],
      ubcEduCwlPuid: ['34567890'],
      eduPersonAffiliation: ['student'],
      mail: ['bio_student@student.ubc.ca'],
      givenName: ['Bruno'],
      sn: ['Student'],
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.profile, {
    puid: '34567890',
    cwlLoginName: 'bio_student',
    email: 'bio_student@student.ubc.ca',
    givenName: 'Bruno',
    surname: 'Student',
    displayName: 'Bruno Student',
    affiliations: ['student'],
    role: 'student',
    samlNameId: '_abc123',
  });
});

test('maps the local IdP bio_prof fixture to an instructor', () => {
  const result = extractCwlProfile({
    nameID: '_def456',
    attributes: {
      cwlLoginName: ['bio_prof'],
      ubcEduCwlPuid: ['23456789'],
      eduPersonAffiliation: ['faculty'],
      mail: ['BIO_PROF@ubc.ca'],
      givenName: ['Bianca'],
      sn: ['Professor'],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.profile.role, 'instructor');
  // Stored lowercase so a case difference from the IdP cannot split one person
  // into two records.
  assert.equal(result.profile.email, 'bio_prof@ubc.ca');
});

test('accepts scalar attributes as well as single-element arrays', () => {
  const result = extractCwlProfile({
    attributes: { ubcEduCwlPuid: '99999999', eduPersonAffiliation: 'faculty', mail: 'p@ubc.ca' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.profile.puid, '99999999');
  assert.equal(result.profile.role, 'instructor');
});

test('falls back through displayName, assembled name, email, then PUID', () => {
  const fromEmail = extractCwlProfile({ attributes: { ubcEduCwlPuid: ['1'], mail: ['only@ubc.ca'] } });
  assert.equal(fromEmail.profile.displayName, 'only@ubc.ca');

  const fromPuid = extractCwlProfile({ attributes: { ubcEduCwlPuid: ['2'] } });
  assert.equal(fromPuid.profile.displayName, '2');
});
