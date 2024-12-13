import { timeThursday } from "d3";
import { useMootCourtStore } from "../MootCourtState";

enum AudioStreamType {
    Chunks,
    Stream
}

export class ServerUtility {
    static Blobs: Blob[] = [];
    static isAudioPlaying = false;
    static audioPlayer: HTMLAudioElement | null = null;
    static accumulatedText = ''
    static accumulatedUserSpeech = ''

    // Variables for tracking talking state
    private static isUserTalking = false;
    static talkStartTime: number | null = null;
    static talkEndTime: number | null = null;
    static talkDuration: number | null = null;
    static wordCount: 0;

    static socket: WebSocket | null = null;

    static getMimeType() {
        var mimeTypeSetting = "audio/webm";

        if (ServerUtility.isSafari()) {
            mimeTypeSetting = ""; // Default //"audio/mp4; codecs=\"mp4a.40.2\"";
        }

        return mimeTypeSetting;
    }    

    static isSafari() {
        return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    }

    static initializeWebSocket(): WebSocket {
        if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) {
            console.log('WebSocket is already open.');
            return this.socket;
        }


        //this.socket = new WebSocket('wss://moot-api.ubc-dxl.ca:8899');
        this.socket = new WebSocket('ws://127.0.0.1:8889');
        this.socket.onopen = function (event) {
            //socket.send('authorization_request secret_password');

            console.log('WebSocket connection opened:', event);

            // Setup heartbeat
            const heartbeatInterval = setInterval(() => {
                if (this.readyState === WebSocket.OPEN) {
                    this.send("[HCK]");
                }
            }, 50000); // 50 seconds

            // Cleanup on unmount
            return () => clearInterval(heartbeatInterval);

        };

        // Setup heartbeat
        const heartbeatInterval = "heartbeat";  // 50 seconds

        this.socket.onclose = function (event) {
            if (event.wasClean) {
                console.log('WebSocket connection closed cleanly:', event);
            }
            else {
                console.error('WebSocket connection closed unexpectedly:', event);
            }


        };

        //this.socket.onmessage = function (event) {
        //    console.log('Received message:', event.data); // Log the raw message for debugging
        //}

        this.socket.onerror = function (error) {
            console.error('WebSocket error:', error);
            clearInterval(heartbeatInterval);
        };
        useMootCourtStore.getState().setInputLock(false);
        return this.socket;
    }

    static isWebSocketInitialized(): boolean {
        return !!this.socket;
    }

    static isWebSocketConnected(): boolean {
        //console.log("WebsocketReadyState", socket?.readyState);
        return this.socket?.readyState === WebSocket.OPEN || false;
    }

    static getWebSocketState(): string {
        if (!this.socket) return "Not Initialized";
        switch (this.socket.readyState) {
            case WebSocket.CONNECTING:
                return "Connecting";
            case WebSocket.OPEN:
                return "Open";
            case WebSocket.CLOSING:
                return "Closing";
            case WebSocket.CLOSED:
                return "Closed";
            default:
                return "Unknown";
        }
    }

    static sendMessageToServer(socket: WebSocket, message: string): void {
        if (message.length === 0) {
            console.log("Received empty user input, will not send message to server.");
            return;
        }
        if (socket.readyState === WebSocket.OPEN) {
            console.log("sending message: " + message);
            socket.send("[CSS]" + message);
        } else {
            console.error("Error sending message to web socket. Web socket state is ", socket.readyState);
            console.log("Attempting to send to default web socket...");
            if (this.socket) {
                if (this.socket.readyState === WebSocket.OPEN) {
                    this.socket.send("[CSS]" + message);
                }
                else {
                    console.log("Default socket not connected");
                }
            }
            else {
                console.log("Default web socket unavailable as well :(");
            }
        }
    }

    // Track when user starts talking
    static startTalking(): void {
        if (!this.isUserTalking) {
            this.isUserTalking = true;
            this.talkStartTime = Date.now();
            console.log('User started talking at:', new Date(this.talkStartTime).toISOString());
        }
    }

    // Track when user stops talking
    static stopTalking(valid: boolean): void {
        if (!valid) {
            this.isUserTalking = false;
            console.log("invalid talk, skipping");
            return;
        }
        if (this.isUserTalking) {
            this.isUserTalking = false;
            this.talkEndTime = Date.now();
            console.log('User stopped talking at:', new Date(this.talkEndTime).toISOString());

            this.talkDuration = (this.talkEndTime - (this.talkStartTime || this.talkEndTime));
            console.log('User talked for', this.talkDuration, 'milliseconds');
        }
    }

    // Reset talking state
    static resetTalkingState(): void {
        this.isUserTalking = false;
        this.talkStartTime = null;
        this.talkEndTime = null;
        this.wordCount = 0;
        console.log('Talking state reset.');
    }

    static sendRecordingToServer(socket: WebSocket, message: Uint8Array) {
        if (message.length === 0) {
            console.log("Received empty user input, will not send message to server.");
            return;
        }

        if (socket.readyState === WebSocket.OPEN) {

            // Add "[STT]" prefix
            const prefix = new TextEncoder().encode("[STT]");
            
            const prefixedByteArray = new Uint8Array(prefix.length + message.length);
            prefixedByteArray.set(prefix);
            prefixedByteArray.set(message, prefix.length);

            console.log("sending message: " + message);
            socket.send(prefixedByteArray);
        } else {
            console.error("Error sending message to web socket. Web socket state is ", socket.readyState);
        }
    }


    static playResponseAsAudio(data: string | Blob | string[], audioPlaybackType: AudioStreamType = AudioStreamType.Chunks) {
        console.log("PlayResponseAsAudio called");
        // console.log(data);
        let blobCounter = 0;
        if (data instanceof Blob) {
            ServerUtility.Blobs.push(data);
            if (audioPlaybackType === AudioStreamType.Chunks && ServerUtility.isAudioPlaying === false) {
                ServerUtility.playBlobsSequentially(blobCounter++);
                return;
            }
        }



        // if (typeof data === 'string' && data.includes("END") && audioPlaybackType === AudioStreamType.Stream)
        if (typeof data === 'string') {

            ServerUtility.accumulateText(data);
        }
    }

    static accumulateText(chunk: string) {

        if (!chunk) {
            return;
        }
        this.accumulatedUserSpeech = "";
        this.accumulatedText += chunk;
        const index = this.accumulatedText.indexOf("END[stop]~!~");
        //const unwantedSequence = "~!~";
        const unwantedSequenceB = /~!~/g;
        if (index !== -1) {
            let textBeforeEnd = this.accumulatedText.substring(0, index);
            textBeforeEnd = textBeforeEnd.replace(unwantedSequenceB, "");
            console.log(textBeforeEnd);
            useMootCourtStore.getState().setSubtitles(textBeforeEnd);

            // clear accumulated text after logging
            this.accumulatedText = this.accumulatedText.substring(index + "END[stop]~!~".length);

            this.accumulatedText.replace(unwantedSequenceB, "");

        }


    }

    static accumulateUserSpeech(chunk: string) {

        if (!chunk) {
            return;
        }
        if (this.accumulatedUserSpeech.length > 0)
            this.accumulatedUserSpeech += " ";
        this.accumulatedUserSpeech += chunk;

        //const index = this.accumulatedUserSpeech.indexOf("END[stop]~!~");
        //const unwantedSequence = "~!~";
        const unwantedSequenceB = /~!~/g;
        //if (index !== -1) {
        let textBeforeEnd = this.accumulatedUserSpeech;
        textBeforeEnd = textBeforeEnd.replace(unwantedSequenceB, "");
        console.log(textBeforeEnd);
        useMootCourtStore.getState().setSubtitles(textBeforeEnd);

        // clear accumulated text after logging
        //this.accumulatedUserSpeech = this.accumulatedUserSpeech;

        this.accumulatedUserSpeech = textBeforeEnd;

        //}


    }

    static countUserSpeech() {
        this.wordCount += this.countWords(this.accumulatedUserSpeech);
    }

    static pauseOrResumeAudioResponse() {
        const audio = ServerUtility.audioPlayer;
        if (!audio) {
            return;
        }

        if (audio.paused) {
            audio.play();
            return;
        }

        audio.pause();
    }
    // const cleanText = textBeforeEnd.replace('~!~', ' ');
    // console.log('Processed text:', cleanText);
    // // Set subtitles or further process the cleaned text
    // useMootCourtStore.getState().setSubtitles(cleanText);

    static playBlobs() {
        ServerUtility.playBlobsSequentially(0);
    }

    static playBlobsSequentially(index: number) {
        console.log("Playing Blobs Sequentially");
        const data = ServerUtility.Blobs;
        console.log("Locking input from playblobs: ", useMootCourtStore.getState().isInputLocked);
        const setInputLock = useMootCourtStore.getState().setInputLock;

        if (data.length === 0) {
            // No more blobs to play, unlock the input
            setInputLock(false);
            return;
        }

        const audioData = data[index];
        const audioUrl = URL.createObjectURL(audioData);
        ServerUtility.audioPlayer = new Audio(audioUrl);

        ServerUtility.isAudioPlaying = true;

        ServerUtility.audioPlayer.addEventListener("ended", () => {
            URL.revokeObjectURL(audioUrl);
            data.splice(index, 1); // Remove the played blob

            ServerUtility.isAudioPlaying = false;

            if (data.length === 0) {
                // Unlock input after the last blob has been played
                console.log("All audio blobs have been played. Unlocking input.");
                useMootCourtStore.getState().setInputLock(false);
            } else {
                // Play the next blob
                ServerUtility.playBlobsSequentially(0); // Always start from the first index after splicing
            }
        });

        ServerUtility.audioPlayer.play().catch((error) => {
            console.error("Error playing audio: ", error);
            useMootCourtStore.getState().setInputLock(false); // Ensure input is unlocked in case of an error
        });
    }

    // Helper method to count words in a string
    static countWords(text: string): number {
        if (!text) return 0;

        // Split the text by spaces and filter out empty elements
        return text.split(/\s+/).filter(word => word.length > 0).length;
    }
    
    //static playBlobsSequentially(index: number) {
    //    console.log("Playing Blobs Sequentially");
    //    const data = ServerUtility.Blobs;

    //    const setInputLock = useMootCourtStore.getState().setInputLock;

    //    if (index >= data.length) {
    //        setInputLock(false);
    //        return;
    //    }

    //    const audioData = data[index];
    //    const audioUrl = URL.createObjectURL(audioData);
    //    ServerUtility.audioPlayer = new Audio(audioUrl);

    //    ServerUtility.isAudioPlaying = true;

    //    ServerUtility.audioPlayer.addEventListener("ended", () => {
    //        data.splice(index, 1);
    //        URL.revokeObjectURL(audioUrl);
    //        ServerUtility.isAudioPlaying = false;

    //        if (index + 1 >= data.length) {
    //            setInputLock(false); // Unlock input after the last blob
    //        }

    //        ServerUtility.playBlobsSequentially(index);
    //    });

    //    ServerUtility.audioPlayer.play()
    //        .catch((error) => {
    //            console.error("Error playing audio: ", error);
    //            setInputLock(false);
    //        });
    //}
}