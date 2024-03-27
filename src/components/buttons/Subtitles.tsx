import { useEffect, useState } from 'react'
import "../general/timer.css"
import {Html} from '@react-three/drei'
import PropTypes from 'prop-types'
// import { message } from '../server/ServerUtility'

function Subtitles({  serverMessage }) {
    // internal check of pause state to change button setting
    const [isPaused, setIsPaused] = useState(false)

    return <>
    {<div className={"subtitlesContainer sceneButtonContainer"}>
        <button className="subtitles-button">
        {serverMessage}
        </button>
    </div>}
    </>
}

export default Subtitles;
