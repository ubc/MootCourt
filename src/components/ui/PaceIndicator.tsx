import React from "react";
import { averageWpm, paceBand, PACE_COLORS, PACE_LABELS, PaceTurn } from "../../pace/pace";
import { DEFAULT_SITE_SETTINGS, WpmThresholds } from "../../settings/siteSettings";

/**
 * The speaking-pace badge shown in the courtroom's top-right corner.
 *
 * Updates once per turn, after the transcript comes back — the transcription
 * model only returns text once the recording is committed, so there is no
 * live figure while the student is still talking. The colour reflects the
 * most recent turn; the session average sits underneath for context.
 */
export default function PaceIndicator({ turns, thresholds }: { turns: PaceTurn[]; thresholds?: WpmThresholds }) {
    const bands = thresholds || DEFAULT_SITE_SETTINGS.wpm;
    const last = turns.length ? turns[turns.length - 1] : null;
    const average = averageWpm(turns);
    const band = last ? paceBand(last.wpm, bands) : null;
    const color = band ? PACE_COLORS[band] : "#9a9a9a";
    const outline = "1px 1px 0 black, -1px 1px 0 black, 1px -1px 0 black, -1px -1px 0 black";

    return (
        <div
            role="status"
            aria-label={last ? `Speaking pace ${last.wpm} words per minute, ${PACE_LABELS[band!]}` : "Speaking pace not measured yet"}
            title={`Green ${bands.slowBelow}–${bands.fastAbove} wpm. Yellow below ${bands.slowBelow} or ${bands.fastAbove}–${bands.tooFastAbove}. Red ${bands.tooFastAbove}+.`}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 12px",
                borderRadius: 20,
                background: "rgba(23, 23, 23, 0.85)",
                border: `2px solid ${color}`,
                color: "white",
                fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                minWidth: 190,
            }}
        >
            <div style={{ width: 15, height: 15, borderRadius: "50%", backgroundColor: color, border: "2px solid black", flexShrink: 0 }} />
            <div style={{ lineHeight: 1.15 }}>
                <div style={{ fontWeight: "bold", textShadow: outline }}>
                    {last ? `${last.wpm} wpm · ${PACE_LABELS[band!]}` : "Pace: speak to measure"}
                </div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>
                    {average !== null ? `Session average ${average} wpm over ${turns.length} turn${turns.length === 1 ? "" : "s"}` : "Updates after each turn"}
                </div>
            </div>
        </div>
    );
}
