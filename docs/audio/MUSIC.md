# Recorded music score

The music beds in `public/audio/music/` were generated with the ElevenLabs Music API (model
`music_v2_5`, `force_instrumental: true`) for this project and post-processed by `tools/gen-music.mjs`.
`src/audio/score.ts` plays them; `src/audio/music.ts` keeps its synthesised tension layer on top. The
creature sounds and ambience are documented in `SFX.md`.

Credit: generated with the ElevenLabs Music API for this project. Usage rights follow the ElevenLabs
music terms for the plan of the account that generated them (pay-as-you-go at the time).

## The tracks

| Track | Used for | Requested | File | Loop | Detected key / tempo | Size |
| --- | --- | --- | --- | --- | --- | --- |
| `evening.mp3` | Golden hour and sunset while herding (mood under 0.6) | 80 s | 76.8 s | 5.91 s to 76.27 s (70.4 s), seamless | D major, about 84 BPM | 1,200 KB |
| `dusk.mp3` | Dusk and night (mood 0.6 and up), and the whole night watch | 60 s | 57.1 s | 3.24 s to 56.56 s (53.3 s, two periods of its 8-bar tune), seamless | D minor, slow (72 BPM asked; its phrase lengths fit 72, the onset detector reads 77) | 893 KB |
| `title.mp3` | Title, season and intro screens, and softly under the results after a win | 50 s | 50.8 s | the whole piece: it rings out, rests 0.8 s and starts again | D major, about 88 BPM | 795 KB |
| `win.mp3` | A short resolving phrase on the results card after a win | 8 s | 6.7 s | one-shot | D major | 107 KB |

Total `public/audio/music/` (with `music.json`): about 3.0 MB. Beds are normalised to -20 LUFS (integrated,
measured on the part that repeats) and the win phrase to -18 LUFS; true peaks stay under -1 dBFS (no limiting
was needed). MP3 128 kbps joint stereo, 44.1 kHz.

The dusk bed came back in D minor rather than the B minor asked for: the parallel minor of the evening's
D major, so the evening-to-dusk change keeps its home note and turns from major to minor, much as the old
synthesised score turned from D major to D dorian and D minor.

Credits used: 1,359 for 198 s of generated audio (the evening alone: 549 for 80 s, about 6.9 credits a
second), measured from the account's character count before and after each run. One call per track, no
retries.

## Prompts

Every prompt also ended with: "Instrumental only, no vocals, no singing, no synths, no electric
instruments, no drum kit." The two beds also asked for "Steady from the first bar to the last: no intro,
no build-up, no breakdown, no ending, no fade-out. Background music for a video game, made to loop."

- **evening** (80 s): Warm acoustic Scottish folk, D major, 84 BPM, a gentle lilting 3/4 waltz with steady
  forward motion. A fiddle and a low whistle share a simple, singable pastoral melody over softly
  fingerpicked and strummed acoustic guitar, a light bodhran pulse played with brushes and a little upright
  bass. Golden-hour evening on a Highland hill farm: calm, hopeful, unhurried but always moving. Intimate
  close-mic'd folk session in a warm wooden room, natural reverb.
- **dusk** (60 s): Sparse, slow Scottish folk air, B minor, 72 BPM, a gentle 3/4. A lone low whistle plays a
  slow, wistful melody over a soft sustained drone on D and A (shruti box) and a few sparse plucked notes of
  acoustic guitar, with a quiet fiddle answering now and then. Violet dusk falling over a Highland glen, the
  moon coming up, lonely and hushed with a hint of unease, never scary. No drums, no percussion. Close-mic'd,
  intimate, soft natural reverb.
- **title** (50 s): Warm acoustic Scottish folk theme for the title screen of a cosy video game about a
  sheepdog, D major, 88 BPM, a lilting 3/4 waltz. A fiddle states a simple, singable pastoral melody, then a
  low whistle joins in harmony, over strummed acoustic guitar, a light bodhran, upright bass and a soft
  harmonium underneath. Fuller and more heartfelt than background music: a golden-hour Highland glen, hopeful
  and welcoming. Close-mic'd folk ensemble in a warm wooden room. It ends on a warm, resolved D major chord
  that rings out.
- **win** (8 s): A short, warm resolving phrase of Scottish folk music in D major, 84 BPM: a fiddle and a low
  whistle play a gentle rising cadence over strummed acoustic guitar and end on a sustained, warm D major
  chord that rings out. Homecoming, contented, a job well done at sunset. Close-mic'd acoustic folk.

The prompts live in `TRACKS` at the top of `tools/gen-music.mjs`.

## Processing

`tools/gen-music.mjs` decodes each take to stereo 44.1 kHz float PCM with ffmpeg (`ffmpeg-static`, a 28 Hz
high-pass for DC and rumble) and then:

- **Trims** leading silence to a 10 ms fade-in and trailing silence to a 60 ms tail.
- **Analyses** the take: an FFT (4096 points, 512 hop) gives per-frame chroma (harmony), onset strength
  (rhythm) and level. The key comes from the chroma (Krumhansl-Schmuckler profiles), the tempo from the onset
  autocorrelation. Both are written to `music.json` and printed, as a check that the model followed the prompt.
- **Loops (evening, dusk)**:
  - Flatten a slow level trend first. The first evening take swelled 8 dB from start to end, and a loop of a
    crescendo drops back at every seam, so a counter-ramp of at most 4 dB each way evens out the loudness.
    The arrangement still builds. Trends under 3 dB are left alone.
  - Pick a loop start A (in the first seconds) and end B (in the last seconds) whose surroundings match best:
    chroma, onset strength and level over 3 s before and 1.5 s after each point, plus a repetition profile
    (how well the whole steady part matches itself shifted by the loop length). Two or three periods of the
    tune count as well as one, so the dusk bed loops two full 8-bar periods rather than one and a half.
  - Align B to A by waveform correlation (+-6 ms), then crossfade the last 1.5 s before B with the 1.5 s
    leading into A. The fade law is set by the measured correlation of the two, so the level holds.
  - The file keeps the intro before A (heard once, when the bed starts) and 0.5 s of what follows A after B,
    so MP3 padding never lands inside the loop. `music.json` gives `loopStart` and `loopEnd` in seconds from
    the content start, and `lead`: where the game's start detector finds the content in the encoded PCM. The
    game compares that with what it finds in the decoded buffer to allow for decoder priming.
- **Song loop (title)**: the piece plays through and its last chord rings out (an abrupt ending would get a
  2.5 s fade), then 0.8 s of silence, and the loop starts again at 0.
- **One-shot (win)**: a 1 s fade if the take stops while still loud, otherwise 0.15 s.
- **Loudness**: gain to the target LUFS (ffmpeg `loudnorm` measurement), then a stereo-linked soft limiter
  if any peak would pass -1 dBFS (at most 4 dB of it; past that the gain is lowered).
- **Checks** (printed, by decoding the final MP3): length, mean and peak level, the loop wrap (the samples after
  `loopEnd` against those after `loopStart`: correlation 0.999 or better), the sample step across the seam
  against the largest step nearby, and the level in the 2 s before `loopEnd` against the 2 s before
  `loopStart`, which the crossfade blends (evening -22.6 / -23.6 dB, dusk -24.3 / -24.8 dB).

Checked in headless Chrome on 2026-10-09: `decodeAudioData` trims the MP3 priming (the content starts at 0),
the loop seams in the decoded buffers correlate at 0.9993 to 0.9998, and an offline render of the score
through both loop seams shows no step bigger than an ordinary sample-to-sample one.

## How the game uses them

`Music` (music.ts) owns a `Score` (score.ts), which loads `music.json` and the four files once the audio
context exists (title first, about 1.5 s for all four). audio.ts passes the scene each frame through
`music.update({ mood, tension, playing, mode, watch: this.rules?.objective === 'watch' })` and the
evening's result through `music.outcome(win)` at the top of `GameAudio.outcome()`. Without `mode` the
score falls back to `playing` (play, otherwise the title bed, so pause would bring in the theme) and
without `outcome` there is no win phrase.

- **Scenes**: title, season and intro screens play the title bed. Play is the evening bed until the mood
  reaches 0.6, then the dusk bed (back to the evening only below 0.5, that is on a new day). The night watch
  stays on the dusk bed. Under the pause menu the bed steps down to 60% within half a second, on top of
  the pause duck in audio.ts.
- **Crossfades**: a new bed starts from its top (its intro), the old one fades out. Evening and dusk are in
  D major and D minor, so that change lets one mostly go (time constant 1.1 s) before the other comes in
  (after 1.4 s, time constant 1.4 s), and the thirds never rub. Other changes overlap more. A bed silent
  for 5 s has its source stopped; it starts from the top next time.
- **Wolves**: as `tension` rises the bed steps back by up to 30%. Music's synthesised tension layer plays on
  top as before: the tremolo strings, the heartbeat, and the drone, which over the recordings only rises with
  the wolves. The strings change their minor third for a second (D E A D), which sits inside both D major and
  D minor. `Score.tensionShift` would move the layer if a regenerated bed came back in another key.
- **Win**: the bed fades, the gate clank and the synthesised win sting play, and the recorded phrase starts
  2 s after the outcome. It is routed straight to the master at the music volume, so the results card's duck
  does not swallow it. As it rings out, the title bed comes back softly. After a loss the evening's bed plays
  on a little lower.
- **Levels** (score.ts constants, to tune by ear): beds 0.55 and the title 0.6 into the music bus, the win
  phrase 0.6 of the music volume. The files are louder than the synthesised tune they replace, hence the
  values under 1.
- **Without the files** (missing folder, a 404, a decode failure) `Score.ready` stays false and the
  synthesised score plays exactly as before. A missing bed is stood in for by another. At start-up the synth
  tune waits up to 3 s for the recordings, so the two never overlap.
- **Memory**: the four tracks decode to about 190 s of stereo PCM, about 73 MB at 48 kHz, held for the session.

## Regenerating

```
node tools/gen-music.mjs                      # generate whatever is missing
node tools/gen-music.mjs --force              # regenerate everything
node tools/gen-music.mjs --force --only dusk  # one track (comma-separated list)
node tools/gen-music.mjs --reprocess          # rebuild from the cached raw downloads, no API calls
node tools/gen-music.mjs --check              # no generation: re-check the files, rewrite music.json
node tools/gen-music.mjs --status             # the account's credit balance
```

Needs `ELEVENLABS_API_KEY` in `.env.local` (git-ignored) or the environment; the key is never printed.
Every raw download is cached (`--raw-dir <dir>`, default `woolgather-music-raw` in the OS temp folder) with
its prompt and response headers (including the ElevenLabs `song-id`), so a processing change never costs
another generation. `--budget N` caps the seconds of audio one run may generate (at most 300, retries
included); the budget is checked before every call. Calls go one at a time.
