# Moot Court
## Project Description
Practice for Moot Court, built using Typescript + React. 

## External Assets

### Included
- [DeepMotion Animation/Rigging](https://docs.readyplayer.me/ready-player-me/#who-can-use-ready-player-me)
- [Judge Model](https://docs.readyplayer.me/ready-player-me/#who-can-use-ready-player-me)
- [Rokoko AI Motion Capture]

## Versioning
- Refer to [this documentation](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository) on how to release projects on github. 
- Moot court releases: https://github.com/ubcemergingmedialab/MootCourt/releases

## Running locally on a Mac

IntelliJudge now uses **browser WebSocket → local Node service → OpenAI Realtime WebSocket**.
No Windows/C++ DxL server, EC2 access, or deployment is needed. Internet access to OpenAI is still required.
The Unreal project is not part of this application.

1. Install Node.js **22.9 or later** and open a terminal in this repository's root (not the nested `moot-court` folder).
2. Install dependencies: `npm install --legacy-peer-deps` (the existing React/Three dependencies have peer-version conflicts).
3. Copy `.env.server.example` to `.env.server.local` if it does not already exist.
4. Set `OPENAI_API_KEY` in `.env.server.local` to your OpenAI API project key. Never put it in a `REACT_APP_*` variable. This file is ignored by Git and read only by the Node service.
5. Run `npm run dev` to start both the app and local service.
6. Open [the local app](http://127.0.0.1:43127), choose IntelliJudge, allow microphone access, and **hold Enter to speak; release Enter for the reply**, as before.

Each developer, follows the same steps on their own Mac and supplies their own local configuration. The app defaults to port `43127`; the service listens on `127.0.0.1:43128` and accepts only the local app's origin. Do not expose it publicly. Press Ctrl+C to stop both processes.

If you already have `.env.server.local` from an earlier version, update `PORT=43127` and `REALTIME_PORT=43128` there; existing environment values override the defaults.

Browser storage is tied to the app's address, including its port. Saved data at the old address is not deleted, but does not automatically appear at the new address.

`npm start` still starts only the frontend; use `npm run dev` for the complete local setup, or `npm run server` in a second terminal. Restart after changing the server environment file. If ports are busy, set `PORT` and/or `REALTIME_PORT` there and use `npm run dev` so the two processes stay in sync.

### Behavior and configuration

- Courtroom UI, hold/release controls, queued audio pause/resume, assessment calculations/data shape, and existing browser storage are retained. The migration does not fix or redesign the existing assessment metrics.
- A completed recording is converted in the browser to mono 24 kHz PCM, then sent over the local WebSocket. The Node service uses OpenAI Realtime for transcription and a spoken reply, and wraps returned PCM in WAV chunks for the existing style of queued playback. No audio files or new transcript database are written by the local service.
- The Canadian Socratic judge prompt from the supplied configuration is retained. The model is now a Realtime model, so wording and voice quality can differ from the old chat/TTS service. Defaults are `gpt-realtime-2.1`, `gpt-4o-mini-transcribe`, and `alloy`; override the three corresponding values in `.env.server.local` if needed for your API project.
- No permanent API key is sent to the browser. The service connects only to OpenAI; there is no fallback to DxL/EC2. OpenAI API usage is billed to the configured project.
- Each practice session has its own OpenAI conversation. If the connection drops, return to the menu and start a new practice session. Earlier conversation context is not restored. A recording may be up to 10 minutes; OpenAI currently limits an individual Realtime connection to 60 minutes.

### Troubleshooting and checks

- **Missing key:** the app displays instructions to set `.env.server.local`; restart `npm run dev` after saving it.
- **OpenAI connection rejected:** verify the key, API billing, and access to the configured models. A ChatGPT subscription alone is not an API key.
- **Not connected:** check that `npm run dev` is running and use `127.0.0.1` or `localhost`, not a LAN hostname.
- **No sound:** check microphone/speaker permissions and the selected output device. An audio playback failure ends the session instead of leaving input locked.
- `npm run test:server`: local WebSocket integration tests with a simulated OpenAI upstream; no key or paid requests required.
- `npm test -- --watchAll=false --runInBand --runTestsByPath src/components/server/ServerUtility.test.ts src/components/avatar_components/AudioComponent.test.tsx`: transport and hold/release regressions.
- `npm run build`: create the frontend production build (does not start or deploy the Node service).

See [OpenAI's WebSocket guide](https://developers.openai.com/api/docs/guides/realtime-websocket) and [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations) for the upstream protocol. The existing live deployment has not been changed.

Verification note: the local protocol/control tests use simulated audio and a fake OpenAI upstream. A real spoken exchange still needs an API key and microphone testing. The existing `src/App.test.tsx` starter test still expects a removed "learn react" link and fails in the full suite; it was not changed as part of this migration. Existing React warnings in `LandingPage` and `PausedMenu` are also outside this change.

## Dependencies
- Created using `npx create-react-app moot-court --template typescript`
- ESLint: `npm install --save-dev eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin`
- react three fiber: `npm install three @react-three/fiber`
- React XR: `npm install @react-three/xr`
- leva: `npm i --force leva`
- react three fiber typescript: `npm install @types/three`
- drei: `npm install @react-three/drei`
- d3: 'npm install d3 --force

## Team

### Faculty:
Jon Festinger, Q.C.
Nikos Harris, Q.C.
Barbara Wang BA, JD


## Troubleshooting
- High severity vulnerability regarding *Inefficient Regular Expression Complexity in nth-check* is likely a false alarm. Can ignore, do not force fix as it may break the project.
- installing the above modules may lead to error *"unable to resolve dependency tree"*. Force install instead (overrides warning for incompatible react versions, shouldn't break the code)

## Documentation
- [Development Documentation](https://github.com/ubcemergingmedialab/MootCourt/blob/master/Development%20Documentation.md)
- [Project Wiki](https://wiki.ubc.ca/Documentation:Moot_Court#Introduction)
- [Revised App Structure](https://github.com/ubcemergingmedialab/MootCourt/blob/master/src/components/main-components/Revised%20App%20Structure.md): Needs to be updated with current code (March 2023)
