import React, { lazy, Suspense, useEffect, useState } from "react";
import "./App.css";
import defaultData from "./components/general/default_settings.json";
import AppLoader from "./components/general/AppLoader";

const Landing = 0;
const Scene = 1;
const EndPage = 3;

const LazyLandingP = lazy(() => import("./components/scenes/LandingPage"));
const LazyGeneralS = lazy(() => import("./components/scenes/Scene"));
const LazyGeneralE = lazy(() => import("./components/scenes/EndPage"));

function App() {
  const [subtitleText, setSubtitleText] = useState("");
  const [appState, setAppState] = useState(Landing);
  const [config, setConfig] = useState(defaultData);
  const [paused, setPaused] = useState(false);
  const [judgeElapsedTime, setJudgeElapsedTime] = useState(0);

  const updateConfig = (nextConfig: any) => {
    console.log("New Configuration: ", JSON.stringify(nextConfig));
    setConfig(nextConfig);
  };

  const updateState = (nextState: number) => {
    setAppState(nextState);
    if (nextState === Scene) {
      setSubtitleText(config.judgeIntroSpeech);
    }
    console.log("current appState is:", nextState);
    console.log("current config is:", config);
  };

  const pauseHandler = () => {
    setPaused((prev) => {
      const next = !prev;
      console.log("pause toggled, App Paused?", next);
      return next;
    });
  };

  // manual minimum loading time
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const timeout = setTimeout(() => setLoading(false), 5000);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    console.log(`Loading state changed: ${loading} time${Date.now()}`);
  }, [loading]);

  if (loading) return <AppLoader />;

  return (
    <Suspense fallback={null}>
      <div style={{ height: "100vh" }}>
        {appState === Landing && (
          <LazyLandingP
            setPaused={setPaused}
            updateAppState={updateState}
            updateConfig={updateConfig}
            config={config}
          />
        )}

        {appState === EndPage && (
          <LazyGeneralE
            updateAppState={updateState}
            updateConfig={updateConfig}
            config={config}
            judgeElapsedTime={judgeElapsedTime}
          />
        )}

        {appState === Scene && (
          <LazyGeneralS
            setPaused={setPaused}
            appConfig={config}
            appPaused={paused}
            togglePause={pauseHandler}
            updateAppState={updateState}
            updateConfig={updateConfig}
            judgeElapsedTime={judgeElapsedTime}
            setJudgeElapsedTime={setJudgeElapsedTime}
          />
        )}
      </div>
    </Suspense>
  );
}

export default App;
