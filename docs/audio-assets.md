# Racing Carts: audio assets

The game ships with **silent placeholder mp3s**: 21 files in `apps/game/public/audio/`. This page describes
what each one should sound like, with a ready-to-paste **generation prompt** for an AI audio tool
(a music or sound-effect generator such as Suno, Udio, ElevenLabs Sound Effects or Stable Audio).
Generate the files, drop them in, rebuild. Nothing in the code changes.

## How to replace a file

1. Generate the sound from its prompt below; trim and normalise it (see "Loudness").
2. Export an **mp3** and **give it exactly the file name shown** (for example `boost.mp3`).
3. Copy it over the placeholder in `apps/game/public/audio/`. The name is the only link: there is no other list to edit.
4. `npm run build -w game` (or `npm run build:tv` for the TV package) copies the files into `dist/audio/`.
   While developing, `npm run dev -w game` serves them straight from `public/audio/`.

A missing or broken file never stops the game: that one sound is silent and the browser console shows one
warning naming the file. `apps/game/scripts/make-silent-audio.sh` rewrites the silent placeholders
(it overwrites every file, so do not run it after you have added real ones).

## Format and loudness

- **Format:** mp3, **mono or stereo, 44.1 kHz**. Mono is plenty for effects (the game does no stereo panning) and is smaller. Music may be stereo. Constant bitrate, 96 to 128 kbps is fine.
- **Sound effects:** normalise the **peak to about -3 dBFS**. They are short and punchy but must never be harsh.
- **Music:** about **-16 LUFS** integrated. The game plays music at 0.5 gain, effects at 1.0 and the engine at 0.35, so the mix is set in code (`MUSIC_VOLUME`, `SFX_VOLUME`, `ENGINE_VOLUME` in `apps/game/src/audio/audio.ts`). Keep the files themselves consistent and let the code balance them.
- **Cut silence** at the start of effects. Anything with a leading pause feels late. A 5 ms fade-in and a short fade-out avoid clicks.
- **Loops** (`music_lobby`, `music_race`, `engine_loop`) must start and end on the same musical or waveform point so they repeat seamlessly. Encode with LAME (ffmpeg's `libmp3lame` writes the header that keeps loops gapless) and listen to the loop point once in the game.

Handy ffmpeg one-liners (replace the file names):

```bash
# Music: about -16 LUFS, mono 44.1 kHz mp3 (drop "-ac 1" to keep stereo)
ffmpeg -i music_raw.wav -af loudnorm=I=-16:TP=-1.5:LRA=11 -ar 44100 -ac 1 -b:a 128k music_lobby.mp3

# Sound effect: find the peak, then lift or lower it so the peak sits at -3 dB
ffmpeg -i sfx_raw.wav -af volumedetect -f null - 2>&1 | grep max_volume
ffmpeg -i sfx_raw.wav -af volume=<+/-dB> -ar 44100 -ac 1 -b:a 128k boost.mp3
```

## The sound of the game

Everything below belongs to one world: a **cozy toy-box**. Think wooden and felt toys, pastel plastic, a
music box on a warm afternoon.

- **Sources:** ukulele, glockenspiel, xylophone, kalimba, soft marimba, music box, rounded sine and triangle synths, pillowy pops, squeaky-toy chirps, wooden blocks, felt-muffled thuds.
- **Feel:** warm, round, friendly, a little silly. Rounded attacks. High frequencies stay gentle.
- **Avoid in every prompt:** harsh, metallic, distorted, gritty, sharp, shrill, screeching, realistic crashes or gunshots, sirens, scary or aggressive tones, loud transients, long reverb tails, vocals or spoken words.
- **Good prompt habit:** end each prompt with "soft, rounded, toy-like, warm, no harsh high frequencies, no distortion".
- Several sounds can fire in a busy race (six karts, bots included), so keep effects short and clean with a quick decay.

## At a glance

| File | Type | Length | Heard when |
|---|---|---|---|
| `music_lobby.mp3` | loop | 30 to 60 s | lobby and results |
| `music_race.mp3` | loop | 60 to 90 s | countdown and racing |
| `engine_loop.mp3` | loop | 1 to 2 s | whole race, pitch follows speed |
| `countdown_beep.mp3` | one-shot | 0.3 s | 3, 2, 1 |
| `countdown_go.mp3` | one-shot | 0.6 s | GO |
| `item_box_pickup.mp3` | one-shot | 0.4 s | kart drives through an item box |
| `item_roulette.mp3` | one-shot | 1.0 s | item roll (lasts 1 s) |
| `boost.mp3` | one-shot | 0.8 s | boost used |
| `shield_up.mp3` | one-shot | 0.6 s | shield used |
| `shield_break.mp3` | one-shot | 0.4 s | shield absorbs a hit |
| `mine_drop.mp3` | one-shot | 0.3 s | mine dropped |
| `mine_explode.mp3` | one-shot | 0.7 s | kart touches a mine |
| `rocket_fire.mp3` | one-shot | 0.5 s | rocket launched |
| `rocket_explode.mp3` | one-shot | 0.7 s | rocket hits a kart or wall |
| `kart_spinout.mp3` | one-shot | 1.0 s | kart is hit and spins |
| `wall_bump.mp3` | one-shot | 0.25 s | kart hits a wall |
| `kart_bump.mp3` | one-shot | 0.25 s | two karts bump |
| `lap_complete.mp3` | one-shot | 0.6 s | one of your laps done |
| `final_lap.mp3` | one-shot | 1.2 s | you start the last lap |
| `race_finish.mp3` | one-shot | 1.8 s | you cross the finish line |
| `player_join.mp3` | one-shot | 0.6 s | a phone joins the lobby |

---

## music_lobby.mp3

- **File:** `music_lobby.mp3`
- **Type:** loop (seamless)
- **Target duration:** 30 to 60 s
- **Mood:** cozy, upbeat, welcoming, "everyone gather round the couch". Plays quietly under the lobby QR code and the results board, so it must be calm enough to talk over.
- **Generation prompt:**
  > Cozy upbeat chiptune-meets-acoustic lobby loop for a family kart game. Plucked ukulele strumming, glockenspiel melody, soft marimba and a gentle rounded bass, light shaker and soft kick, 100 BPM, major key, warm and friendly, toy-box atmosphere. Seamless loop, 30 to 60 seconds, instrumental only, steady energy with no big build or drop. Soft, rounded, warm, no harsh high frequencies, no distortion, no vocals.
- **Avoid:** loud drums, a long intro or ending, lead synths that cut through speech, any fade-out at the end (it must loop).

## music_race.mp3

- **File:** `music_race.mp3`
- **Type:** loop (seamless)
- **Target duration:** 60 to 90 s
- **Mood:** bouncy, playful and fast, a little cheeky. It drives the whole race (about two to three minutes), so it must not tire the ear.
- **Generation prompt:**
  > Bouncy driving race loop for a cute toy kart game, 140 BPM. Playful rounded synth bass, bright plucked synths and kalimba, glockenspiel accents, light snappy drums with soft claps and a shaker, cheerful major-key melody that repeats nicely. Seamless loop, 60 to 90 seconds, instrumental only, energetic but friendly. Soft, rounded, toy-like, warm, no harsh high frequencies, no distortion, no vocals.
- **Avoid:** aggressive EDM or rock, heavy sub-bass, siren-like leads, a quiet intro (it should be at full energy at the loop point).

## engine_loop.mp3

- **File:** `engine_loop.mp3`
- **Type:** loop (seamless)
- **Target duration:** 1 to 2 s
- **Mood:** a tiny wind-up toy motor, purring and friendly. Quiet background texture, not the star.
- **Important:** record it at a **neutral pitch, steady and unvarying in loudness**. The game shifts the pitch live by changing the playback rate: 0.8x standing still, about 1.4x at top speed and up to about 1.7x during a boost, so a clear, stable tone works best.
- **Generation prompt:**
  > A gentle toy-motor hum, seamless 1 to 2 second loop. Soft rounded low buzz like a small wind-up or battery toy car, steady pitch and steady volume, slightly warm and fuzzy, with a faint rhythmic purr. Mono, no gear changes, no revving, no pops. Soft, rounded, warm, no harsh high frequencies, no distortion.
- **Avoid:** realistic car or motorbike engines, whining turbines, growls, a changing pitch or volume, silence at the loop edges.

## countdown_beep.mp3

- **File:** `countdown_beep.mp3`
- **Type:** one-shot (plays three times: 3, 2, 1)
- **Target duration:** 0.3 s
- **Mood:** clear, friendly "get ready" tick.
- **Generation prompt:**
  > A single short friendly countdown beep: one soft rounded marimba or sine-wave note at a medium pitch (about E5), quick attack, 0.3 second decay, clean and bubbly like a toy. No reverb tail. Soft, rounded, toy-like, warm, no harsh high frequencies, no distortion.
- **Avoid:** a harsh digital beep, an alarm tone, a long ring-out.

## countdown_go.mp3

- **File:** `countdown_go.mp3`
- **Type:** one-shot
- **Target duration:** 0.6 s
- **Mood:** the happy release: "GO!". Same instrument family as the beep, but higher and brighter, so the two clearly differ.
- **Generation prompt:**
  > A cheerful "go" signal: the same soft marimba and glockenspiel sound as a countdown beep but one octave higher (about E6), played as a quick two-note rising chirp, then a small sparkly shimmer. 0.6 seconds, bright but gentle. Soft, rounded, toy-like, warm, no harsh high frequencies, no distortion.
- **Avoid:** a starting pistol, an air horn, a long fanfare.

## item_box_pickup.mp3

- **File:** `item_box_pickup.mp3`
- **Type:** one-shot
- **Target duration:** 0.4 s
- **Mood:** a pleasing little reward, like popping a bubble full of sparkles.
- **Generation prompt:**
  > A short sparkly pickup sound: a soft bubble pop followed by two quick rising glockenspiel notes, 0.4 seconds, delightful and light, like collecting a candy. Soft, rounded, toy-like, warm, no harsh high frequencies, no distortion.
- **Avoid:** coin-clink metallic sounds, arcade zaps, long shimmer tails.

## item_roulette.mp3

- **File:** `item_roulette.mp3`
- **Type:** one-shot (starts when the roll starts and should finish with the 1 s roll)
- **Target duration:** 1.0 s
- **Mood:** suspenseful but silly, like a slot machine made of wooden blocks. Ends on a small "ta-da" so the item reveal feels settled.
- **Generation prompt:**
  > A one second item-roulette sound: a rapid series of soft rounded ticks and xylophone notes, quickly stepping upward in pitch like a spinning wheel that slows down, ending with one warm bell note. Playful and light, exactly 1 second. Soft, rounded, toy-like, warm, no harsh high frequencies, no distortion.
- **Avoid:** a casino jackpot, loud mechanical ratcheting, long bell ring-out.

## boost.mp3

- **File:** `boost.mp3`
- **Type:** one-shot
- **Target duration:** 0.8 s
- **Mood:** a happy burst of speed, a gentle "whoosh" with a spring in it.
- **Generation prompt:**
  > A cute speed-boost sound: a soft airy whoosh sweeping upward with a springy "boing" and a quick rising slide whistle, 0.8 seconds, energetic and friendly, like a toy rocket skate. Soft, rounded, toy-like, warm, no harsh high frequencies, no distortion.
- **Avoid:** a jet engine, turbo hiss, sharp white-noise blasts.

## shield_up.mp3

- **File:** `shield_up.mp3`
- **Type:** one-shot
- **Target duration:** 0.6 s
- **Mood:** a protective bubble inflating, safe and magical.
- **Generation prompt:**
  > A soft shield-activate sound: a gentle rising bubble swell with a warm chime and a faint glassy sparkle, like a soap bubble forming around a toy, 0.6 seconds. Soft, rounded, toy-like, warm, no harsh high frequencies, no distortion.
- **Avoid:** sci-fi force-field hum, metallic ring, electrical buzz.

## shield_break.mp3

- **File:** `shield_break.mp3`
- **Type:** one-shot
- **Target duration:** 0.4 s
- **Mood:** the bubble pops, a cartoonish "pop-pshh" that is clearly not as bad as being hit.
- **Generation prompt:**
  > A soft bubble-pop shield break: a single round pop followed by a tiny downward glassy sprinkle, 0.4 seconds, light and cartoonish. Soft, rounded, toy-like, warm, no harsh high frequencies, no distortion.
- **Avoid:** shattering glass, loud cracks, anything that sounds like damage.

## mine_drop.mp3

- **File:** `mine_drop.mp3`
- **Type:** one-shot
- **Target duration:** 0.3 s
- **Mood:** a small, sneaky "plop", placing a toy on the track.
- **Generation prompt:**
  > A short soft plop of a small rubber toy being set down: one muted wooden-block tap with a tiny low squeak, 0.3 seconds, cute and slightly mischievous. Soft, rounded, toy-like, warm, no harsh high frequencies, no distortion.
- **Avoid:** metallic clunks, beeping, alarm tones.

## mine_explode.mp3

- **File:** `mine_explode.mp3`
- **Type:** one-shot
- **Target duration:** 0.7 s
- **Mood:** a silly cartoon "poof", funny, not frightening. Pairs with `kart_spinout`.
- **Generation prompt:**
  > A cartoon toy explosion: a round soft "poof" with a low felt-muffled thump and a little burst of confetti-like sparkles, 0.7 seconds, comedic and gentle. Soft, rounded, toy-like, warm, no harsh high frequencies, no distortion.
- **Avoid:** a realistic bomb or blast, deep rumbling sub-bass, sharp crackle, debris sounds.

## rocket_fire.mp3

- **File:** `rocket_fire.mp3`
- **Type:** one-shot
- **Target duration:** 0.5 s
- **Mood:** a playful launch, a little firework "fwoop".
- **Generation prompt:**
  > A toy rocket launch: a soft rounded "fwoop" whoosh that rises quickly in pitch, with a springy pop at the start and a bit of airy sparkle trail, 0.5 seconds, cheerful and light. Soft, rounded, toy-like, warm, no harsh high frequencies, no distortion.
- **Avoid:** missile or gunshot sounds, roaring jet noise, hissing white noise.

## rocket_explode.mp3

- **File:** `rocket_explode.mp3`
- **Type:** one-shot
- **Target duration:** 0.7 s
- **Mood:** a firework-like pop, a touch bigger and sparklier than the mine but just as funny.
- **Generation prompt:**
  > A cartoon rocket hit: a round soft "boom-pop" like a party popper, followed by a quick shower of glittery sparkles falling in pitch, 0.7 seconds, playful rather than violent. Soft, rounded, toy-like, warm, no harsh high frequencies, no distortion.
- **Avoid:** realistic explosions, loud crashes, long rumble, debris.

## kart_spinout.mp3

- **File:** `kart_spinout.mp3`
- **Type:** one-shot
- **Target duration:** 1.0 s (the spin lasts 1.2 s)
- **Mood:** a wobbly, dizzy, comedic spin. The player should smile, not feel punished.
- **Generation prompt:**
  > A dizzy toy-car spin-out: a wobbly descending slide whistle combined with a soft rubbery squeal turning in circles, then a gentle "boing" at the end, 1 second, comedic and light. Soft, rounded, toy-like, warm, no harsh high frequencies, no distortion.
- **Avoid:** tire screech, skidding rubber, a crash or any realistic car sound.

## wall_bump.mp3

- **File:** `wall_bump.mp3`
- **Type:** one-shot (limited to once per 0.3 s per kart; may fire often)
- **Target duration:** 0.25 s
- **Mood:** a soft cushion bump: you bounced off a padded wall.
- **Generation prompt:**
  > A very short soft bump: a muffled felt-cushion thud with a tiny rubbery "boing", 0.25 seconds, quiet and friendly. Soft, rounded, toy-like, warm, no harsh high frequencies, no distortion.
- **Avoid:** crashes, scrapes, metal clanks, long tails. It must stay pleasant when heard many times.

## kart_bump.mp3

- **File:** `kart_bump.mp3`
- **Type:** one-shot (limited to once per 0.3 s per kart; may fire often)
- **Target duration:** 0.25 s
- **Mood:** two toy karts nudging each other, a little "bonk" that sounds different from the wall bump.
- **Generation prompt:**
  > A very short toy bump: a light wooden-block "bonk" with a small squeaky-toy chirp on top, 0.25 seconds, higher and brighter than a wall thud, cute and gentle. Soft, rounded, toy-like, warm, no harsh high frequencies, no distortion.
- **Avoid:** car-crash sounds, plastic cracking, metallic clunks.

## lap_complete.mp3

- **File:** `lap_complete.mp3`
- **Type:** one-shot
- **Target duration:** 0.6 s
- **Mood:** a quick, happy "checkpoint" chime, positive but low-key (it plays at the end of lap 1 and 2).
- **Generation prompt:**
  > A short friendly lap-complete chime: two ascending soft glockenspiel and marimba notes (a rising third), warm and bright, 0.6 seconds, with a gentle sparkle at the end. Soft, rounded, toy-like, warm, no harsh high frequencies, no distortion.
- **Avoid:** a big fanfare (save that for the finish), a bell that rings for seconds, harsh high bells.

## final_lap.mp3

- **File:** `final_lap.mp3`
- **Type:** one-shot
- **Target duration:** 1.2 s
- **Mood:** excitement rising: "last lap, here we go!". More energy than the lap chime, still cute. Replaces the lap chime when lap 3 starts.
- **Generation prompt:**
  > An exciting "final lap" jingle: a quick rising four-note xylophone and glockenspiel run with a bouncy ukulele strum and a cheerful sparkle on the last note, 1.2 seconds, building energy and ending on a bright major chord. Soft, rounded, toy-like, warm, no harsh high frequencies, no distortion.
- **Avoid:** brass fanfares, sirens, rock guitar, alarm-like repeated beeps.

## race_finish.mp3

- **File:** `race_finish.mp3`
- **Type:** one-shot
- **Target duration:** 1.8 s
- **Mood:** joyful celebration when you cross the line, like a party. The biggest effect in the set, but still toy-like.
- **Generation prompt:**
  > A cheerful race-finish jingle: a short triumphant melody on glockenspiel, ukulele strums and marimba, ending on a long bright major chord with a confetti party-popper pop and a twinkling sparkle tail, 1.8 seconds, happy and warm. Soft, rounded, toy-like, warm, no harsh high frequencies, no distortion.
- **Avoid:** cheering crowds, vocals, orchestral brass, a loud final hit.

## player_join.mp3

- **File:** `player_join.mp3`
- **Type:** one-shot
- **Target duration:** 0.6 s
- **Mood:** a warm "hello!", someone just sat down on the couch. Plays in the lobby over the music, so it should be clear but gentle.
- **Generation prompt:**
  > A friendly player-joined sound: a cheerful two-note "pa-ping" on a soft kalimba or music box, the second note higher, with a tiny happy squeak of a toy, 0.6 seconds, welcoming and light. Soft, rounded, toy-like, warm, no harsh high frequencies, no distortion.
- **Avoid:** system-notification dings, phone ringtones, harsh pings.
