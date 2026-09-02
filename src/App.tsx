import React, { lazy, Suspense, useEffect, useState } from "react";
import "./App.css";
import defaultData from "./components/general/default_settings.json";
import AppLoader from "./components/general/AppLoader";
import { useAuth } from "./auth/useAuth";
import { startPracticeSession, savePracticeSession } from "./session/practiceSession";
import { loadMaterialsConfig, resetBrief, MaterialsConfig } from "./materials/briefs";

const LazyLogin = lazy(() => import("./components/ui/LoginPage"));

const Landing = 0;
const Scene = 1;
// Sits between the landing menu and the courtroom. Reached only when the server
// reports that uploads are configured; otherwise the flow is unchanged.
const Upload = 2;
const EndPage = 3;

const LazyLandingP = lazy(() => import("./components/scenes/LandingPage"));
const LazyGeneralS = lazy(() => import("./components/scenes/Scene"));
const LazyGeneralE = lazy(() => import("./components/scenes/EndPage"));
const LazyUpload = lazy(() => import("./components/ui/UploadPage"));

function App() {
  const [subtitleText, setSubtitleText] = useState("");
  const [appState, setAppState] = useState(Landing);
  const [config, setConfig] = useState(defaultData);
  const [paused, setPaused] = useState(false);
  const [judgeElapsedTime, setJudgeElapsedTime] = useState(0);

  // Reports "anonymous" whenever the server runs with SHOW_LOGIN off, which
  // leaves every branch below exactly as it was before login existed.
  const auth = useAuth();

  // Null until the server has answered. The upload step is skipped entirely
  // when it reports uploads are off — no Qdrant, no database, or no API key —
  // so a deployment without them behaves exactly as it did before.
  const [materialsConfig, setMaterialsConfig] = useState<MaterialsConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadMaterialsConfig().then(value => { if (!cancelled) setMaterialsConfig(value); });
    return () => { cancelled = true; };
  }, []);

  const updateConfig = (nextConfig: any) => {
    console.log("New Configuration: ", JSON.stringify(nextConfig));
    setConfig(nextConfig);
  };

  const updateState = (nextState: number) => {
    // The landing menu's "Start Mooting!" still asks for the Scene; the upload
    // step is inserted here rather than in the menu so it appears and vanishes
    // with the server's capability instead of being wired into six buttons.
    if (nextState === Scene && appState === Landing && materialsConfig?.enabled) {
      setAppState(Upload);
      return;
    }
    // A new run must not inherit the previous run's brief, or the judge would
    // question a student about materials they did not file.
    if (nextState === Landing) resetBrief();

    setAppState(nextState);
    if (nextState === Scene) {
      setSubtitleText(config.judgeIntroSpeech);
      // Only when entering from the landing page, or from the upload step that
      // now follows it. Resuming from the pause menu also routes through here,
      // and starting again there would orphan the row holding the argument so
      // far and save the transcript to a new one.
      if (appState === Landing || appState === Upload) {
        // Fire-and-forget: storage is optional and must never delay entry.
        startPracticeSession(config);
      }
    }
    if (nextState === EndPage) {
      // AudioComponent writes the transcript and timings straight onto config
      // as the argument proceeds, so by here they are complete.
      savePracticeSession(config, judgeElapsedTime);
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

  if (loading || auth.status === "loading") return <AppLoader />;

  // Only reachable with SHOW_LOGIN on: the courtroom is not rendered until CWL
  // has identified the student.
  if (auth.status === "signedOut") {
    return (
      <Suspense fallback={<AppLoader />}>
        <LazyLogin />
      </Suspense>
    );
  }

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

        {appState === Upload && materialsConfig?.enabled && (
          <LazyUpload
            materialsConfig={materialsConfig}
            onContinue={() => updateState(Scene)}
            onBack={() => setAppState(Landing)}
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
