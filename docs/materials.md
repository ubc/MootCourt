# Practice materials

A student can file written materials — a factum, thesis chapters, authorities —
before entering the courtroom. The judge searches them while the moot is
running and challenges what the student actually wrote.

Off by default. Setting `QDRANT_URL` turns it on; without it the upload step
never appears, no upload routes are mounted, and the judge is given no search
tool, so the courtroom is exactly what it was before this existed.

## What happens to an upload

```
  .pdf / .docx
       |
       |  ubc-genai-toolkit-document-parsing
       v
  text  <----  every embedded image is sent to a vision model and
       |       its description is inlined where the image sat
       |
       |  paragraph-aware chunking (server/rag/chunking.mjs)
       v
  chunks ---> OpenAI embeddings ---> Qdrant, tagged with the briefId
       |
       +-----> extracted text ---> MongoDB, for the "view text" modal
```

The original file is never stored. It exists in memory for the request and in
one temp file during parsing, removed in a `finally`. What persists is the text
read out of it and the vectors, and both are deleted together after
`MATERIALS_RETENTION_DAYS`.

### Images

This is the part worth understanding, because a legal brief carries a lot of its
content in exhibits. `DocumentParsingModule` extracts each embedded raster image
and hands it to the `imageDescriber` this project supplies
(`server/rag/openai.mjs`), which asks `OPENAI_VISION_MODEL` to transcribe the
text in it and read out any chart or table. The description is inlined into the
document at the point the image appeared, and from there it is chunked,
embedded and retrieved like any other prose — so a judge that can only read
still gets what was in the figure.

The parser de-duplicates identical images and skips ones that recur across many
pages, so a logo on every page costs one call, not one per page. A single image
that fails to describe is skipped; it never fails the upload.

BiocBot and GRASP use the same toolkit and the same `imageDescriber` hook.

## Scoping

One Qdrant collection holds every brief, and a `briefId` payload filter
separates them. That filter is the privacy boundary, not an optimisation:
`MaterialsStore.search` requires a briefId and there is no unfiltered read path.

A brief is created when the student first uploads, before the practice session
row exists — the session is not created until they enter the courtroom. The
briefId is attached to the session at that point, so a saved run records what
the judge was able to search.

## How the judge reaches it

The judge is an OpenAI Realtime voice session, so retrieval is a function tool
rather than context stuffed into a prompt:

1. The browser opens `ws://…/realtime?brief=<briefId>`. The brief has to be on
   the URL because the relay configures the upstream session — including whether
   a tool is offered at all — the moment the socket opens.
2. `sessionConfig` adds the `search_materials` tool only when a brief is
   present, so a student who uploaded nothing gets an unchanged judge.
3. Mid-argument the model calls the tool. The relay embeds the query, searches
   that brief, sends the passages back as `function_call_output`, and asks for
   the spoken reply.

The subtlety is in `server/relay.mjs`: a response containing only a function
call completes exactly like a spoken one. Ending the student's turn there would
unlock the microphone while the judge is still thinking, so the turn stays
`busy` across the tool leg and the browser sees one reply per recording.

The loop is bounded at `MAX_TOOL_ROUNDS` searches. On the last round the tool is
withheld from the request (`tool_choice: 'none'`), which is what actually makes
the model speak rather than merely discouraging it from searching again.

A search never fails a moot. A dead Qdrant returns no passages and the judge
asks its question from the oral argument alone.

## Configuration

See the "Practice materials" section of `.env.server.example`. The two that
matter most:

- `QDRANT_URL` — the switch. Uses the shared local Qdrant from
  `ubc/tlef-qdrant` on port 6333, the same instance BiocBot and GRASP use.
- `MATERIALS_STUB=1` — develops the pipeline with no OpenAI account and no
  network, using deterministic fake vectors. Stub vectors go to a separate
  collection so they can never be searched alongside real ones. Never set it in
  staging or production.

Uploads also need `MONGODB_URI`. With either store missing the feature stays off
rather than half-working, and the frontend hides the step.

## Layout

| Path | What it does |
| --- | --- |
| `server/rag/ingest.mjs` | parse → chunk → embed → store, for one file |
| `server/rag/openai.mjs` | embeddings and image description over the REST API |
| `server/rag/chunking.mjs` | paragraph-aware chunking with overlap |
| `server/rag/qdrant.mjs` | the collection, the briefId filter, deletion |
| `server/rag/providers.mjs` | real OpenAI calls, or the stub |
| `server/rag/materials.mjs` | assembles the above; the judge's `search` and the retention sweep |
| `server/models/brief.mjs` | the MongoDB side, ownership, and expiry |
| `server/routes/materials.mjs` | upload, list, text, delete |
| `src/components/ui/UploadPage.tsx` | the step between the landing menu and the courtroom |
| `src/components/ui/MaterialTextModal.tsx` | "view uploaded text" |
| `src/materials/briefs.ts` | the client for the above |

Tests: `npm run test:server` (`server/materials.test.mjs` for the pipeline and
routes, `server/relay.test.mjs` for the search tool).
