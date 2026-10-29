/** Every sound the game can play. Files live at `public/audio/<name>.mp3`; see docs/audio-assets.md. */
export const MUSIC = ['music_lobby', 'music_race'] as const;
export const SFX = [
  'countdown_beep',
  'countdown_go',
  'engine_loop',
  'item_box_pickup',
  'item_roulette',
  'boost',
  'shield_up',
  'shield_break',
  'mine_drop',
  'mine_explode',
  'rocket_fire',
  'rocket_explode',
  'kart_spinout',
  'wall_bump',
  'kart_bump',
  'lap_complete',
  'final_lap',
  'race_finish',
  'player_join',
] as const;
export type MusicName = (typeof MUSIC)[number];
export type SoundName = MusicName | (typeof SFX)[number];
export const ALL_SOUNDS: readonly SoundName[] = [...MUSIC, ...SFX];
