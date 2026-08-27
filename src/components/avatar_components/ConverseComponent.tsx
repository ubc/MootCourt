import { useEffect } from 'react';
import { ServerUtility } from '../server/ServerUtility';

type Props = {
    setIsSpeaking: (speaking: boolean) => void;
    appPaused: boolean;
    config?: unknown;
    updateConfig?: unknown;
    userSpeechToTextInput?: string;
};

export default function ConverseComponent({ setIsSpeaking, appPaused }: Props) {
    useEffect(() => ServerUtility.subscribeStatus(status => setIsSpeaking(status.speaking)), [setIsSpeaking]);
    useEffect(() => { ServerUtility.setAudioPaused(appPaused); }, [appPaused]);
    // Audio is submitted once. Its transcript is for captions/assessment, not a
    // second request for another judge response.
    return null;
}
