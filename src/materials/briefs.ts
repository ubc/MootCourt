/**
 * Client for the practice-materials API.
 *
 * Unlike practiceSession.ts, which swallows every failure because saving a
 * transcript is optional, these calls surface their errors: a student who
 * uploads a factum and is told nothing has no way to know the judge cannot see
 * it. Only the capability probe is best-effort, because "materials are off" and
 * "the server is unreachable" should both simply hide the step.
 */

export type MaterialsConfig = {
    enabled: boolean;
    stub?: boolean;
    maxFileBytes: number;
    maxFiles: number;
    acceptedExtensions: string[];
    acceptedMimeTypes: string[];
    retentionDays: number;
};

export type BriefDocument = {
    documentId: string;
    filename: string;
    mimeType: string;
    size: number;
    characterCount: number;
    chunkCount: number;
    /** How many images in this file were read into text by the vision model. */
    describedImageCount: number;
    uploadedAt: string;
};

export type Brief = {
    briefId: string;
    title: string;
    documents: BriefDocument[];
    expiresAt: string | null;
};

const DISABLED: MaterialsConfig = {
    enabled: false,
    maxFileBytes: 0,
    maxFiles: 0,
    acceptedExtensions: [],
    acceptedMimeTypes: [],
    retentionDays: 0,
};

let currentBriefId: string | null = null;

/** Reads the server's error message so the student sees the real reason. */
async function failureMessage(response: Response, fallback: string): Promise<string> {
    try {
        const body = await response.json();
        if (typeof body?.error === 'string' && body.error) return body.error;
    } catch { /* non-JSON body */ }
    return fallback;
}

/**
 * Whether this deployment can accept uploads at all. A server with no Qdrant,
 * no database, or no API key answers `{ enabled: false }` and the upload step
 * is skipped entirely — exactly as Moot Court behaved before this existed.
 */
export async function loadMaterialsConfig(): Promise<MaterialsConfig> {
    try {
        const response = await fetch('/api/materials/config', { credentials: 'same-origin' });
        if (!response.ok) return DISABLED;
        const body = await response.json();
        return body?.enabled ? { ...DISABLED, ...body } : DISABLED;
    } catch {
        return DISABLED;
    }
}

/**
 * The brief holding this run's uploads, created on first use.
 *
 * Created here rather than when the practice session starts, because the
 * student uploads before entering the courtroom and the session row does not
 * exist until they do. startPracticeSession attaches this id to the session.
 */
export async function ensureBrief(title?: string): Promise<string> {
    if (currentBriefId) return currentBriefId;
    const response = await fetch('/api/materials/briefs', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title || 'Practice materials' }),
    });
    if (!response.ok) throw new Error(await failureMessage(response, 'Could not start an upload.'));
    currentBriefId = (await response.json()).brief.briefId;
    return currentBriefId as string;
}

/**
 * Uploads and indexes one file.
 *
 * Deliberately awaits the whole pipeline — parse, image description, embed,
 * store — rather than returning on receipt. A PDF full of scanned exhibits can
 * take minutes, and a student told "uploaded" before indexing finished would
 * walk into a courtroom whose judge cannot search what they just filed.
 */
export async function uploadDocument(briefId: string, file: File): Promise<Brief> {
    const body = new FormData();
    body.append('file', file);
    const response = await fetch(`/api/materials/briefs/${briefId}/documents`, {
        method: 'POST',
        credentials: 'same-origin',
        body,
    });
    if (!response.ok) throw new Error(await failureMessage(response, `Could not upload ${file.name}.`));
    return (await response.json()).brief;
}

/** Full extracted text, including any image descriptions, for the preview modal. */
export async function fetchDocumentText(briefId: string, documentId: string): Promise<string> {
    const response = await fetch(
        `/api/materials/briefs/${briefId}/documents/${documentId}/text`,
        { credentials: 'same-origin' },
    );
    if (!response.ok) throw new Error(await failureMessage(response, 'Could not load the extracted text.'));
    return (await response.json()).text || '';
}

export async function deleteDocument(briefId: string, documentId: string): Promise<Brief> {
    const response = await fetch(`/api/materials/briefs/${briefId}/documents/${documentId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(await failureMessage(response, 'Could not remove that file.'));
    return (await response.json()).brief;
}

/**
 * The brief the judge should search, or null when nothing was uploaded.
 * Read by ServerUtility when it opens the realtime socket.
 */
export function getCurrentBriefId(): string | null {
    return currentBriefId;
}

/** Cleared between runs so one student's brief cannot follow another's session. */
export function resetBrief(): void {
    currentBriefId = null;
}

export const __testing = { failureMessage, DISABLED };
