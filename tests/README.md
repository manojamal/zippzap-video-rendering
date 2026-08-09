# End-to-end tests

This is a Playwright smoke-test suite covering: the app loads with no console errors,
demo login works, every core section navigates without the error boundary firing,
uploading a real video file adds it to the Video Studio timeline, a basic mobile
responsive check (no horizontal overflow), and a couple of guard-rail checks (render
button doesn't try to run with an empty timeline).

## Running it

```bash
npm install
npm run test:e2e:install   # one-time: downloads the Chromium browser Playwright needs
npm run test:e2e           # builds the app, starts it, and runs the tests
```

Use `npm run test:e2e:ui` for Playwright's interactive UI mode, which is the easiest way
to watch a run and debug a failure.

## Honest disclosure

This suite was written but **could not be executed** in the environment it was built in -
that sandbox's network access is restricted and cannot reach `cdn.playwright.dev` to
download browser binaries (confirmed with a direct `playwright install` attempt, which
failed with a `403 Host not in allowlist` error). So while the tests are structurally
sound and target real, verified UI text/selectors from the current codebase, **they have
not actually been run once, successfully or otherwise.** Please run them yourself and
expect to need a round of selector/text tweaks - UI copy in this app changes fairly
often, and a few of these assertions (especially the nav-label text matches) are the
most likely first thing to need adjusting.

## What this does NOT cover

This is a smoke-test starting point, not full coverage. Notably absent: the actual
render/export pipeline completing successfully (would need a real timeout-tolerant test
given in-browser ffmpeg rendering takes real time), camera/microphone recording (would
need `--use-fake-device-for-media-stream` and a fake media flag, plus Playwright's
`page.context().grantPermissions(['camera','microphone'])`), and the Whisper/Piper
model-download-then-run flows (slow, ~75MB+ downloads on first run - would want a longer
timeout and ideally a mocked/cached model for CI). Worth adding once this baseline is
confirmed working in a real environment.
