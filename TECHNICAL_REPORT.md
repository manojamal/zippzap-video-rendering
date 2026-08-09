# ZippZap — Technical Audit & Remediation Report

**Date:** July 8, 2026
**Scope:** Full-codebase audit and repair, with priority on making video upload, stitching, and rendering genuinely functional.
**Stack:** React 19 + TypeScript + Vite 6, client-only (no backend, no external APIs by design).

---

## 1. Executive Summary

The codebase (~16,800 lines across `App.tsx`, `VideoStudio.tsx`, `Dashboard.tsx`, `ContributorPortal.tsx`, `SlideshowStudio.tsx`, and supporting components) built and type-checked cleanly from the start, but a full functional audit uncovered a critical, systemic issue: **the entire video-processing pipeline was simulated**. Rendering, stitching, camera/mic recording, and compression did not do real media work — they faked progress bars and returned placeholder data (in one case, a completely unrelated stock stock video was substituted for a user's own camera recording).

This report documents:
- Every fake/simulated code path found, and what it did instead of the real thing
- Every fix applied, file by file, with the reasoning
- Every other bug found during the audit (type-safety gap, memory leaks, dead features, mis-labeled files, missing error handling)
- What was verified, how, and what remains unverified due to sandbox limitations (no camera/browser available in this environment)

**Net result:** the app now performs real, client-side (ffmpeg.wasm + MediaRecorder/getUserMedia) video encoding, camera/mic capture, and compression — with no server or external API added, consistent with the original constraint.

---

## 2. Critical Finding: The Simulated Video Pipeline

Before any fixes, tracing the actual code (not the UI, which looked complete) showed:

### 2.1 `src/services/RenderWorker.ts` (stitching/rendering engine)
Ran a `setInterval` for a fixed duration to fake a progress bar, then returned:
```js
new Blob(['simulated stitched and compiled video files...'], { type: 'video/webm' })
```
This is a text string wrapped in a video MIME type — not decodable, no frames, no audio. Any `<video>` element or downloaded file would fail to play.

### 2.2 `src/utils.ts` — `compressVideoFile`
"Compression" was implemented as:
```js
const compressedBlob = new Blob([file.slice(0, newSize)], { type: file.type });
```
i.e. it truncated the raw bytes of the original video file. Truncating an MP4/WebM container mid-stream corrupts it — this doesn't produce a smaller *valid* video, it produces a broken one.

### 2.3 `src/components/ContributorPortal.tsx` (contributor selfie/voice/photo capture)
No `getUserMedia` or `MediaRecorder` call existed anywhere. The "recording" flow was a countdown timer that, on completion, always substituted:
- Video: a hardcoded Mixkit stock fireworks video (`mixkit-celebration-with-fireworks-and-confetti-34063-large.mp4`) — **regardless of what the user actually filmed**
- Voice: a hardcoded SoundHelix demo song
- Photo: a hardcoded Unsplash stock photo

This is the most serious bug found: a contributor recording a personal birthday message would have their real recording silently discarded and replaced with unrelated stock media.

### 2.4 `src/components/ReactionRecorder.tsx`
Partially real (did use real `getUserMedia`/`MediaRecorder`) but silently faked a camera-active UI state on permission denial, and fell back to a fake text blob (`"simulated video chunks"`) if the recorder was never actually active.

### 2.5 `src/components/SlideshowStudio.tsx` — export/compile
Same pattern as 2.1: fake `setInterval` progress, then `new Blob(['simulated slideshow output chunks'], {type:'video/webm'})`.

### 2.6 `src/components/TextToSpeech.tsx` — "save as audio file"
Returned `new Blob(['simulated speech audio chunks'], {type:'audio/webm'})` instead of any real audio.

---

## 3. Direction Decision

Given the above, I flagged this to you before proceeding (since fixing it "for real" meant adding a real encoding engine, which is more than a bug fix). You chose: **make it real** — integrate `ffmpeg.wasm` and real `MediaRecorder` output rather than keep simulating. Everything below reflects that decision.

---

## 4. Architecture Added

### 4.1 `ffmpeg.wasm` (client-side video engine)
- Packages added: `@ffmpeg/ffmpeg@0.12.15`, `@ffmpeg/util@0.12.2`, `@ffmpeg/core@0.12.x` (dev-time source of the core binary).
- The core engine (`ffmpeg-core.js`, `ffmpeg-core.wasm`, ~31MB) is **copied into `/public/ffmpeg/`** and served locally from your own domain — not fetched from a CDN. This keeps it consistent with "no external APIs," works offline once cached, and avoids CORS/COOP/COEP complications (the single-threaded core build is used, which needs no special cross-origin-isolation headers).
- Two bundled fonts (`DejaVuSans.ttf`, `DejaVuSans-Bold.ttf`) were added to `/public/fonts/` so ffmpeg's `drawtext` filter (used for subtitles/overlays/text cards) has something to render with.
- It is **lazy-loaded**: the ~31MB wasm binary is only fetched the first time a user actually renders, exports, or compresses something — not on initial page load.

### 4.2 New file: `src/services/ffmpegService.ts` (105 lines)
A small singleton wrapper around `@ffmpeg/ffmpeg`:
- `getFFmpeg()` — lazy-loads and caches one FFmpeg instance; concurrent callers share the same loading promise.
- `toUint8Array()` — converts a `File`/`Blob` to bytes for ffmpeg's virtual filesystem.
- `tryFetchBytes()` — fetches a URL and returns bytes, **or `null` on any failure** (never throws) — used so an unreachable soundtrack or missing asset degrades gracefully instead of crashing the whole render.
- `ensureFonts()` — writes the bundled fonts into ffmpeg's virtual FS once.
- `escapeDrawtext()` — escapes user text safely for ffmpeg filter strings (prevents filter-syntax breakage from colons/quotes/percent signs in subtitles/messages).
- `terminateFFmpeg()` — releases the instance.

### 4.3 Rewritten: `src/services/RenderWorker.ts` (400 lines, was ~120 fake lines)
The real stitching/rendering pipeline. For each clip in the timeline:
1. Reads real bytes (from the uploaded `File`, or fetched from `clip.url` if no local file — with graceful skip-and-continue if a source is unreachable, rather than aborting the whole render).
2. Normalizes to a common 1280×720 @30fps canvas, honoring the user's chosen fit mode:
   - `cover`: scale-to-fill + center-crop
   - `contain`: scale-to-fit + letterbox padding
3. Applies the clip's video filter (or the global one) and the global color grade, mapped to real ffmpeg filters:
   - `grayscale` → `hue=s=0`
   - `sepia` → a standard sepia `colorchannelmixer` matrix
   - `vibrant` → `eq=saturation=1.8:contrast=1.25:brightness=0.06`
   - `brightness` → `eq=brightness=0.25`
   - Color grades (`warm`, `cool`, `vibrant`, `bw`, `sepia`, `cinematic`, `cyberpunk`, `solarize`) → `colorbalance`/`eq` combinations (documented in-code as approximations; `solarize` in particular has no true equivalent in ffmpeg's stock filter set, so it's an approximated "glow" look — not a literal per-pixel solarize).
4. Handles all 4 timeline item types:
   - **video** — trims to `trimStart`/`trimEnd`, re-encodes
   - **photo** — looped for its duration with a silent audio track added (`anullsrc`) so it can be concatenated with real audio clips
   - **text** ("wish card") — rendered as a solid background with the message burned in via `drawtext`
   - **audio** — rendered as a real waveform visualization (`showwaves`) with the actual audio track, so an audio-only contribution isn't silently dropped from the video
5. Burns in per-clip subtitles and any text overlays via `drawtext`, including a fix for **overlays anchored to the global timeline** (an overlay with no specific clip assigned is now correctly placed on whichever clip(s) its time range actually falls in, computed via a running cumulative-offset tracker).
6. Concatenates all processed clips with ffmpeg's concat demuxer.
7. If a soundtrack was selected, mixes it in via `amix` at the chosen volume — **and if the soundtrack URL is unreachable, the render still completes without music** rather than failing outright.
8. Reports real, weighted progress (70% per-clip transcoding / 20% concat / 10% final mux) instead of a fake timer.
9. Returns a real, playable `.mp4` `Blob`.
10. Cleans up every temporary file written to ffmpeg's virtual filesystem in a `finally` block (addresses the "clean temp files" / "no memory leaks" requirement).
11. Added a proper `onError` callback (didn't exist before) so a failed render surfaces a real error message instead of hanging or silently failing.

**Known simplification (documented, not hidden):** transitions between clips are currently hard cuts, not crossfades. The original code's `transition` field ('fade'/'slide'/'none') was **never actually implemented in either the old fake version or an ffmpeg `xfade` chain** — building and testing a correct multi-clip `xfade`/`acrossfade` chain without a live browser to verify it was judged too risky to ship un-tested. This is a strict improvement over before (real, correct, audio-preserving output) with one cosmetic feature (crossfade blending) still open — flagged clearly rather than silently dropped.

### 4.4 `compressVideoFile` (in `src/utils.ts`)
Rewritten to actually load ffmpeg and run a real transcode:
```
-vf scale='min(<target>,iw)':-2 -c:v libx264 -preset veryfast -crf <preset> -c:a aac -b:a 128k
```
with presets for low/medium/high mapping to real CRF + max-width values, real progress reporting via ffmpeg's `progress` event, and proper temp-file cleanup. This directly fixes the byte-truncation corruption bug (2.2).

### 4.5 Real camera/mic capture
- **`ReactionRecorder.tsx`**: on `getUserMedia` failure, now shows a specific, honest error (permission denied / no device found / device busy) with a "Try Again" button, instead of pretending the camera is active. Removed the fake-blob fallback in `stopRecording` entirely — recording now only ever produces a result from an actual `MediaRecorder`. Also fixed: the result blob now uses the recorder's actual negotiated `mimeType` instead of a hardcoded `'video/webm'` label (some browsers negotiate `video/mp4`).
- **`ContributorPortal.tsx`**: this required the largest rewrite. Added:
  - `startVideoRecording`/`stopVideoRecording` — real camera+mic capture via `getUserMedia({video:true,audio:true})` into a live `<video>` preview element, recorded with `MediaRecorder`, auto-stops at the existing 15s limit.
  - `startVoiceRecording`/`stopVoiceRecording` — real mic-only capture, same pattern.
  - `startPhotoCapture`/`capturePhotoFrame` — real camera preview, and on shutter/countdown-end, draws the live video frame to an offscreen `<canvas>` and exports it via `canvas.toBlob('image/jpeg')`.
  - `mapMediaError()` — a shared helper that turns `getUserMedia` exceptions into readable messages (`NotAllowedError`, `NotFoundError`, `NotReadableError`) shown in the UI with a retry action, instead of the previous behavior of continuing as if nothing was wrong.
  - `stopAllMediaStreams()` — new cleanup helper, called when switching contribution type, when the component unmounts, and when discarding a recording from the review modal, so a camera/mic stream is never left running in the background after the user navigates away (a real privacy/resource leak that existed even before this pass, since the old code never called `getUserMedia` at all and thus never had a stream to stop — but the review-modal "record over" and type-switch handlers needed the new stop calls added once real streams existed).
  - All three "redo/retake" buttons now call `URL.revokeObjectURL()` on the discarded recording before clearing state (memory-leak fix).

### 4.6 Real slideshow export (`SlideshowStudio.tsx`)
Rather than re-implement all of the slideshow's photo/text/transition compositing logic in ffmpeg filters, I reused the app's **existing real canvas-drawing function** (`drawSlideshowFrame(t)`, which already draws frames for the live scrubber) and captured it directly:
- `canvas.captureStream(30)` → real video track
- Selected background music routed through a `MediaElementSource` → `GainNode` → `MediaStreamDestination` (Web Audio API) so it can be mixed into the recorded stream
- `MediaRecorder` records the combined video+audio stream while the timeline is played through once, in real time, via `requestAnimationFrame`
- Output is a genuinely playable `.webm` matching exactly what the live preview shows (same photos, frames, text cards, transitions)

This also fixed a **dormant, pre-existing bug**: the music-track selector (`musicId`) was wired to nothing at all — clicking a track only highlighted the tile with no effect on preview or export. It's now actually mixed into the real export.

### 4.7 Text-to-Speech "save" (`TextToSpeech.tsx`)
This one has a genuine platform limitation, disclosed rather than worked around with another fake blob: **there is no standard Web API that exposes raw audio bytes from `SpeechSynthesisUtterance`.** The only way to get *real* audio out of it without a server-side TTS API is to record the system/tab audio while it plays, via `getDisplayMedia({audio: true})`. I implemented this:
- On "Synthesize Voice File," the browser's native "share a tab" picker opens; the user selects "This Tab" with "Share tab audio" enabled.
- The real audio track from that share is recorded with `MediaRecorder` while `speechSynthesis.speak()` runs.
- The resulting blob is genuinely the synthesized voice, saved as a real file.
- If the browser doesn't support `getDisplayMedia` (older Safari, some mobile browsers), or the user shares without audio, the app says so explicitly and suggests using "Direct Preview" instead — it does **not** fall back to fake data.
- Added an inline UI note explaining the share-tab-audio requirement, since it's a different (more involved) interaction than a simple record button.

**This is the one area where "real" comes with a genuine UX trade-off** (an extra permission dialog, Chromium-only), and I want that clearly on your radar rather than glossed over.

---

## 5. Other Bugs Found and Fixed (not part of the fake-media issue)

| # | File | Bug | Fix |
|---|---|---|---|
| 1 | *(project-wide)* | **`@types/react` and `@types/react-dom` were not installed at all.** Because `tsconfig.json` has no `strict`/`noImplicitAny`, TypeScript silently treated the entire `react` import as `any` — meaning `tsc --noEmit` had been "passing" without actually type-checking any component, hook, or prop. | Installed real `@types/react@19`/`@types/react-dom@19`. This surfaced 3 genuine latent errors (see below), all fixed. `tsc --noEmit` now passes **with real type-checking active**, not a false negative. |
| 2 | `VideoStudio.tsx` | Overlay preview never displayed any text — referenced a nonexistent `ov.t` property instead of `ov.text` on the `TextOverlay` type. | Fixed the property reference. |
| 3 | `VideoStudio.tsx` | A frame-ready check called `img.readyState`, which doesn't exist on `HTMLImageElement` (that's a `<video>`/`<audio>` property). | Simplified to the correct check, `img.complete`. |
| 4 | `VideoStudio.tsx` | A framer-motion `transition.ease: 'easeInOut'` was typed as a plain `string`, which no longer satisfies framer-motion's `Easing` type. | Added `as const`. |
| 5 | `VideoStudio.tsx` | 6 of 12 background music options (`bm7`–`bm12`) silently resolved to `null` — selecting them did nothing. | Replaced the local, incomplete `getSoundtrackUrl` with a new shared, complete one in `utils.ts` covering all 12 tracks (mapped to SoundHelix's demo catalog, tracks 1–12). |
| 6 | *(app-wide)* | No React error boundary anywhere — an exception thrown during render of any component would unmount the entire app to a blank white screen. | Added `src/ErrorBoundary.tsx` (69 lines), wired in at the root in `main.tsx`, showing a "Something went wrong" screen with a reload button instead of a blank page. |
| 7 | `VideoStudio.tsx` | Rendered output blob URLs were never revoked (`URL.revokeObjectURL`) — a memory leak across repeated renders. | Now revokes the previous output URL before starting a new render. |
| 8 | `VideoStudio.tsx` | Download link labeled the file `.webm` while it was actually served as `video/webm`-typed **fake text data** before this pass; now the real output is genuinely `.mp4`. | Updated filename/label to `compiled_surprise.mp4` to match the real output type. |
| 9 | `MediaLibrary.tsx` | Bulk-download always forced file extensions (`.png`/`.mp3`/`.mp4`) regardless of the item's actual type, so e.g. a JPEG could be downloaded labeled `.png`. | Now infers the extension from the actual source URL, with a sensible fallback. |
| 10 | `App.tsx` | All page components (`VideoStudio`, `SlideshowStudio`, `ContributorPortal`, plus the rest) were eagerly imported into one bundle. | Converted the three largest to `React.lazy()` + `Suspense`, cutting the main JS bundle from **906KB → 523KB**, with the rest (`VideoStudio` 315KB, `ContributorPortal` 53KB, `SlideshowStudio` 28KB — gzipped sizes are smaller) loaded on demand only when a user actually opens those pages. |
| 11 | `index.html` | Generic leftover title, `My Google AI Studio App`. | Set to `ZippZap` (from `metadata.json`), added a real meta description. |
| 12 | `netlify.toml` | No explicit MIME/caching headers for the new ffmpeg/font static assets. | Added header rules so `ffmpeg-core.wasm` is served as `application/wasm` with long-lived immutable caching (important: some static hosts misconfigure `.wasm` MIME type, which breaks loading entirely). |

---

## 6. Every File Touched

| File | Type of change |
|---|---|
| `src/services/ffmpegService.ts` | **New** — ffmpeg.wasm loader/singleton and shared helpers |
| `src/services/RenderWorker.ts` | **Rewritten** — real stitching/render pipeline (was fully fake) |
| `src/ErrorBoundary.tsx` | **New** — app-wide crash guard |
| `src/main.tsx` | Wrapped `<App/>` in the new `ErrorBoundary` |
| `src/utils.ts` | `compressVideoFile` rewritten to use real ffmpeg transcoding; added shared `getSoundtrackUrl` (fixes tracks 7–12) |
| `src/components/VideoStudio.tsx` | Wired overlays + error handling into the real render call; fixed `.t`/`.readyState`/ease-type bugs; revoke output URL on re-render; fixed download filename/label; import shared soundtrack helper; relabeled "LIVE EXPORT SIMULATION" preview modal to "TIMELINE PREVIEW" for accuracy |
| `src/components/SlideshowStudio.tsx` | Real canvas-capture + `MediaRecorder` export replacing the fake blob; wired the previously-dead soundtrack selector into the real export; added error state/banner |
| `src/components/ReactionRecorder.tsx` | Removed fake-camera and fake-blob fallbacks; added honest permission-error UI; fixed blob mimeType; revoke URL on retake |
| `src/components/ContributorPortal.tsx` | Full real camera/mic/photo capture (previously entirely mocked, including substituting unrelated stock media); stream cleanup on type-switch/unmount/discard; permission-error UI |
| `src/components/MediaLibrary.tsx` | Fixed bulk-download file-extension guessing |
| `src/App.tsx` | Code-split `VideoStudio`/`SlideshowStudio`/`ContributorPortal` via `React.lazy`+`Suspense` |
| `src/components/TextToSpeech.tsx` | Real tab-audio capture replacing fake blob; added explanatory UI copy |
| `index.html` | Fixed page title/meta description |
| `netlify.toml` | Added MIME/cache headers for new static assets |
| `public/ffmpeg/ffmpeg-core.js`, `public/ffmpeg/ffmpeg-core.wasm` | **New** — locally-hosted ffmpeg.wasm engine |
| `public/fonts/DejaVuSans.ttf`, `public/fonts/DejaVuSans-Bold.ttf` | **New** — bundled fonts for subtitle/overlay text rendering |
| `package.json` / `package-lock.json` | Added `@ffmpeg/ffmpeg`, `@ffmpeg/util`, `@ffmpeg/core` (dependencies) and `@types/react`, `@types/react-dom` (devDependencies) |

---

## 7. Verification Performed

- `npm install` — clean.
- `npx tsc --noEmit` — **0 errors**, and this check is now meaningful (see §5, item 1) rather than a false pass.
- `npx vite build` — succeeds; output includes properly split chunks (`index-*.js` 523KB, `VideoStudio-*.js` 315KB, `ContributorPortal-*.js` 53KB, `SlideshowStudio-*.js` 28KB, `ffmpegService-*.js` 5KB).
- Ran `vite preview` and confirmed via `curl` that the built app, its JS bundles, `ffmpeg-core.js`, `ffmpeg-core.wasm`, and the bundled fonts all serve with HTTP 200 from the production build.
- Read through every changed code path manually for correctness (ffmpeg command construction, filter-graph syntax, escaping of user-supplied text, cleanup/finally blocks, React state transitions).

### What I could **not** verify (sandbox limitations — please check these yourself)
- No camera/microphone or GUI browser is available in this environment, so I could not literally record a live selfie/voice/photo or watch a render play back end-to-end.
- No visual, cross-device responsive check (phone/tablet/desktop) was performed — I reviewed the Tailwind responsive classes in code and they look sound, but this needs a real-device or DevTools pass.
- The `getDisplayMedia`-based TTS recording is correct per spec but genuinely browser-dependent (works in Chrome/Edge, not guaranteed elsewhere) — untested live.
- Crossfade/slide transitions between clips are not implemented in the real renderer (hard cuts only) — a known, disclosed simplification, not a regression.

**Recommendation before you consider this "done":** upload a couple of real clips, click render, and open the resulting `.mp4` — that one live check would confirm the core pipeline end-to-end in a way I structurally cannot from this sandbox.

---

## 8. Summary

The app now performs genuinely real, fully client-side video stitching, rendering, compression, and camera/mic/photo capture — with no server or external API introduced, honoring the original constraint. Every fake-data code path found has either been replaced with real functionality or, where a true platform limitation exists (TTS-to-file capture), clearly disclosed instead of papered over with another fake blob. Alongside that, a real type-safety gap, several memory leaks, a dead feature (soundtrack selector doing nothing), and a couple of mislabeled outputs were found and fixed during the pass.

---

## 9. Addendum — Round 2: Transitions, Multi-Threading, Real STT/TTS, and More Fake-Media Bugs

A follow-up request asked for (a) real crossfade/slide transitions, faster rendering, and removal of the TTS browser restriction, and (b) real on-device speech-to-text (captions) and text-to-speech, explicitly *without* adding a cloud LLM or server (that tradeoff was discussed and deferred). This section documents that pass.

### 9.1 New architecture added

- **Real crossfade/slide transitions** (`RenderWorker.ts`): clips are grouped into "chains" split wherever a transition is `'none'`; each chain of 2+ clips is blended with ffmpeg's `xfade`/`acrossfade` filters (both video and audio crossfade together, correctly, using cumulative-offset math), with a defensive fallback to a hard cut if the filter graph fails for any reason. Chains are then hard-concatenated as before. This removes the "hard cuts only" limitation noted at the end of the first round.
- **Multi-threaded ffmpeg core** (`@ffmpeg/core-mt`): loaded automatically when `window.crossOriginIsolated` is `true` (2-4x faster rendering on multi-core devices), with automatic, silent fallback to the proven single-threaded core otherwise — rendering never breaks even if the required headers aren't present. Enabled via new `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` headers in `netlify.toml`, using the more permissive `credentialless` COEP mode specifically to minimize the chance of breaking the app's existing cross-origin soundtrack fetches (which don't send CORP headers).
- **Real local neural text-to-speech** (`@mintplex-labs/piper-tts-web`, ONNX/WASM): replaces the previous round's `getDisplayMedia` "share your tab audio" workaround entirely. This is a strictly better solution — genuine audio output, no picker dialog, no Chromium-only restriction, works in any modern browser. Added a voice picker (6 real voices) and real download-progress UI for the one-time voice-model fetch.
- **Real local speech-to-text** (`@huggingface/transformers`, Whisper via WASM/ONNX): new `speechToTextService.ts` decodes any clip's real audio to 16kHz mono PCM and runs actual Whisper transcription, fully on-device.
- Both `TextToSpeech` and the new STT service are lazy-loaded (`React.lazy`) so their ONNX Runtime dependency (~27MB WASM, only fetched when a user actually uses either feature) never impacts initial page load; the main bundle stayed at ~515KB.

### 9.2 Three more fake-caption/narration bugs found and fixed

While wiring in real transcription, this app turned out to have **three separate** fabricated-text features, not one:
1. `handleAutoTranscribeSubtitles` — generated random canned birthday-greeting placeholders as "subtitles," completely unrelated to what was actually said.
2. `handleConvertAudioToSubtitles` — worse: **hardcoded fake transcripts keyed to specific fake contributor names** (e.g. a name match to "Emeka Obi" always produced the same pre-written sentence, regardless of the clip's actual audio).
3. An in-Studio "Natural Text-to-Speech Engine" narration tool — claimed to synthesize the exact text a user typed, but actually just appended an unrelated SoundHelix music track to the timeline and called it "AI Speech Synthesized."

All three now use the real Whisper/Piper pipelines described above. The narration tool's accent dropdown was also fixed — it offered a "Nigerian Pidgin" voice option that doesn't exist in Piper's voice catalog (there is no such model), so rather than silently mapping it to a different voice while keeping a misleading label, the option was replaced with a real, distinct voice that is actually available.

### 9.3 Additional fake-media substitution bugs found (same class as Round 1, different locations)

A broader sweep of `VideoStudio.tsx` surfaced several more instances of the exact bug pattern from the first round — a feature claims to use real captured/processed content but actually substitutes something unrelated:

| Feature | Was doing | Now does |
|---|---|---|
| "Screen Recorder" tool | Always inserted an unrelated stock video of someone holding a smartphone, regardless of what was on screen | Real `getDisplayMedia` + `MediaRecorder` capture of the actual screen/window/tab the user shares |
| "Microphone Voice Note Recorder" | Always inserted a random SoundHelix music track labeled as the user's voice | Real `getUserMedia({audio:true})` + `MediaRecorder` capture of the actual microphone |
| Advanced Transcoder / format converter | Had **no source-file input at all** — faked a progress bar and, in its own code comment, admitted to producing a "Mock conversion download" | Added a real file picker; runs an actual ffmpeg conversion (video/audio/image, with correct codec mapping per target format) and serves the real converted file |
| Studio clip compression fallback | When a clip had no attached `File` object, fed the (already-fixed, real) ffmpeg compressor a 14MB buffer of zero bytes | Fetches the clip's real bytes from its URL first; if genuinely unreachable, tells the user rather than compressing garbage |
| "AI Vocal Pitch Changer" / "Reverse Audio" toggles | Set state that was never read anywhere — pure dead UI, no effect on output | Wired into the real renderer via ffmpeg's `asetrate`/`aresample` (pitch) and `areverse` (reverse) filters |
| **A second, entirely separate "Compile & Download" export button** | Ran its own independent fake pipeline — a `setInterval` progress bar producing a `Blob` containing the literal string `"Simulated highly optimized high fidelity movie stream..."`, with a comment reading *"Generate a fake but downloadable file"* | Now calls the **same real, shared `RenderWorkerService`** pipeline as the main "Stitch & Render" panel, parameterized by the format/resolution/fps/quality this panel already exposed (which the fake version never actually applied to anything) |
| Contributor final-submission fallback | If a contributor somehow reached "Submit" without a completed recording/upload, silently substituted stock video/audio/photo and submitted it as their contribution | Submission is now blocked with a clear prompt to finish recording/uploading first — it will never submit content the contributor didn't actually create |

The last item in that table was the most consequential find of this pass: **there were two completely independent "export my video" pipelines in this app**, and only one of them had been found and fixed in the first round. `RenderWorker.ts` was refactored so both entry points share one real implementation — its output resolution (720p/1080p/4K), frame rate, quality (CRF), and format (MP4/WebM/AVI/GIF, including real palette-based GIF encoding) are now all genuine parameters rather than being hardcoded in one path and completely fake in the other.

### 9.4 Verification performed (Round 2)

- `npx tsc --noEmit` — clean after every change described above.
- `npx vite build` — succeeds; confirmed via chunk output that `TextToSpeech`, `piper-tts-web`, `speechToTextService`, and `ort.bundle.min` (ONNX Runtime) are all separate, lazily-loaded chunks — none inflate the initial page load.
- Re-read every changed ffmpeg command construction for correctness (filter syntax, escaping, cleanup).

### 9.5 What I still could not verify (same sandbox limitation as Round 1)

No camera, microphone, or GUI browser is available in this environment, so none of the following were tested by actually running them: the crossfade/slide transition output, multi-threaded rendering's real speedup, Piper TTS's generated audio, Whisper's transcription accuracy, the screen/mic recorders, the format converter's output files, or the now-shared export pipeline's GIF/WebM/AVI paths. All of it is correct by code inspection and follows documented library APIs and standard ffmpeg filter syntax, but a live pass in a real browser (upload a few clips, add a transition, hit render; try the screen recorder; try auto-captions) is the one thing I structurally cannot do from here and would meaningfully increase confidence before you call this final.

One more honest note: **a sandbox reset occurred partway through this round**, and some in-progress work was lost before being recovered from a checkpoint. This is mentioned in the interest of full transparency about the process, not because it affects the delivered code — the recovery point and all subsequent work were re-verified clean.

### 9.6 Install-robustness fix found during final verification

Before delivering, I did a from-scratch `npm install` → `tsc` → `vite build` on the exact packaged zip (not just the already-running dev copy) to be sure it works cold. That surfaced one real issue: `@huggingface/transformers` depends on `onnxruntime-node` (a *server-side* Node.js backend this browser-only app never uses or imports), and that package's install script tries to download a native binary from `api.nuget.org`. In this environment that domain isn't reachable, which aborted the entire `npm install` before anything else (React types, Vite, Tailwind, etc.) could install. A real developer machine or most CI providers would likely reach `api.nuget.org` fine, but there's no reason to carry that risk or the unused native binary for a project that only ever runs in a browser. Fixed by adding a tiny local no-op stub package (`vendor/onnxruntime-node-stub/`) and an `overrides` entry in `package.json` that redirects `onnxruntime-node` to it — verified with a completely clean `rm -rf node_modules && npm install` afterward. This has no effect on functionality (the real, used ONNX backend is `onnxruntime-web`, untouched).

---

## 10. Addendum — Round 3: Reliability, Guardrails, PWA, Accessibility, and Tests

Following a suggestions review, this round implemented every item raised: real cancel buttons, upload guardrails, offline caching, low-power device handling, file-content validation, contributor rate-limiting, an accessibility pass, and an automated test suite.

### 10.1 Real cancellation for render/export/transcription

- `RenderWorkerService.cancel()` now actually terminates the underlying ffmpeg worker mid-job (via `terminateFFmpeg()`), not just a cooperative flag checked between steps — a running `ffmpeg.exec()` call is killed immediately. The engine reloads fresh automatically on the next render.
- The render-progress panel, the export panel, and the auto-caption panel each got a visible **Cancel** button. Auto-captioning (Whisper) can only be cancelled *between* clips, not mid-inference — the library doesn't expose a hard-abort hook for a single in-progress transcription — so its cancel button is honestly labeled "Cancel After Current Clip" rather than implying an instant stop it can't deliver.
- Fixed a small bug found in passing: the export panel's download link was clearing/leaking its blob URL immediately on click rather than after the download had actually started.

### 10.2 Upload guardrails (file size, timeline duration/clip-count, file-content validation)

Since every render/transcode/compress runs in the browser tab's own memory with no server to fall back on, oversized inputs can crash the tab rather than fail cleanly. Added to `utils.ts` and wired into every upload entry point (`UploadForm.tsx`, `App.tsx`'s bulk photo upload and studio-clip upload, `ContributorPortal.tsx`):

- **Per-file size cap** (500MB) with a clear rejection message.
- **Timeline duration/clip-count soft warnings** (10 minutes combined, 60 clips) — these confirm rather than hard-block, since they're about performance, not correctness.
- **Magic-byte file-signature validation** — reads each file's actual leading bytes and checks them against known signatures for MP4/WebM/AVI/JPEG/PNG/GIF/WebP/HEIC/WAV/MP3/OGG, rather than trusting only the extension or browser-reported MIME type. Catches a renamed, corrupted, or mislabeled file before it reaches ffmpeg and produces a confusing decode error. Formats outside this signature list aren't blocked (best-effort check, not a strict allowlist).

### 10.3 Contributor submission rate-limiting

Added a localStorage-backed cooldown (20 seconds between submissions) and a soft per-event cap (15 submissions per browser) in `checkSubmissionRateLimit`/`recordSubmission`, wired into the contributor portal's submit flow. Documented honestly in-code that this is a **friction/deterrent measure, not a security boundary** — with no backend, it can only track "this browser," and a determined spammer with multiple devices can bypass it. Real abuse prevention would need server-side enforcement.

### 10.4 Low-power device detection for the multi-threaded ffmpeg core

`ffmpegService.ts`'s decision to use the multi-threaded ffmpeg core now also checks `navigator.hardwareConcurrency` (≤2 cores skips it), `navigator.deviceMemory` (≤2GB skips it, Chrome-only signal), and a mobile-device user-agent check — on top of the existing `crossOriginIsolated` requirement from Round 2. Spinning up worker threads on a 2-core phone doesn't meaningfully speed anything up and just costs an extra ~32MB download and worker-startup overhead for no benefit.

### 10.5 First-time-download notice for speech-to-text

The auto-caption panel now states upfront that it downloads a ~75MB model once, and caches it afterward — closing the gap where only the Piper TTS panel (from Round 2) had this messaging.

### 10.6 Offline caching via a PWA service worker

Added `vite-plugin-pwa` with a deliberately two-tiered caching strategy:
- The app shell (~2MB: JS/CSS/HTML) is precached on install, so the app loads and navigates instantly offline after a first visit.
- The **large, on-demand engine files are explicitly excluded from precaching** (`globIgnores: ['**/ffmpeg/**', '**/ffmpeg-mt/**', '**/*.wasm']`) — otherwise every first-time visitor would be forced to download 100MB+ before the app even finished installing its service worker, defeating the whole lazy-load architecture from Rounds 1-2. Instead, a `CacheFirst` runtime-caching rule catches the ffmpeg cores, fonts, Hugging Face model weights, and SoundHelix soundtrack files the *first time each is actually requested* (i.e. the first time a user renders, transcribes, or plays a track), then serves them from cache on every subsequent use or offline session.
- Verified via the build output directly: `precache 19 entries (2135.86 KiB)` confirms only the small app-shell files are in the initial precache, and a `grep` of the generated `sw.js` for the large wasm filenames returned zero matches, confirming they're excluded as intended.
- Added a manifest (installable PWA, "Add to Home Screen" support) and three generated icon sizes (192/512/apple-touch), plus the associated meta tags in `index.html`.

### 10.7 Accessibility pass

Given the scope (17,000+ lines), this was a targeted, high-leverage pass rather than an exhaustive per-button audit:

- **Global `:focus-visible` styles** added in `index.css` — every button, link, input, and `[role="button"]` in the entire app now gets a visible keyboard-focus ring, without adding one on mouse/touch clicks. This is the single highest-leverage accessibility fix available, since it applies everywhere at once rather than needing per-component changes.
- **Timeline drag-to-reorder is keyboard-accessible already** (discovered, not built) — `@hello-pangea/dnd` provides built-in keyboard support (Space to lift, arrow keys to move, Space to drop, Escape to cancel) as long as `dragHandleProps` is applied to a focusable element, which it already was. Added a proper `aria-label` describing the interaction, since it previously only had a `title` attribute (less reliably announced by screen readers).
- Added `aria-current="page"` to active navigation items, `aria-label`/`aria-expanded`/`aria-haspopup` to the mobile menu toggle and drawer close button, `role="dialog"`/`aria-modal` to the navigation drawer, and `aria-hidden="true"` to decorative emoji icons so screen readers don't announce them as meaningless text.
- Added a `.sr-only` utility class for future screen-reader-only text.

This is explicitly **not** a complete WCAG audit — a genuinely thorough pass across every icon-only button, modal, and form in a codebase this size is a substantial follow-on project of its own, not something foldable into this session. The changes made are the ones with the best effort-to-impact ratio.

### 10.8 Automated end-to-end tests

Added a Playwright smoke-test suite (`tests/smoke.spec.ts`) covering: the app loads with zero console errors, demo login works, every core navigation section renders without the error boundary firing, uploading a real (freshly-generated, valid) test video actually adds it to the Video Studio timeline, a basic mobile-viewport horizontal-overflow check, and a guard that the render button doesn't try to process an empty timeline. Also added `playwright.config.ts` (auto-builds and serves the production bundle before testing) and `npm run test:e2e`/`test:e2e:ui`/`test:e2e:install` scripts.

**Honest disclosure, stated plainly in `tests/README.md` as well:** I could write this suite but **could not execute it once** — this sandbox's network access cannot reach `cdn.playwright.dev` to download browser binaries (confirmed directly: `playwright install` failed with `403 Host not in allowlist`). The tests are structurally sound and reference real, current UI text/selectors from this exact codebase, but they have not been proven to pass. Expect to need a round of selector adjustments when you run them for the first time — this is a starting point, not a finished, verified suite.

### 10.9 Verification performed (Round 3)

- `npx tsc --noEmit` — clean after every change.
- `npx vite build` — succeeds; confirmed via build output that the PWA precache correctly excludes the large engine files.
- A complete cold-start verification identical to Round 2's process: `rm -rf node_modules && npm install && npx tsc --noEmit && npx vite build`, all clean, on the exact zip being delivered — confirming the new dependencies (`vite-plugin-pwa`, `@playwright/test`) introduce no install-time issues of their own.

### 10.10 What's still unverified

Same limitation as every prior round: no camera, microphone, or GUI browser in this sandbox. Additionally specific to this round: the Playwright suite has never actually run (see 10.8), and the PWA's real-world offline behavior (does a render actually work with no network after first use, does "Add to Home Screen" work as expected on a real phone) is correct by configuration/build-output inspection only, not a live test.

