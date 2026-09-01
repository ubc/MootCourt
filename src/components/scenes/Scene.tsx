import { useState, useEffect } from "react";
import { Canvas, useFrame, useThree, ThreeElements } from "@react-three/fiber";
import Model from "../general/Model.js";
import GlobalTimer from "../general/GlobalTimer";
import PauseButton from "../buttons/PauseButton";
import Subtitles from "../buttons/Subtitles";
import { ServerUtility } from "../server/ServerUtility";
import SceneJudgeAvatar from "../avatars/SceneJudgeAvatar";
import BackToLandingButton from "../buttons/BackToLandingButton";
import JudgeTimedSpeech from "../general/JudgeTimedSpeech";
import "../ui/Captions.css";
import Captions from "../ui/Captions";
import PausedMenu from "../ui/PausedMenu";
import AssessmentPage from "../ui/AssessmentPage";
import React, { useRef } from "react";
import { Profiler } from "react";

import "../ui/Captions.css";
import "./GeneralScene.css"; // Import your custom CSS file

import { Html, PerspectiveCamera, useTexture } from "@react-three/drei";
import { Vector3 } from "three"; // Import Vector3 from three.js
import * as THREE from "three";
import AudioComponent from "../avatar_components/AudioComponent";
import { useMootCourtStore } from "../MootCourtState";
import CourtroomNight from "./CourtroomNight";

const cameraPosition = new Vector3(0, 0, 2.2);
const cameraFov = 42;

const onRenderCallback = (
  id, // ID of the component being rendered
  phase, // "mount" or "update"
  actualDuration, // Time spent rendering the component
  baseDuration, // Time spent rendering when nothing is memoized
  startTime, // When React started rendering
  commitTime, // When React committed the render
  interactions // The interactions belonging to this update
) => {
  //console.log(`[${id}] ${phase} took ${actualDuration}ms`);
};


// TEMP DEV HELPER — removed before the change lands.
function __SceneDebug() {
  const { scene, camera, gl } = useThree();
  (window as any).__scene = scene;
  (window as any).__camera = camera;
  (window as any).__gl = gl;
  (window as any).__THREE = THREE;
  return null;
}

export default function GeneralScene({
  setPaused,
  appConfig,
  appPaused,
  togglePause,
  updateAppState,
  updateConfig,
  judgeElapsedTime,
  setJudgeElapsedTime,
}) {
  // Scene Specific Elements are stored here
  // Text that judge is supposed to say at given interval
  const [judgeSpeechText, setJudgeSpeechText] = useState(
    "Default speech text for judge."
  );

  // Stores the current global time of the scene since the beginning.
  // Starting value: config's total time (in seconds) converted to ms
  // add 5 second delay
  const [currentTime, setCurrentTime] = useState(
    appConfig.totalTime * 1000 + appConfig.introductionTime * 1000 + 5000
  );
  // Track whether the judge interval should be updated or not.
  const [shouldUpdateJudgeElapsedTime, setShouldUpdateJudgeElapsedTime] =
    useState(false);
  // Is the speech in intro mode?
  const [isAppInIntro, setIsAppInIntro] = useState(false);
  // Has intro speech been started?
  const [hasAppIntroStarted, setHasAppIntroStarted] = useState(false);

  const displayConversation = useRef<React.ReactElement[]>([]);

  const [conversationElements, setConversationElements] = useState<
    React.ReactElement[]
  >([]);

  // const [transcript, setTranscript] = useState('');
  // const setSubtitles = useMootCourtStore((state) => state.setSubtitles)
  // const handleTranscriptChange = (newTranscript) => {
  //     setTranscript(newTranscript);
  //     setSubtitles(newTranscript);
  // };

  useEffect(() => {
    if (appConfig.isInteliJudge) {
      console.log("Intellijudge confirmed");
      ServerUtility.initializeWebSocket();

      useMootCourtStore.getState()
        .setSubtitles(`Counsel, you may begin your presentation.
            HOLD ENTER and begin presenting your case.
            RELEASE ENTER when you are done speaking.`);
      return () => ServerUtility.disconnect();
    } else {
      useMootCourtStore.getState().setSubtitles(" ");
    }
  }, []);

  // Extract the conversation elements from displayConversation useRef and update the state
  useEffect(() => {
    setConversationElements(displayConversation.current);
  }, [displayConversation.current]);


  return (
    <Profiler id="GeneralScene" onRender={onRenderCallback}>
      
      <Canvas
        camera={{
          position: cameraPosition,
          fov: cameraFov,
        }}
        shadows
        onCreated={({ gl }) => {
          const glAny = gl as any;
          const THREEAny = THREE as any;

          // color space compatibility check
          if (
            glAny.outputColorSpace !== undefined &&
            THREEAny.SRGBColorSpace !== undefined
          ) {
            glAny.outputColorSpace = THREEAny.SRGBColorSpace;
          } else if (
            glAny.outputEncoding !== undefined &&
            THREEAny.sRGBEncoding !== undefined
          ) {
            glAny.outputEncoding = THREEAny.sRGBEncoding;
          }

          // ACES keeps the warm bench lamps from clipping the way Reinhard did.
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.15;
          gl.shadowMap.type = THREE.PCFSoftShadowMap;
        }}

        // style={{
        //   backgroundImage: 'url("textures/judge_courtroom.png")', // Replace with your background image path
        //   backgroundSize: 'cover',
        //   backgroundPosition: 'center',
        //   width: '100%', // Make sure the canvas takes the full width of its container
        //   height: '100%', // Make sure the canvas takes the full height of its container
        // }}
      >
        <__SceneDebug />

        {/* Dark ground and depth haze so the gallery falls away behind the bench. */}
        <color attach="background" args={["#080e19"]} />
        <fog attach="fog" args={["#0b1220", 4.5, 19]} />

        <CourtroomNight />

        {/* <JudgeTimedSpeech
                config={appConfig}
                judgeElapsedTime={judgeElapsedTime}
                setShouldUpdateJudgeElapsedTime={setShouldUpdateJudgeElapsedTime}
                setJudgeSpeechText={setJudgeSpeechText}></JudgeTimedSpeech> */}
        <Model
          modelUrl="./models/courtroom_walls.glb"
          pos={[0, -3, 3.5]}
          rot={[0, 0, 0]}
          sca={[0.06, 0.06, 0.06]}
        />
        <Model
          modelUrl="./models/courtroom_tables_updated_03.glb"
          pos={[0, -3.25, 4.5]}
          rot={[0, 0, 0]}
          sca={[0.055, 0.055, 0.055]}
        />
        <Model
          modelUrl="./models/courtroom_props_updated.glb"
          pos={[0, -3, 3]}
          rot={[0, 0, 0]}
          sca={[0.06, 0.06, 0.06]}
        />
        <SceneJudgeAvatar
          appPaused={appPaused}
          judgeSpeechText={judgeSpeechText}
          judgeElapsedTime={judgeElapsedTime}
          config={appConfig}
          updateConfig={updateConfig}
        />

        {/* Wrap all the HTML components here */}

        <Html fullscreen>
          <div className="scene-controls">
            <div className="scene-controls-inner">
              <BackToLandingButton
                updateAppState={updateAppState}
                setPaused={setPaused}
                updateConfig={updateConfig}
              ></BackToLandingButton>
              <Subtitles></Subtitles>
              {/* <AudioComponent config={config} appPaused={appPaused} onTranscriptChange={handleTranscriptChange} elapsedTime={undefined}></AudioComponent> */}
              <PauseButton togglePause={togglePause}></PauseButton>
              {/* <Captions config={undefined}></Captions> */}
              <GlobalTimer
                hasAppIntroStarted={hasAppIntroStarted}
                setHasAppIntroStarted={setHasAppIntroStarted}
                isAppInIntro={isAppInIntro}
                setIsAppInIntro={setIsAppInIntro}
                setJudgeSpeechText={setJudgeSpeechText}
                config={appConfig}
                appPaused={appPaused}
                updateAppState={updateAppState}
                currentTime={currentTime}
                setCurrentTime={setCurrentTime}
                noNegativeTime={appConfig.stopPresentation}
                judgeElapsedTime={judgeElapsedTime}
                setJudgeElapsedTime={setJudgeElapsedTime}
                setShouldUpdateJudgeElapsedTime={
                  setShouldUpdateJudgeElapsedTime
                }
                shouldUpdateJudgeElapsedTime={shouldUpdateJudgeElapsedTime}
              ></GlobalTimer>
            </div>

            <PausedMenu
              updateAppState={updateAppState}
              appPaused={appPaused}
              togglePause={togglePause}
              config={appConfig}
              children={undefined}
            ></PausedMenu>
          </div>
        </Html>
      </Canvas>
    </Profiler>
  );
}
