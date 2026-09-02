import React, { useCallback, useRef, useState } from "react";
import {
    ensureBrief,
    uploadDocument,
    deleteDocument,
    Brief,
    BriefDocument,
    MaterialsConfig,
} from "../../materials/briefs";
import MaterialTextModal from "./MaterialTextModal";
import "./UploadPage.css";

/**
 * The step between the landing menu and the courtroom, where a student files
 * the materials the judge will be able to search.
 *
 * Skipping is a first-class outcome, not an escape hatch: uploading is optional
 * and a student who continues without filing anything gets exactly the moot
 * they got before this feature existed. The continue button therefore says so
 * plainly rather than being disabled or hidden behind a confirmation.
 */

type Props = {
    materialsConfig: MaterialsConfig;
    onContinue: () => void;
    onBack: () => void;
};

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadPage({ materialsConfig, onContinue, onBack }: Props) {
    const [brief, setBrief] = useState<Brief | null>(null);
    const [busyWith, setBusyWith] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [dragging, setDragging] = useState(false);
    const [viewing, setViewing] = useState<BriefDocument | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    const documents = brief?.documents ?? [];
    const atLimit = documents.length >= materialsConfig.maxFiles;

    const addFiles = useCallback(async (files: FileList | null) => {
        if (!files?.length || busyWith) return;
        setError("");

        // One at a time: each upload runs a full parse-and-index on the server,
        // and a student watching four progress states at once cannot tell which
        // file failed when one does.
        const queue = Array.from(files).slice(0, materialsConfig.maxFiles - documents.length);
        try {
            const briefId = await ensureBrief();
            for (const file of queue) {
                if (file.size > materialsConfig.maxFileBytes) {
                    throw new Error(`${file.name} is larger than ${formatSize(materialsConfig.maxFileBytes)}.`);
                }
                setBusyWith(file.name);
                setBrief(await uploadDocument(briefId, file));
            }
        } catch (problem) {
            setError(problem instanceof Error ? problem.message : "That upload failed.");
        } finally {
            setBusyWith(null);
            // Without this, re-picking the same file after a failure fires no
            // change event and looks like the button stopped working.
            if (fileInput.current) fileInput.current.value = "";
        }
    }, [busyWith, documents.length, materialsConfig.maxFileBytes, materialsConfig.maxFiles]);

    const removeFile = async (documentId: string) => {
        if (!brief || busyWith) return;
        setError("");
        setBusyWith(documentId);
        try {
            setBrief(await deleteDocument(brief.briefId, documentId));
        } catch (problem) {
            setError(problem instanceof Error ? problem.message : "That file could not be removed.");
        } finally {
            setBusyWith(null);
        }
    };

    return (
        <div className="materialsPage">
            <div className="materialsPanel">
                <h1 className="materialsTitle">Your materials</h1>
                <p className="materialsIntro">
                    Upload the written work you want the judge to question you on — your factum, a thesis
                    chapter, authorities. The judge reads it while you argue and challenges what you actually
                    wrote. Charts, exhibits and screenshots inside a file are read into text too.
                </p>

                <div
                    className={`materialsDropzone${dragging ? " isDragging" : ""}${atLimit ? " isDisabled" : ""}`}
                    onDragOver={event => { event.preventDefault(); if (!atLimit) setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={event => {
                        event.preventDefault();
                        setDragging(false);
                        if (!atLimit) addFiles(event.dataTransfer.files);
                    }}
                >
                    <input
                        ref={fileInput}
                        type="file"
                        multiple
                        className="materialsFileInput"
                        accept={materialsConfig.acceptedMimeTypes.join(",")}
                        disabled={Boolean(busyWith) || atLimit}
                        onChange={event => addFiles(event.target.files)}
                    />
                    {busyWith && !documents.some(file => file.documentId === busyWith) ? (
                        <>
                            <p className="materialsDropTitle">Reading {busyWith}…</p>
                            <p className="materialsMuted">
                                Extracting the text and describing any images. A long or image-heavy file can take
                                a minute or two.
                            </p>
                        </>
                    ) : (
                        <>
                            <p className="materialsDropTitle">
                                {atLimit ? "That's the maximum for one session" : "Drop a PDF or Word file here, or click to choose"}
                            </p>
                            <p className="materialsMuted">
                                PDF and .docx, up to {formatSize(materialsConfig.maxFileBytes)} each,
                                {" "}{materialsConfig.maxFiles} files per session.
                            </p>
                        </>
                    )}
                </div>

                {error && <p className="materialsError" role="alert">{error}</p>}

                {documents.length > 0 && (
                    <ul className="materialsList">
                        {documents.map(file => (
                            <li key={file.documentId} className="materialsListItem">
                                <div className="materialsListText">
                                    <span className="materialsFilename">{file.filename}</span>
                                    <span className="materialsMuted">
                                        {formatSize(file.size)} · {file.chunkCount} searchable passage
                                        {file.chunkCount === 1 ? "" : "s"}
                                        {file.describedImageCount > 0
                                            ? ` · ${file.describedImageCount} image${file.describedImageCount === 1 ? "" : "s"} read`
                                            : ""}
                                    </span>
                                </div>
                                <div className="materialsListActions">
                                    <button type="button" className="materialsButton" onClick={() => setViewing(file)}>
                                        View text
                                    </button>
                                    <button
                                        type="button"
                                        className="materialsButton materialsButtonQuiet"
                                        disabled={busyWith === file.documentId}
                                        onClick={() => removeFile(file.documentId)}
                                    >
                                        {busyWith === file.documentId ? "Removing…" : "Remove"}
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}

                <p className="materialsPrivacy">
                    The file itself is never stored — only the text read out of it, and only
                    {materialsConfig.retentionDays > 0
                        ? ` for ${materialsConfig.retentionDays} days`
                        : " for as long as this deployment keeps it"}.
                    {materialsConfig.stub ? " This server is running in stub mode: text is indexed but images are not read." : ""}
                </p>

                <div className="materialsActions">
                    <button type="button" className="button materialsButton materialsButtonQuiet" onClick={onBack} disabled={Boolean(busyWith)}>
                        Back
                    </button>
                    <button type="button" className="button materialsButton materialsButtonPrimary" onClick={onContinue} disabled={Boolean(busyWith)}>
                        {documents.length ? "Enter the courtroom" : "Continue without materials"}
                    </button>
                </div>
            </div>

            {viewing && brief && (
                <MaterialTextModal briefId={brief.briefId} document={viewing} onClose={() => setViewing(null)} />
            )}
        </div>
    );
}
