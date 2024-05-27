import { timeThursday } from "d3";
import { useMootCourtStore } from "../MootCourtState";

enum AudioStreamType
{
    Chunks,
    Stream
}

export class ServerUtility
{
    static Blobs: Blob[] = [];
    static isAudioPlaying = false;
    static audioPlayer: HTMLAudioElement | null = null;
    static accumulatedText = ''
    private static socket: WebSocket | null = null;

    static initializeWebSocket() : WebSocket
    {
        if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) {
            console.log('WebSocket is already open.');
            return this.socket;
        }


        this.socket = new WebSocket('ws://99.79.195.101:8889');
        this.socket.onopen = function(event)
        {
            //socket.send('authorization_request secret_password');
            console.log('WebSocket connection opened:', event);
        };

        this.socket.onclose = function(event)
        {
            if (event.wasClean)
            {
                console.log('WebSocket connection closed cleanly:', event);
            }
            else
            {
                console.error('WebSocket connection closed unexpectedly:', event);
            }

        };

        this.socket.onerror = function(error)
        {
            console.error('WebSocket error:', error);
        };

        return this.socket;
    }

    static sendMessageToServer(socket: WebSocket, message: string): void
    {
        if (message.length === 0)
        {
            console.log("Received empty user input, will not send message to server.");
            return;
        }
        if (socket.readyState === WebSocket.OPEN)
        {
            console.log("sending message: " + message);
            socket.send("[CSS]" + message);
        }else
        {
            console.error("Error sending message to web socket. Web socket state is " , socket.readyState);
        }
    }

    static playResponseAsAudio (data: string | Blob | string[], audioPlaybackType: AudioStreamType = AudioStreamType.Chunks)
    {
        console.log("PlayResponseAsAudio called");
        // console.log(data);
        let blobCounter = 0;
        if (data instanceof Blob)
        {
            ServerUtility.Blobs.push(data);
            if (audioPlaybackType === AudioStreamType.Chunks && ServerUtility.isAudioPlaying === false)
            {
                ServerUtility.playBlobsSequentially(blobCounter++);
                return;
            }
        }

        

        // if (typeof data === 'string' && data.includes("END") && audioPlaybackType === AudioStreamType.Stream)
        if (typeof data === 'string')
        
        {
           
            ServerUtility.accumulateText(data);
        }
    }

    static accumulateText(chunk: string) {
 
        if (!chunk) {
            return;
        }
        this.accumulatedText += chunk;
        const index = this.accumulatedText.indexOf("END[stop]~!~");
        const unwantedSequence = "~!~";
        if (index !== -1) {
            let textBeforeEnd = this.accumulatedText.substring(0, index);
            textBeforeEnd = textBeforeEnd.replace(unwantedSequence, "");
            textBeforeEnd = textBeforeEnd.replace("~!~", "");
            console.log(textBeforeEnd);
            useMootCourtStore.getState().setSubtitles(textBeforeEnd) ;
 
            // clear accumulated text after logging
            this.accumulatedText = this.accumulatedText.substring(index + "END[stop]~!~".length);
            
        }

        
    }

    static pauseOrResumeAudioResponse()
    {
        const audio = ServerUtility.audioPlayer;
        if (!audio) {
            return;
        }

        if (audio.paused)
        {
            audio.play();
            return;
        }

        audio.pause();
    }
// const cleanText = textBeforeEnd.replace('~!~', ' ');
            // console.log('Processed text:', cleanText);
            // // Set subtitles or further process the cleaned text
            // useMootCourtStore.getState().setSubtitles(cleanText);

    static playBlobs()
    {
        ServerUtility.playBlobsSequentially(0);
    }

    static playBlobsSequentially(index: number)
    {
        console.log("Playing Blobs Sequentially");
        const data = ServerUtility.Blobs;
        if (index >= data.length)
        {
            return;
        }

        const audioData = data[index];
        const audioUrl = URL.createObjectURL(audioData);
        ServerUtility.audioPlayer = new Audio(audioUrl);

        ServerUtility.isAudioPlaying = true;

        ServerUtility.audioPlayer.addEventListener("ended", () => {
            data.splice(index, 1);
            URL.revokeObjectURL(audioUrl);
            ServerUtility.isAudioPlaying = false;
            ServerUtility.playBlobsSequentially(index);
        });

        ServerUtility.audioPlayer.play()
            .catch((error) => {
                console.error("Error playing audio: ", error);
            });
    }
}