import { randomUUID } from 'node:crypto';
import { QdrantClient } from '@qdrant/js-client-rest';

/**
 * Qdrant storage for uploaded practice materials.
 *
 * One collection holds every brief; a `briefId` payload filter is what keeps
 * one student's thesis material out of another student's argument. That filter
 * is not an optimisation — it is the privacy boundary — so it is applied on
 * every read path in this file and there is no unfiltered search.
 *
 * Follows BiocBot's qdrantService.js (a direct @qdrant/js-client-rest client
 * rather than the RAG toolkit module) because Moot Court needs exactly this one
 * filtered lookup and nothing the higher-level module adds.
 */

/**
 * Vectors from different embedding models are not comparable and Qdrant cannot
 * change a collection's dimensionality after creation, so the model is part of
 * the name. Switching models creates a new collection instead of silently
 * mixing incompatible vectors or failing on upsert.
 *
 * Stub vectors get their own collection for the same reason, even though they
 * share a dimension with the real ones: a developer who runs with
 * MATERIALS_STUB and then turns it off would otherwise be searching one
 * collection holding both real embeddings and fake ones, which retrieves
 * plausible nonsense. BiocBot separates its stub collection the same way.
 */
export function collectionNameFor(base, embeddingModel, vectorSize, stub = false) {
  const slug = String(embeddingModel).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `${base}${stub ? '_stub' : ''}_${slug}_${vectorSize}`;
}

export class MaterialsStore {
  constructor(ragConfig) {
    this.config = ragConfig;
    this.collection = collectionNameFor(
      ragConfig.qdrant.collectionBase,
      ragConfig.embeddingModel,
      ragConfig.vectorSize,
      ragConfig.stub,
    );
    this.client = new QdrantClient({
      url: ragConfig.qdrant.url,
      apiKey: ragConfig.qdrant.apiKey || undefined,
      checkCompatibility: false,
    });
    this.ready = null;
  }

  /**
   * Creates the collection and its payload index on first use. Idempotent and
   * memoised: every write and read awaits the same promise, so concurrent
   * uploads on a cold server cannot race each other into a duplicate create.
   */
  async ensureCollection() {
    if (!this.ready) {
      this.ready = this.#createCollection().catch(error => {
        // A failed attempt must not be cached, or the server stays broken until
        // it restarts even after Qdrant comes back.
        this.ready = null;
        throw error;
      });
    }
    return this.ready;
  }

  async #createCollection() {
    const { collections } = await this.client.getCollections();
    if (!collections.some(entry => entry.name === this.collection)) {
      await this.client.createCollection(this.collection, {
        vectors: { size: this.config.vectorSize, distance: 'Cosine' },
      });
      console.log(`Qdrant collection created: ${this.collection}`);
    }
    // Without this index Qdrant still filters correctly but scans the payload;
    // it is created unconditionally because the call is idempotent.
    await this.client.createPayloadIndex(this.collection, {
      field_name: 'briefId',
      field_schema: 'keyword',
      wait: true,
    }).catch(() => { /* already indexed */ });
  }

  /**
   * @param {{briefId: string, documentId: string, filename: string}} document
   * @param {Array<{text: string, index: number}>} chunks
   * @param {number[][]} vectors Parallel to `chunks`.
   */
  async upsertChunks(document, chunks, vectors) {
    await this.ensureCollection();
    if (!chunks.length) return 0;

    const points = chunks.map((chunk, i) => ({
      id: randomUUID(),
      vector: vectors[i],
      payload: {
        briefId: document.briefId,
        documentId: document.documentId,
        filename: document.filename,
        chunkIndex: chunk.index,
        text: chunk.text,
      },
    }));

    // Batched because a whole thesis in one request can exceed Qdrant's body
    // limit, and a partial failure is easier to reason about per batch.
    const BATCH = 64;
    for (let i = 0; i < points.length; i += BATCH) {
      await this.client.upsert(this.collection, { wait: true, points: points.slice(i, i + BATCH) });
    }
    return points.length;
  }

  /**
   * Nearest chunks within one brief.
   *
   * @param {number[]} queryVector
   * @param {string} briefId Required. A search without it would read every
   *   student's uploads, so it is rejected rather than defaulted.
   */
  async search(queryVector, briefId, { limit = 5, scoreThreshold = 0 } = {}) {
    if (!briefId) throw new Error('search requires a briefId');
    await this.ensureCollection();

    // The Query API, not the removed `search` helper: the 1.19 client dropped
    // it, and `query` is what both that client and the 1.17 server speak.
    const { points } = await this.client.query(this.collection, {
      query: queryVector,
      limit,
      score_threshold: scoreThreshold || undefined,
      filter: { must: [{ key: 'briefId', match: { value: briefId } }] },
      with_payload: true,
    });

    return (points || []).map(result => ({
      score: result.score,
      text: result.payload?.text || '',
      filename: result.payload?.filename || '',
      chunkIndex: result.payload?.chunkIndex ?? 0,
    }));
  }

  /** Removes every chunk belonging to a brief. Used when a student clears their materials. */
  async deleteBrief(briefId) {
    if (!briefId) throw new Error('deleteBrief requires a briefId');
    await this.ensureCollection();
    await this.client.delete(this.collection, {
      wait: true,
      filter: { must: [{ key: 'briefId', match: { value: briefId } }] },
    });
  }

  /** Removes one document's chunks, leaving the rest of the brief intact. */
  async deleteDocument(briefId, documentId) {
    if (!briefId || !documentId) throw new Error('deleteDocument requires a briefId and documentId');
    await this.ensureCollection();
    await this.client.delete(this.collection, {
      wait: true,
      filter: {
        must: [
          { key: 'briefId', match: { value: briefId } },
          { key: 'documentId', match: { value: documentId } },
        ],
      },
    });
  }

  /** Cheap reachability probe for /api/health, so a dead Qdrant is visible. */
  async healthCheck() {
    try {
      await this.client.getCollections();
      return { reachable: true, collection: this.collection };
    } catch (error) {
      return { reachable: false, collection: this.collection, error: error.message };
    }
  }
}
