# Recorded sound effects

The creature sounds and ambience loops in `public/audio/` were generated with the ElevenLabs Sound
Effects API (model `eleven_text_to_sound_v2`) for this project and post-processed by `tools/gen-sfx.mjs`.
Everything else in the game (music, UI, footsteps and the rest) is still synthesised in `src/audio/`.

Credit: Generated with the ElevenLabs Sound Effects API for this project. Usage rights follow the ElevenLabs terms of the account that generated them.

## Processing

- Raw API output is MP3 44.1 kHz; every take is decoded to mono 44.1 kHz with ffmpeg (`ffmpeg-static`) through
  a 35 Hz high-pass (DC and infrasonic rumble only).
- Loudness: normalised to a target in LUFS (EBU R128 integrated, measured with ffmpeg `loudnorm`). Peaks
  that would pass -1 dBFS are held down by a soft limiter (at most 6 dB of reduction; past that the
  gain is lowered instead, so a file can land under its target).
- One-shots: leading and trailing silence trimmed (40 dB and 50 dB under the peak), 5 ms fade in and
  30 ms fade out, -16 LUFS, MP3 96 kbps mono.
  `bark` and `stamp` keep only the loudest burst if the take holds more than one.
- Loops: requested with the API's `loop` option, any fade at either end dropped, then the last 1 s
  crossfaded (equal power) into the head so the body repeats with no seam, normalised to
  -24 LUFS (the limiter wraps round the seam), MP3 80 kbps mono, no fades.
- MP3 adds encoder priming and padding at the ends, which would put a gap in a loop. So each loop file
  stores 0.3 s of wrapped audio before and after the loop body, and `manifest.json` gives the body
  length (`loopInfo.<name>.seconds`) and the pad (`pad`). `SampleBank` finds the start of the content in
  the decoded buffer and sets `loopStart`/`loopEnd` round the body, so the loop is gapless in every browser.
- Every take is checked by the numbers (length within the expected range, not near silent); a failed take is
  regenerated once with a reworded prompt (marked "alt" below; listed in `manifest.json` as `altPrompt`).

  Checked in headless Chrome on 2026-10-09: `decodeAudioData` trims the priming, and at every loop seam
  the sample jump is no bigger than an ordinary sample-to-sample step.

## Using them in the game

`src/audio/samples.ts` exports `SampleBank`, built on the AudioContext that `AudioEngine.unlock()` creates:

```ts
const bank = new SampleBank(engine.ctx!);
await bank.load(); // never throws: failed files are skipped and listed in bank.missing
bank.play('bleat_ewe', engine.sfx, { gain: 0.7, pan: -0.4 }); // random variant, never the same twice running
const rain = bank.loop('rain', engine.amb, 0);                // fades in to the given gain
rain?.setGain(0.5, 2); // glide (time constant in seconds); rain?.stop() fades out and stops
```

`play` adds a random +-4% detune unless `rate` is given, and takes `delay` in seconds. One-shots sit at
-16 LUFS and loops at -24 LUFS, so set gains against the synthesised mix by ear.

One-shot groups: `bleat_ewe`, `bleat_lamb`, `bleat_ram`, `bark`, `howl`, `growl`, `yelp`, `thunder`, `gate`, `splash`, `stamp`, `butt`, `whoosh_birds`, `flutter`.
Loops: `wind`, `rain`, `stream`, `night`, `dawn`, `loch`.

## Regenerating

```
node tools/gen-sfx.mjs                     # generate whatever is missing
node tools/gen-sfx.mjs --force             # regenerate everything
node tools/gen-sfx.mjs --force --only bark # one group, loop or file (bark_2); comma-separated list
node tools/gen-sfx.mjs --check             # no API calls: re-check files, rewrite manifest and this doc
```

Needs `ELEVENLABS_API_KEY` in `.env.local` (git-ignored) or the environment. `--raw-dir <dir>` keeps the raw
downloads outside the repo so `--reprocess --raw-dir <dir>` can redo the processing without new API calls.
`--max-calls N` caps the requests in one run (default 45, retries included). The script rewrites this file.

## One-shots

| Group | File | Prompt | Requested | Duration | Mean / peak | Credit |
| --- | --- | --- | --- | --- | --- | --- |
| bleat_ewe | bleat_ewe_1.mp3 | A single adult ewe bleating once, a short mid-pitched "baa", field recording on a Scottish hillside, one call only, no other animals, close microphone, outdoors, isolated, no music, no human voices, no background noise | 1 s | 0.96 s | -19.0 / -5.0 dB | Generated with the ElevenLabs Sound Effects API for this project |
| bleat_ewe | bleat_ewe_2.mp3 | One long wavering bleat from an adult sheep, "baaaa" with a tremble in it, one call only, no other sheep, close microphone, outdoors, isolated, no music, no human voices, no background noise | 1.5 s | 1.49 s | -18.3 / -5.4 dB | Generated with the ElevenLabs Sound Effects API for this project |
| bleat_ewe | bleat_ewe_3.mp3 | One low, throaty bleat from a mature ewe, a short grumbling "meh", one call only, close microphone, outdoors, isolated, no music, no human voices, no background noise | 0.9 s | 0.85 s | -18.8 / -4.6 dB | Generated with the ElevenLabs Sound Effects API for this project |
| bleat_ewe | bleat_ewe_4.mp3 | A single nervous sheep bleat, slightly higher pitched and urgent, one call only, field recording, close microphone, outdoors, isolated, no music, no human voices, no background noise | 1.2 s | 1.18 s | -19.3 / -2.4 dB | Generated with the ElevenLabs Sound Effects API for this project |
| bleat_lamb | bleat_lamb_1.mp3 | A young lamb bleating once, a high thin "maa", one call only, no other animals, close microphone, outdoors, isolated, no music, no human voices, no background noise | 0.9 s | 0.89 s | -19.9 / -6.2 dB | Generated with the ElevenLabs Sound Effects API for this project |
| bleat_lamb | bleat_lamb_2.mp3 | A tiny newborn lamb calling for its mother, one short high-pitched quavering bleat, close microphone, outdoors, isolated, no music, no human voices, no background noise | 1 s | 1.00 s | -21.3 / -2.3 dB | Generated with the ElevenLabs Sound Effects API for this project |
| bleat_lamb | bleat_lamb_3.mp3 | A single plaintive bleat from a small lamb, high and thin with a little crack in it, close microphone, outdoors, isolated, no music, no human voices, no background noise | 1.2 s | 1.20 s | -20.6 / -5.2 dB | Generated with the ElevenLabs Sound Effects API for this project |
| bleat_ram | bleat_ram_1.mp3 | A big horned ram giving one deep, gruff, guttural "baa", low-pitched and rough, one call only, close microphone, outdoors, isolated, no music, no human voices, no background noise | 1.4 s | 1.19 s | -16.6 / -6.1 dB | Generated with the ElevenLabs Sound Effects API for this project |
| bleat_ram | bleat_ram_2.mp3 | One short deep grumbling bleat from a large ram sheep, low and hoarse, one call only, close microphone, outdoors, isolated, no music, no human voices, no background noise | 1.2 s | 1.03 s | -17.6 / -5.8 dB | Generated with the ElevenLabs Sound Effects API for this project |
| bark | bark_1.mp3 | One single sharp bark from a medium-size border collie dog, energetic and alert, not aggressive, one bark only, close microphone, outdoors, isolated, no music, no human voices, no background noise | 0.8 s | 0.34 s | -14.2 / -2.4 dB | Generated with the ElevenLabs Sound Effects API for this project |
| bark | bark_2.mp3 | A border collie barks once, a bright quick "woof" to move sheep, eager and keen, one bark only, close microphone, outdoors, isolated, no music, no human voices, no background noise | 0.8 s | 0.61 s | -16.4 / -4.9 dB | Generated with the ElevenLabs Sound Effects API for this project |
| bark | bark_3.mp3 | A single short excited bark from a working sheepdog, mid-pitched and crisp, not growling, one bark only, close microphone, outdoors, isolated, no music, no human voices, no background noise | 0.8 s | 0.37 s | -14.1 / -1.9 dB | Generated with the ElevenLabs Sound Effects API for this project |
| howl | howl_1.mp3 | A single lone wolf howl rising and falling, heard from a distance across open hills at dusk, natural valley echo, one howl only, no other animals, no music, no human voices, no wind | 4 s | 3.18 s | -18.1 / -9.3 dB | Generated with the ElevenLabs Sound Effects API for this project |
| howl | howl_2.mp3 | One long mournful wolf howl far away across a highland glen at nightfall, soft distant echo, a single wolf, no other animals, no music, no human voices, no wind | 4 s | 3.11 s | -18.0 / -7.4 dB | Generated with the ElevenLabs Sound Effects API for this project |
| growl | growl_1.mp3 | A wolf's menacing growl with teeth bared, a rough throaty snarl with a rattle in the mid-range, not just a low rumble, no barking, close microphone, outdoors, isolated, no music, no human voices, no background noise | 1.2 s | 1.00 s | -16.9 / -2.9 dB | Generated with the ElevenLabs Sound Effects API for this project |
| growl | growl_2.mp3 | A wolf baring its teeth with a deep throaty growl that rises into a brief snarl, no barking, close microphone, outdoors, isolated, no music, no human voices, no background noise | 1.5 s | 1.40 s | -16.7 / -3.0 dB | Generated with the ElevenLabs Sound Effects API for this project |
| yelp | yelp_1.mp3 | A wolf yelping in surprise as it turns and runs away, two or three short high yelps fading off, outdoors, no music, no human voices, no background noise | 1.5 s | 0.90 s | -17.5 / -7.5 dB | Generated with the ElevenLabs Sound Effects API for this project |
| thunder | thunder_1.mp3 | A close lightning strike: one sharp, loud crack of thunder followed by a long deep rolling rumble echoing across mountains, outdoors, no rain, no music, no voices | 6 s | 5.18 s | -17.4 / -1.6 dB | Generated with the ElevenLabs Sound Effects API for this project |
| thunder | thunder_2.mp3 | A distant thunder rumble rolling low and soft across far-off hills, no sharp crack, no rain, no music, no voices | 5 s | 4.67 s | -18.2 / -1.9 dB | Generated with the ElevenLabs Sound Effects API for this project |
| gate | gate_1.mp3 | A heavy old wooden farm gate swinging shut on creaky iron hinges and closing with a solid iron latch clack, close microphone, outdoors, no music, no voices, no background noise | 2 s | 1.26 s | -20.8 / -3.6 dB | Generated with the ElevenLabs Sound Effects API for this project |
| splash | splash_1.mp3 | A dog bounding into a shallow rocky stream, a quick lively splash of paws in water, close microphone, outdoors, no barking, no music, no voices | 1.5 s | 1.16 s | -22.0 / -1.9 dB | Generated with the ElevenLabs Sound Effects API for this project |
| splash | splash_2.mp3 | A small single splash in a shallow stream, like a paw or a stone dropping into clear water, close microphone, outdoors, no music, no voices, no background noise | 1 s | 0.67 s | -21.4 / -2.0 dB | Generated with the ElevenLabs Sound Effects API for this project |
| stamp | stamp_1.mp3 | A ram stamping one front hoof hard on soft turf, a single dull thud, close microphone, outdoors, isolated, no animal calls, no music, no voices | 0.7 s | 0.71 s | -22.3 / -2.0 dB | Generated with the ElevenLabs Sound Effects API for this project |
| butt | butt_1.mp3 | A ram head-butting: one solid hollow knock of horns against a body, a dull thud with a woody crack on top, then a short animal grunt, close microphone, outdoors, no music, no human voices | 1.2 s | 1.16 s | -19.8 / -1.8 dB | Generated with the ElevenLabs Sound Effects API for this project |
| whoosh_birds | whoosh_birds_1.mp3 | A flock of starlings swooping low overhead and past, the soft rushing whoosh of hundreds of wings, a few chirps, outdoors, no music, no voices, no wind noise | 3 s | 2.97 s | -20.3 / -2.4 dB | Generated with the ElevenLabs Sound Effects API for this project |
| flutter | flutter_1.mp3 | A small flock of sparrows bursting up out of long grass, a quick crisp flurry of fluttering wings, close microphone, outdoors, isolated, no birdsong, no music, no voices, no background noise | 1.5 s | 1.49 s | -20.1 / -4.4 dB | Generated with the ElevenLabs Sound Effects API for this project |

## Loops

| Loop | File | Prompt | Requested | Loop length | Mean / peak | Credit |
| --- | --- | --- | --- | --- | --- | --- |
| wind | wind.mp3 | A soft breeze rustling through long moorland grass and heather, a gentle airy hiss and whisper of grass blades, steady and calm, no low rumble, no microphone wind noise, no gusts, no birds, no music, no voices, seamless ambience | 11 s | 10.02 s | -22.9 / -8.6 dB | Generated with the ElevenLabs Sound Effects API for this project |
| rain | rain.mp3 | Steady moderate rain falling on grass and a few leaves in the countryside, soft and even, not heavy, no thunder, no wind, no music, no voices, seamless ambience | 11 s | 10.00 s | -27.8 / -1.9 dB | Generated with the ElevenLabs Sound Effects API for this project |
| stream | stream.mp3 | A small highland burn babbling and trickling over stones, gentle clear running water, close-up, steady, no birds, no music, no voices, seamless ambience | 11 s | 10.00 s | -26.9 / -2.1 dB | Generated with the ElevenLabs Sound Effects API for this project |
| night | night.mp3 | A quiet summer night in a meadow: faint distant crickets chirping softly, very calm, no birds, no wind, no music, no voices, seamless ambience | 11 s | 10.00 s | -27.7 / -10.0 dB | Generated with the ElevenLabs Sound Effects API for this project |
| dawn | dawn.mp3 | A gentle dawn chorus in the countryside: songbirds singing softly in the distance, blackbirds and robins, calm and airy, no music, no voices, seamless ambience | 11 s | 9.95 s | -28.5 / -9.7 dB | Generated with the ElevenLabs Sound Effects API for this project |
| loch | loch.mp3 | Gentle small waves lapping softly on a stony lake shore, calm water, slow rhythm, no wind, no birds, no music, no voices, seamless ambience | 11 s | 10.00 s | -30.7 / -2.0 dB | Generated with the ElevenLabs Sound Effects API for this project |

Total size of `public/audio/`: 1115 KB.
