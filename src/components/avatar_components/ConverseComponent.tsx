import React, { useEffect, useState } from 'react';
import { Html } from "@react-three/drei";
import { ServerUtility } from '../server/ServerUtility';

let socket: WebSocket;

export default function ConverseComponent({ setIsSpeaking, appPaused, config, updateConfig, userSpeechToTextInput }) {
    const [socketReady, setSocketReady] = useState(false);
    const isAISpeaking = ServerUtility.isAudioPlaying;

    // TODO: Move Websocket initialization to before User clicks "Start"
    // Initialize WebSocket
    useEffect(() => {
        console.warn("ConverseWebsocket Initialized");
        socket = ServerUtility.initializeWebSocket();
        setSocketReady(true);

    }, []);

    useEffect(() => {
        if (socketReady && userSpeechToTextInput.length !== 0) {
            if (socket.readyState !== WebSocket.OPEN)
            {
                if (ServerUtility.socket)
                    socket = ServerUtility.socket;
            }

            ServerUtility.sendMessageToServer(socket, userSpeechToTextInput);
            getServerResponse(socket);
        }
    }, [userSpeechToTextInput]);

    useEffect(() => {
        setIsSpeaking(isAISpeaking);
    }, [isAISpeaking]);

    useEffect(() => {
        if (isAISpeaking) {
            ServerUtility.pauseOrResumeAudioResponse();
        }
    }, [appPaused]);

    return (
        <Html fullscreen>
        </Html>
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Helper Functions
//---------------------------------------------------------------------------------------------------------------------

function getServerResponse(socket: WebSocket) {
    if (!socket) {
        console.log('Invalid WebSocket - Did you check if the websocket is initialized?');
        return;
    }
    socket.onmessage = function (event) {
        //console.log("Received a message"); 

        ServerUtility.playResponseAsAudio(event.data);
    };
}
