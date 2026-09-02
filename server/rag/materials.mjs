import { MaterialsStore } from './qdrant.mjs';
import { createProviders } from './providers.mjs';
import { pruneExpiredBriefs } from '../models/brief.mjs';

/**
 * Assembles the materials feature: the Qdrant store, the embedding/vision
 * providers, the retrieval the judge's tool calls, and the retention sweep.
 *
 * Built once at startup and shared by the HTTP routes and the WebSocket relay,
 * so an upload and the judge's search of it go through the same client and the
 * same collection.
 */
export function createMaterialsService(config, databaseService) {
  const store = new MaterialsStore(config.materials);
  const providers = createProviders(config.materials);
  const { limit, scoreThreshold } = config.materials.search;

  /**
   * The judge's search_materials tool.
   *
   * Scoped to one brief, and every failure is answered rather than thrown: the
   * judge is mid-sentence in a voice session, so a dead Qdrant has to come back
   * as "nothing found" and let the moot continue, not as a broken turn.
   *
   * @returns {Promise<{passages: Array<{filename, text, score}>, note?: string}>}
   */
  async function search(briefId, query) {
    const trimmed = String(query || '').trim();
    if (!briefId || !trimmed) return { passages: [] };
    try {
      const vector = await providers.embedOne(trimmed);
      const hits = await store.search(vector, briefId, { limit, scoreThreshold });
      return {
        passages: hits.map(hit => ({
          filename: hit.filename,
          text: hit.text,
          score: Number(hit.score.toFixed(4)),
        })),
      };
    } catch (error) {
      console.warn(`search_materials failed for ${briefId}: ${error.message}`);
      return { passages: [], note: 'The materials could not be searched for this question.' };
    }
  }

  /**
   * Sweeps expired briefs from MongoDB and Qdrant.
   *
   * Runs at startup and daily. `unref` so a pending timer never keeps the
   * process alive after SIGTERM.
   */
  function startRetentionSweep() {
    if (!(config.materials.retentionDays > 0)) return () => {};
    const sweep = async () => {
      const db = databaseService.getDb();
      if (!db) return;
      try {
        const removed = await pruneExpiredBriefs(db, store);
        if (removed) console.log(`Pruned ${removed} expired brief(s).`);
      } catch (error) {
        console.warn(`Brief retention sweep failed: ${error.message}`);
      }
    };
    sweep();
    const timer = setInterval(sweep, 24 * 60 * 60 * 1000);
    timer.unref();
    return () => clearInterval(timer);
  }

  return { store, providers, search, startRetentionSweep };
}
