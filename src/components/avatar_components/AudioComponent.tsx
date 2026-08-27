import { Html } from "@react-three/drei";
import React, { useEffect, useRef, useState } from "react";
import "../general/timer.css";
import { useMootCourtStore } from "../MootCourtState";
import { ServerUtility } from "../server/ServerUtility";
import { audioBufferToPcm16 } from "../server/audio";
declare module "react" {
  interface CSSProperties {
    "--dynamic-color"?: string; // Declare your custom property
  }
}

function AudioComponent({
  config,
  appPaused,
  onTranscriptChange,
  elapsedTime,
}) {
  //----------------------------------------------------------------------------------------------------------------------
  // TODO: Move these into one big asset file, consolidate the other assets in the project
  //----------------------------------------------------------------------------------------------------------------------
  const micReady = (
    <svg
      width="24px"
      height="24px"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      color="#ffffff"
    >
      <rect
        x="9"
        y="2"
        width="6"
        height="12"
        rx="3"
        stroke="#ffffff"
        strokeWidth="2"
      />
      <path
        d="M5 10v1a7 7 0 007 7v0a7 7 0 007-7v-1M12 18v4m0 0H9m3 0h3"
        stroke="#ffffff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  const micRecording = (
    <svg
      width="24px"
      height="24px"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      color="#228B22"
    >
      <rect
        x="9"
        y="2"
        width="6"
        height="12"
        rx="3"
        stroke="#228B22"
        strokeWidth="2"
      />
      <path
        d="M5 10v1a7 7 0 007 7v0a7 7 0 007-7v-1M12 18v4m0 0H9m3 0h3"
        stroke="#228B22"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  const micWaiting = (
    <svg
      width="24px"
      height="24px"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      color="#FA5F55"
    >
      <rect
        x="9"
        y="2"
        width="6"
        height="12"
        rx="3"
        stroke="#FA5F55"
        strokeWidth="2"
      />
      <path
        d="M5 10v1a7 7 0 007 7v0a7 7 0 007-7v-1M12 18v4m0 0H9m3 0h3"
        stroke="#FA5F55"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  //const micMute = <svg
  //    width="24px"
  //    height="24px"
  //    strokeWidth="1.5"
  //    viewBox="0 0 24 24"
  //    fill="none"
  //    xmlns="http://www.w3.org/2000/svg"
  //    color="#000000">
  //    <path d="M3 3l18 18M9 9v0a5 5 0 005 5v0m1-3.5V5a3 3 0 00-3-3v0a3 3 0 00-3 3v.5"
  //        stroke="#000000"
  //        strokeWidth="1.5"
  //        strokeLinecap="round"
  //        strokeLinejoin="round" />
  //    <path d="M5 10v1a7 7 0 007 7v0a7 7 0 007-7v-1M12 18v4m0 0H9m3 0h3"
  //        stroke="#000000"
  //        strokeWidth="1.5"
  //        strokeLinecap="round"
  //        strokeLinejoin="round" />
  //</svg>

  //----------------------------------------------------------------------------------------------------------------------
  //
  //----------------------------------------------------------------------------------------------------------------------

  const [showPopup, setShowPopup] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(ServerUtility.getStatus());
  const isWebSocketConnected = connectionStatus.connected;
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const isInputLocked = useMootCourtStore((state) => state.isInputLocked);
  const setInputLock = useMootCourtStore((state) => state.setInputLock);
  const micIcon = isInputLocked ? micWaiting : isRecording ? micRecording : micReady;
  const micColor = isInputLocked ? "#FA5F55" : isRecording ? "#228B22" : "#ffffff";
  const conversation = useRef<Array<any>>([]);
  const runningTimestamps = useRef<Array<any>>([]);
  const enterHeldRef = useRef(false);
  const startingRef = useRef(false);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);
  const popupTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Keep the assessment inputs and calculations exactly as before the migration.
  const sendToAssessment = (transcript, startTime) => {
    runningTimestamps.current.push([transcript, startTime]);
    config.runningTimestamps = runningTimestamps.current;
    conversation.current = createConversation(
      conversation.current,
      "user",
      transcript
    );
    config.conversation = conversation.current;
  };
  const transcriptHandlerRef = useRef((text: string, duration: number | null) => {});
  transcriptHandlerRef.current = (text, duration) => {
    sendToAssessment(text, duration);
    onTranscriptChange(text);
  };

  useEffect(() => ServerUtility.subscribeStatus(setConnectionStatus), []);
  useEffect(() => ServerUtility.subscribeTranscript((text, duration) => {
    transcriptHandlerRef.current(text, duration);
  }), []);

  const handleNoSpeechDetected = () => {
    setShowPopup(true);
    clearTimeout(popupTimerRef.current);
    popupTimerRef.current = setTimeout(() => setShowPopup(false), 5500);
  };

  const analyzeAudioContent = async (audioBlob: Blob) => {
    const audioContext = new AudioContext();
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const channelData = audioBuffer.getChannelData(0);
      const rms = Math.sqrt(channelData.reduce((sum, sample) => sum + sample ** 2, 0) / channelData.length);
      return { audioBuffer, isValidSpeech: rms > 0.02 };
    } finally {
      await audioContext.close();
    }
  };

  const startRecording = async () => {
    if (appPaused || startingRef.current || processingRef.current ||
        recorderRef.current?.state === "recording" || useMootCourtStore.getState().isInputLocked) return;
    startingRef.current = true;
    try {
      if (!await ServerUtility.waitForConnection()) return;
      if (!mountedRef.current || !enterHeldRef.current) return;
      ServerUtility.startTalking();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Permission can resolve after Enter was released or the scene was closed.
      if (!mountedRef.current || !enterHeldRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const mimeType = ServerUtility.getMimeType();
      let mediaRecorder: MediaRecorder;
      try { mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined); }
      catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
      recorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = event => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        if (!mountedRef.current) return;
        processingRef.current = true;
        setIsRecording(false);
        setInputLock(true);
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
        audioChunksRef.current = [];
        let submitted = false;
        try {
          const { audioBuffer, isValidSpeech } = await analyzeAudioContent(audioBlob);
          if (!mountedRef.current) return;
          ServerUtility.stopTalking(isValidSpeech);
          if (!isValidSpeech) {
            handleNoSpeechDetected();
          } else {
            const pcm = await audioBufferToPcm16(audioBuffer);
            if (!mountedRef.current) return;
            ServerUtility.sendRecordingToServer(pcm, ServerUtility.talkDuration);
            submitted = true;
          }
        } catch (error) {
          if (mountedRef.current) ServerUtility.reportError(error instanceof Error ? error.message : "Could not send the recording.");
        } finally {
          processingRef.current = false;
          if (mountedRef.current && !submitted) setInputLock(false);
        }
      };
      mediaRecorder.onerror = () => {
        stream.getTracks().forEach(track => track.stop());
        mediaRecorder.onstop = null;
        if (mountedRef.current) {
          setIsRecording(false);
          setInputLock(false);
          ServerUtility.reportError("Microphone recording failed. Check your microphone permissions.");
        }
      };
      try { mediaRecorder.start(); }
      catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
      setIsRecording(true);
    } catch (error) {
      if (mountedRef.current) {
        setIsRecording(false);
        ServerUtility.reportError(error instanceof Error ? error.message : "Could not start the microphone.");
      }
    } finally {
      startingRef.current = false;
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      recorder.stream.getTracks().forEach(track => track.stop());
    }
  };
  const recordingActionsRef = useRef({ startRecording, stopRecording });
  recordingActionsRef.current = { startRecording, stopRecording };

  useEffect(() => {
    mountedRef.current = true;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.repeat || enterHeldRef.current) return;
      enterHeldRef.current = true;
      recordingActionsRef.current.startRecording();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      enterHeldRef.current = false;
      recordingActionsRef.current.stopRecording();
    };
    const onBlur = () => {
      enterHeldRef.current = false;
      recordingActionsRef.current.stopRecording();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      mountedRef.current = false;
      enterHeldRef.current = false;
      clearTimeout(popupTimerRef.current);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.onstop = null;
        recorder.ondataavailable = null;
        if (recorder.state !== "inactive") recorder.stop();
        recorder.stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return (
    <Html fullscreen style={{ pointerEvents: "none" }}>
      {connectionStatus.error && (
        <div role="alert" style={{ position: "absolute", top: 45, right: 10, maxWidth: 420, padding: 12, background: "#251b1b", color: "white", borderRadius: 6 }}>
          {connectionStatus.error}
        </div>
      )}

      <div
        className="micIndicatorContainer"
        style={{
          backgroundColor: "#171717",
          width: "min-content",
          height: "min-content",
          border: `1px solid ${micColor}`, // Use dynamic color
          borderRadius: "20px",
          position: "absolute",
          marginLeft: "40px",
          marginRight: "40px",
          right: 0, // Position it on the right side
          bottom: 0, // Position it at the bottom
          marginBottom: "35px",
          transform: "scale(2.25)",
          animation:
            micColor !== "#ffffff" // Assuming default is non-recording/idle
              ? "pulsate 1s infinite ease-in-out" // Apply pulsating effect for active states
              : "none",
          boxShadow:
            micColor !== "#ffffff"
              ? `0 0 15px 5px ${micColor}` // Dynamic shadow color
              : "none", // No shadow for idle state
          "--dynamic-color": micColor,
        }}
      >
        <div
          style={{
            width: "min-content",
            height: "min-content",
            transform: "translateY(2px)",
            position: "relative",
            margin: "auto",
          }}
        >
          {micIcon}
        </div>

        <div style={{ position: "relative" }}>
          {/* Popup Text */}
          {showPopup && (
            <div
              style={{
                position: "absolute",
                bottom: 40, // Position it above the mic container
                right: 0,
                padding: "10px 15px",
                backgroundColor: "rgba(0, 0, 0, 0.8)",
                color: "white",
                borderRadius: "8px",
                fontSize: "14px",
                textAlign: "center",
                boxShadow: "0px 4px 6px rgba(0, 0, 0, 0.1)",
                whiteSpace: "nowrap",
                zIndex: 1000,
                animation: "fadeInStayOut 6s ease-in-out",
              }}
            >
              No speech detected
              <br />
              Check microphone settings
            </div>
          )}
        </div>

        {/* Status Text (Listening, Thinking, or Ready) */}
        <div
          style={{
            position: "absolute",
            bottom: 26, // Adjust position above mic container
            left: "50%",
            transform: "translateX(-50%)", // Center align
            backgroundColor: "rgba(0, 0, 0, 0)",
            color: "white",
            padding: "6px 12px",
            borderRadius: "8px",
            fontSize: "8px",
            fontWeight: "bold",
            whiteSpace: "nowrap",
            opacity: 1,
            transition: "opacity 0.3s ease-in-out",
          }}
        >
          {micColor === "#228B22"
            ? "Listening.."
            : micColor === "#FA5F55"
            ? "Replying.."
            : "Ready"}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: "10px",
          right: "10px",
          display: "flex",
          alignItems: "center",
        }}
      >
        {/* Status Text */}
        <span
          style={{
            color: "white",
            fontWeight: "bold",
            marginBottom: "2px",
            marginRight: "10px", // Add space between text and the circle
            textShadow:
              "1px 1px 0 black, -1px 1px 0 black, 1px -1px 0 black, -1px -1px 0 black",
          }}
        >
          {isWebSocketConnected ? "Connected!" : "Not Connected!"}
        </span>

        {/* Status Circle */}
        <div
          style={{
            width: "15px",
            height: "15px",
            borderRadius: "50%",
            backgroundColor: isWebSocketConnected ? "green" : "red",
            border: "2px solid black",
          }}
        ></div>
      </div>
    </Html>
  );
}
export default AudioComponent;

/**
 * Creates a new message and appends it to the conversation
 * @param conversation List of OpenAI conversation messages
 * @param role One of 'user', 'assistant', 'system'
 * @param content The message to be appended
 * @returns List of OpenAI conversation messages
 */
function createConversation(
  conversation: Array<object>,
  role: string,
  content: string
): Array<any> {
  let message = { role: role, content: content };
  let messages = [...conversation];
  messages.push(message);
  return messages;
}
