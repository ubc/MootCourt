import { useEffect, useState } from 'react'
import "../general/subtitles.css"
import {Html} from '@react-three/drei'
import { useMootCourtStore } from '../MootCourtState'
function Subtitles() {
    // internal check of pause state to change button setting
    // const subtitles = useMootCourtStore((state) => state.subtitles)
    
    const { subtitles, setSubtitles } = useMootCourtStore(state => ({
        subtitles: state.subtitles,
        setSubtitles: state.setSubtitles
    }));

    useEffect(() => {
        setSubtitles(' ');  // default subtitle
    }, [setSubtitles]);  // 


    return <>
    {<div className={"subtitlesContainer sceneButtonContainer"}>
        <button className="subtitles-button">
        {subtitles}
        </button>
    </div>}
    </>
}

export default Subtitles;
