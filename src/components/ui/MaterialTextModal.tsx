import React, { useEffect, useRef, useState } from "react";
import { fetchDocumentText, BriefDocument } from "../../materials/briefs";
import "./UploadPage.css";

/**
 * Shows exactly what the judge will search for one uploaded file.
 *
 * This is not a document preview — it is the extracted text, which is a
 * different thing and the difference is the point. A student who uploads a
 * scanned exhibit and sees an empty panel here has learned something useful
 * before they start arguing, and a student who sees their charts written out as
 * prose can tell that the vision model read them correctly.
 */

/** The parser inlines image descriptions as `[Image] …` / `[Image, page N] …`. */
const IMAGE_LINE = /^\s*>?\s*\[Image(,[^\]]*)?\]/;

type Props = {
    briefId: string;
    document: BriefDocument;
    onClose: () => void;
};

export default function MaterialTextModal({ briefId, document: file, onClose }: Props) {
    const [text, setText] = useState<string | null>(null);
    const [error, setError] = useState("");
    const closeButton = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        let cancelled = false;
        fetchDocumentText(briefId, file.documentId)
            .then(value => { if (!cancelled) setText(value); })
            .catch(problem => { if (!cancelled) setError(problem.message); });
        return () => { cancelled = true; };
    }, [briefId, file.documentId]);

    // Escape closes, and focus starts inside the dialog rather than wherever the
    // student last clicked on the page behind it.
    useEffect(() => {
        closeButton.current?.focus();
        const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    return (
        <div className="materialsModalBackdrop" onClick={onClose}>
            <div
                className="materialsModal"
                role="dialog"
                aria-modal="true"
                aria-label={`Extracted text from ${file.filename}`}
                onClick={event => event.stopPropagation()}
            >
                <header className="materialsModalHeader">
                    <div>
                        <h2>{file.filename}</h2>
                        <p className="materialsModalMeta">
                            {file.characterCount.toLocaleString()} characters · {file.chunkCount} searchable passages
                            {file.describedImageCount > 0
                                ? ` · ${file.describedImageCount} image${file.describedImageCount === 1 ? "" : "s"} read into text`
                                : ""}
                        </p>
                    </div>
                    <button ref={closeButton} type="button" className="materialsIconButton" onClick={onClose} aria-label="Close">
                        ×
                    </button>
                </header>

                <div className="materialsModalBody">
                    {error && <p className="materialsError">{error}</p>}
                    {!error && text === null && <p className="materialsMuted">Loading the extracted text…</p>}
                    {text !== null && text.length === 0 && (
                        <p className="materialsMuted">This file produced no text.</p>
                    )}
                    {text !== null && text.length > 0 && (
                        <pre className="materialsExtractedText">
                            {text.split("\n").map((line, index) => (
                                <span key={index} className={IMAGE_LINE.test(line) ? "materialsImageLine" : undefined}>
                                    {line}{"\n"}
                                </span>
                            ))}
                        </pre>
                    )}
                </div>

                <footer className="materialsModalFooter">
                    {file.describedImageCount > 0 && (
                        <span className="materialsLegend">
                            <span className="materialsLegendSwatch" /> read from an image
                        </span>
                    )}
                    <button type="button" className="button materialsButton" onClick={onClose}>Close</button>
                </footer>
            </div>
        </div>
    );
}
