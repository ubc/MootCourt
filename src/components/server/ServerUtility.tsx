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
    private static socket: WebSocket | null = null;

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
        };

        this.socket.onclose = function (event) {
            if (event.wasClean) {
                console.log('WebSocket connection closed cleanly:', event);
            }
            else {
                console.error('WebSocket connection closed unexpectedly:', event);
            }

        };

        this.socket.onerror = function (error) {
            console.error('WebSocket error:', error);
        };
        useMootCourtStore.getState().setInputLock(false);
        return this.socket;
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
                setInputLock(false);
            } else {
                // Play the next blob
                ServerUtility.playBlobsSequentially(0); // Always start from the first index after splicing
            }
        });

        ServerUtility.audioPlayer.play().catch((error) => {
            console.error("Error playing audio: ", error);
            setInputLock(false); // Ensure input is unlocked in case of an error
        });
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