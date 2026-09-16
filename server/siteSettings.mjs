import fs from 'node:fs/promises';
import path from 'node:path';
import { JUDGE_INSTRUCTIONS } from './config.mjs';

/**
 * Site-wide instructor settings.
 *
 * These apply to every practice session on a deployment: the IntelliJudge
 * prompt and the speaking-pace thresholds students see. They are kept in a
 * JSON file rather than MongoDB because the current deployment runs with no
 * database and no login, and the settings still have to survive a restart.
 *
 * There is deliberately no authentication on writes yet. That matches the rest
 * of this deployment (SHOW_LOGIN off, no identity anywhere). When CWL login is
 * turned on, the write route should require the instructor role — see
 * routes/settings.mjs.
 *
 * Stored shape:
 * {
 *   judgePrompt: String,           // system instructions sent to OpenAI Realtime
 *   showPaceByDefault: Boolean,    // initial state of the student's toggle
 *   wpm: { slowBelow, fastAbove, tooFastAbove }  // words per minute
 * }
 *
 * The pace bands derived from wpm are:
 *   below slowBelow            -> slow   (yellow)
 *   slowBelow .. fastAbove     -> good   (green)
 *   fastAbove .. tooFastAbove  -> fast   (yellow)
 *   tooFastAbove and up        -> too fast (red)
 */

export const MAX_PROMPT_LENGTH = 8000;

export const DEFAULT_SITE_SETTINGS = Object.freeze({
  judgePrompt: JUDGE_INSTRUCTIONS,
  showPaceByDefault: true,
  wpm: Object.freeze({ slowBelow: 120, fastAbove: 160, tooFastAbove: 180 }),
});

function cloneDefaults() {
  return { ...DEFAULT_SITE_SETTINGS, wpm: { ...DEFAULT_SITE_SETTINGS.wpm } };
}

/**
 * Checks a full settings object as submitted by the instructor screen.
 * Returns { value } on success or { errors } listing every problem, so the
 * form can show them all at once rather than one per save attempt.
 */
export function validateSiteSettings(input) {
  const errors = [];
  const value = cloneDefaults();

  if (!input || typeof input !== 'object') {
    return { errors: ['Settings must be an object.'] };
  }

  if (typeof input.judgePrompt !== 'string' || !input.judgePrompt.trim()) {
    errors.push('The IntelliJudge prompt cannot be empty.');
  } else if (input.judgePrompt.length > MAX_PROMPT_LENGTH) {
    errors.push(`The IntelliJudge prompt must be ${MAX_PROMPT_LENGTH} characters or fewer.`);
  } else {
    value.judgePrompt = input.judgePrompt.trim();
  }

  if (typeof input.showPaceByDefault !== 'boolean') {
    errors.push('showPaceByDefault must be true or false.');
  } else {
    value.showPaceByDefault = input.showPaceByDefault;
  }

  const wpm = input.wpm;
  const names = ['slowBelow', 'fastAbove', 'tooFastAbove'];
  if (!wpm || typeof wpm !== 'object') {
    errors.push('Words-per-minute thresholds are missing.');
  } else {
    const parsed = {};
    for (const name of names) {
      const n = Number(wpm[name]);
      if (!Number.isInteger(n) || n < 1 || n > 1000) {
        errors.push(`${name} must be a whole number between 1 and 1000.`);
      } else {
        parsed[name] = n;
      }
    }
    if (names.every(name => name in parsed)) {
      if (!(parsed.slowBelow < parsed.fastAbove && parsed.fastAbove < parsed.tooFastAbove)) {
        errors.push('Thresholds must increase: slowBelow < fastAbove < tooFastAbove.');
      } else {
        value.wpm = parsed;
      }
    }
  }

  return errors.length ? { errors } : { value };
}

/**
 * Loads, caches and persists the settings file. `get()` is synchronous so the
 * relay can read the prompt at the moment it opens an OpenAI session without
 * blocking on disk.
 */
export function createSiteSettingsStore(filePath) {
  let current = cloneDefaults();

  async function load() {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const result = validateSiteSettings(JSON.parse(raw));
      if (result.errors) {
        console.warn(`Ignoring invalid settings file ${filePath}: ${result.errors.join(' ')}`);
        return current;
      }
      current = result.value;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`Could not read settings file ${filePath} (${error.message}). Using defaults.`);
      }
      // No file yet is the normal first-run state: defaults apply until an
      // instructor saves something.
    }
    return current;
  }

  async function save(input) {
    const result = validateSiteSettings(input);
    if (result.errors) return result;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    // Write-then-rename so a crash mid-write cannot leave a truncated file
    // that would silently reset every setting on the next start.
    const tmp = `${filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(result.value, null, 2) + '\n', 'utf8');
    await fs.rename(tmp, filePath);
    current = result.value;
    return { value: current };
  }

  return {
    filePath,
    load,
    save,
    get: () => current,
    defaults: cloneDefaults,
  };
}
