# Moot Court
## Project Description
Practice for Moot Court, built using Typescript + React.

Developed by the Emerging Media Lab at UBC (eml.ubc.ca) alongside Jon Festinger, Q.C., Nikos Harris, Q.C., and Barbara Wang BA, JD from UBC's Peter A Allard School of Law (allard.ubc.ca).

Now part of the Learning Technology Innovation Centre's LT Incubator (https://ltic.ubc.ca/learning-technology-incubator/)

## External Assets

### Included
- [DeepMotion Animation/Rigging](https://docs.readyplayer.me/ready-player-me/#who-can-use-ready-player-me)
- [Judge Model](https://docs.readyplayer.me/ready-player-me/#who-can-use-ready-player-me)
- [Rokoko AI Motion Capture]

## Versioning
- Refer to [this documentation](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository) on how to release projects on github. 
- Moot court releases: https://github.com/ubcemergingmedialab/MootCourt/releases


### Behavior and configuration

- Courtroom UI, hold/release controls, queued audio pause/resume, assessment calculations/data shape, and existing browser storage are retained. The migration does not fix or redesign the existing assessment metrics.
- A completed recording is converted in the browser to mono 24 kHz PCM, then sent over the local WebSocket. The Node service uses OpenAI Realtime for transcription and a spoken reply, and wraps returned PCM in WAV chunks for the existing style of queued playback. No audio files or new transcript database are written by the local service.
- The Canadian Socratic judge prompt from the supplied configuration is retained. The model is now a Realtime model, so wording and voice quality can differ from the old chat/TTS service. Defaults are `gpt-realtime-2.1`, `gpt-4o-mini-transcribe`, and `alloy`; override the three corresponding values in `.env.server.local` if needed for your API project.
- Each practice session has its own OpenAI conversation. If the connection drops, return to the menu and start a new practice session. Earlier conversation context is not restored. A recording may be up to 10 minutes; OpenAI currently limits an individual Realtime connection to 60 minutes.

## Team

### Faculty:
Jon Festinger, Q.C.
Nikos Harris, Q.C.
Barbara Wang BA, JD

### EML:
eml.ubc.ca

### LTIC
Maziyar Dowlatabadibazaz
Rich Tape

## Documentation
- [Development Documentation](https://github.com/ubcemergingmedialab/MootCourt/blob/master/Development%20Documentation.md)
- [Project Wiki](https://wiki.ubc.ca/Documentation:Moot_Court#Introduction)
- [Revised App Structure](https://github.com/ubcemergingmedialab/MootCourt/blob/master/src/components/main-components/Revised%20App%20Structure.md): Needs to be updated with current code (March 2023)
