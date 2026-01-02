import { Html } from "@react-three/drei";
import React, { useEffect, useRef, useState } from "react";
import Recorder from "../general/Recorder";
import { createModel, KaldiRecognizer, Model } from "vosk-browser";
import "../general/timer.css";
import { useMootCourtStore } from "../MootCourtState";
import { color } from "d3";
import { ServerUtility } from "../server/ServerUtility";
import { waitFor } from "@testing-library/react";
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

  const [userInput, setUserInput] = useState("");
  const [micIcon, setMicIcon] = useState<JSX.Element>(micReady);
  const [micColor, setMicColor] = useState("#ffffff"); // Default color
  const [showPopup, setShowPopup] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPopupAnimating, setIsPopupAnimating] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const isInputLocked = useMootCourtStore((state) => state.isInputLocked);
  const setInputLock = useMootCourtStore((state) => state.setInputLock);
  const [isReconnecting, setIsReconnecting] = useState(false);

  const conversation = useRef<Array<any>>([]);
  const runningTimestamps = useRef<Array<any>>([]);

  // track latest recording state inside event handlers
  const isRecordingRef = useRef(false);
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // prevent key-repeat from re0triggering startRecording()
  const enterHeldRef = useRef(false);

  //let socket: WebSocket;

  const [isWebSocketConnected, setIsWebSocketConnected] = useState(false);

  useEffect(() => {
    // Function to check WebSocket connection status
    const checkWebSocketStatus = () => {
      setIsWebSocketConnected(ServerUtility.isWebSocketConnected());
    };

    // Set up an interval to check every 1 second
    const interval = setInterval(checkWebSocketStatus, 2000);

    // Cleanup the interval on component unmount
    return () => clearInterval(interval);
  }, []);

  const handleNoSpeechDetected = () => {
    if (isPopupAnimating) return;

    //console.log("Clicked nospeechdetectged");
    setShowPopup(true); // Show the popup
    setIsPopupAnimating(true);

    setTimeout(() => {
      setShowPopup(false);
      setTimeout(() => {
        setIsPopupAnimating(false); // Allow re-trigger after animation ends
      }, 500); // 500ms fade-out delay
    }, 5500);
  };

  const handleRecordingStateChange = (isRecording: boolean) => {
    if (isInputLocked) {
      setMicIcon(micWaiting);
    } else if (isRecording) {
      setMicIcon(micRecording);
    } else {
      setMicIcon(micReady);
    }
  };

  const startRecording = async () => {
    if (useMootCourtStore.getState().isInputLocked) {
      console.warn("Input is locked. Cannot start recording.");
      return;
    }

    if (!ServerUtility.isWebSocketConnected()) {
      setInputLock(true);
      console.warn("Cannot start recording, websocket not connected");
      ServerUtility.initializeWebSocket();
      setIsWebSocketConnected(ServerUtility.isWebSocketConnected());
      const isConnected = await waitForWebSocketConnection(500);
      setInputLock(false);
      if (!isConnected) {
        return;
      }
    }

    setIsRecording(true);
    ServerUtility.startTalking();

    try {
      const mimeTypeSetting = ServerUtility.getMimeType(); // "audio/webm";

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      var mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeTypeSetting,
      });
      recorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: mimeTypeSetting,
        });

        audioChunksRef.current = []; // Reset for next recording
        const isValidSpeech = await analyzeAudioContent(audioBlob);
        if (isValidSpeech) sendAudioToServer(audioBlob);
        else {
          handleNoSpeechDetected();
          console.log("Recording invalid, no speech detected");
        }

        setMicIcon(micReady);
        setMicColor("#ffffff");
        ServerUtility.stopTalking(isValidSpeech);
        setIsRecording(false);
        setInputLock(isValidSpeech);
      };

      mediaRecorder.start();
      setMicIcon(micRecording);
      setMicColor("#228B22");
    } catch (error) {
      console.error("Error starting recording:", error);
    }
    //} catch (error) {
    //    console.error("Error starting recording:", error);
    //}
  };

  const analyzeAudioContent = async (audioBlob) => {
    const audioContext = new AudioContext();
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const channelData = audioBuffer.getChannelData(0); // Analyze the first channel

    // Calculate RMS
    const rms = Math.sqrt(
      channelData.reduce((sum, sample) => sum + sample ** 2, 0) /
        channelData.length
    );

    const threshold = 0.02; // Adjust based on testing and environment noise
    const hasSpeech = rms > threshold;

    console.log(`RMS: ${rms}, Speech Detected: ${hasSpeech}`);
    return hasSpeech;
  };

  const stopRecording = () => {
    if (recorderRef.current) {
      if (recorderRef.current.state === "paused") {
        recorderRef.current.resume(); // Resume before stopping
      }
      recorderRef.current.stop();
      //setMicIcon(micReady);
      //ServerUtility.stopTalking();
      //setIsRecording(false);
      //setInputLock(true);
    }
  };

  const pauseRecording = () => {
    if (recorderRef.current) {
      recorderRef.current.pause();
    }
  };
  const resumeRecording = () => {
    if (recorderRef.current) {
      recorderRef.current.resume();
    }
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !isRecording) {
      startRecording();
    } else if (event.key === "Enter" && isRecording) {
      handleStopOrReconnect();
    }
  };

  const handleStopOrReconnect = async () => {
    if (isReconnecting) {
      console.log("Already reconnecting, returning");
      return;
    }

    if (ServerUtility.isWebSocketConnected()) {
      console.log("Stopping recording");
      stopRecording();
    } else {
      setIsReconnecting(true);
      var reconnecting = true;
      pauseRecording();
      console.log(
        "Connection is closed, pausing recording while attempting to reconnect"
      );

      while (reconnecting) {
        ServerUtility.initializeWebSocket();
        setIsWebSocketConnected(ServerUtility.isWebSocketConnected());

        console.log("Attempting to reconnect...");

        const isConnected = await waitForWebSocketConnection(500);
        if (isConnected) {
          console.log("Reconnected successfully");
          setIsReconnecting(false);
          reconnecting = false;
          stopRecording();
          return;
        }
      }
    }
  };

  const sendAudioToServer = async (audioBlob: Blob) => {
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const byteArray = new Uint8Array(arrayBuffer);
      if (ServerUtility.socket) {
        ServerUtility.sendRecordingToServer(ServerUtility.socket, byteArray);
        console.log("Audio sent successfully.");

        ServerUtility.socket.onmessage = function (event) {
          console.log("Received a response");
          if (typeof event.data === "string") {
            if (event.data.substring(0, 5) == "[SUB]")
              ServerUtility.accumulateUserSpeech(event.data.substring(5));

            if (!isRecording) {
              ServerUtility.countUserSpeech();
              sendToAssessment(
                ServerUtility.accumulatedUserSpeech,
                ServerUtility.talkDuration
              );
              setUserInput(ServerUtility.accumulatedUserSpeech);
            }
          } else {
            ServerUtility.playResponseAsAudio(event.data);
          }
          //ServerUtility.playResponseAsAudio(event.data);
        };
      } else {
        console.error("Websocket not available, cannot send recording");
      }
    } catch (error) {
      console.error("Error sending audio to server:", error);
    }
  };

  const waitForWebSocketConnection = async (timeoutMs = 500) => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(ServerUtility.isWebSocketConnected());
      }, timeoutMs);
    });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;

      // ignore OS key-repeat while holding Enter
      if (event.repeat) return;

      // do nothing if already marked Enter as held
      if (enterHeldRef.current) return;

      enterHeldRef.current = true;

      // start only if it isn't already recording
      if (!isRecordingRef.current) startRecording();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;

      enterHeldRef.current = false;

      // release = stop (or reconnect + stop)
      if (isRecordingRef.current) {
        handleStopOrReconnect();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    if (userInput.length > 0) {
      onTranscriptChange(userInput);
    }
  }, [userInput]);

  useEffect(() => {
    // Ensure micIcon updates when isInputLocked changes
    if (isInputLocked) {
      setMicIcon(micWaiting);
      setMicColor("#FA5F55");
    } else {
      setMicIcon(micReady);
      setMicColor("#ffffff");
    }
  }, [isInputLocked]); // Dependency on isInputLocked

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

  return (
    <Html fullscreen>
      {!appPaused}

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

async function blobToAudioBuffer(blob) {
  console.log("BlobToAudioBuffer called");
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new window.AudioContext();
  return audioContext.decodeAudioData(arrayBuffer);
}
