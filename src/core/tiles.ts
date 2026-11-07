// Definicje kafelków
export type Dir = 'N' | 'E' | 'S' | 'W';
export const DIRS: Dir[] = ['N', 'E', 'S', 'W']; 

export type DirExt = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
export const DIRS_EXT: DirExt[] = ['N' , 'NE' , 'E' , 'SE' , 'S' , 'SW' , 'W' , 'NW']; 

// Typy kafelków
export type TileType = 'straight' | 'corner' | 'tee' | 'cross';
export type TileTypeExt = 'cross' | 'diagonal_cross' | 'diagonal_semi_star' 
| 'diagonal_tee' | 'diagonal_turn' | 'semi_star' 
| 'sharp_tee' | 'sharp_turn_left' | 'sharp_turn_right' 
| 'slight_tee' | 'slight_turn_left' | 'slight_turn_right' 
| 'star' | 'tee' | 'turn';

// Otwory kafelka przy obrocie 0°.
export const TILE_DEFS: Record<TileType, Dir[]> = {
  straight: ['W', 'E'],
  corner: ['N', 'E'],
  tee: ['N', 'E', 'S'],
  cross: ['N', 'E', 'S', 'W'],
};

export const TILE_EXT_DEFS: Record<TileTypeExt, DirExt[]> = {
  cross: ['N', 'E', 'S', 'W'],
  diagonal_cross: ['NE' , 'SE' , 'SW' , 'NW'],
  diagonal_semi_star: ['NW', 'N', 'NE', 'E', 'SE'],
  diagonal_tee: ['NW', 'NE', 'SE'],
  diagonal_turn: ['NE', 'SE'],
  semi_star: ['N', 'NE', 'E', 'SE', 'S'],
  sharp_tee: ['N', 'NE', 'E'],
  sharp_turn_left: ['S', 'SW'],
  sharp_turn_right: ['SE', 'S'],
  slight_tee: ['NE', 'S', 'W'],
  slight_turn_left: ['NW', 'S'],
  slight_turn_right: ['NE', 'S'],
  star: ['N' , 'NE' , 'E' , 'SE' , 'S' , 'SW' , 'W' , 'NW'],
  tee: ['N', 'E', 'S'],
  turn: ['N', 'E']
}

export const OPPOSITE: Record<Dir, Dir> = { N: 'S', E: 'W', S: 'N', W: 'E' };
export const DELTA: Record<Dir, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

export const OPPOSITE_EXT: Record<DirExt, DirExt> = { N: 'S', E: 'W', S: 'N', W: 'E' , NE: 'SW', SE: 'NW', SW: 'NE', NW: 'SE'};
export const DELTA_EXT: Record<DirExt, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0], NE: [1, -1], SE:[1, 1], SW: [-1, 1], NW: [-1, -1] };

// Otwory kafelka po obrocie 
export function openings(type: TileType, rotation: number): Dir[] {
  const steps = (((rotation / 90) % 4) + 4) % 4;
  return TILE_DEFS[type].map((d) => DIRS[(DIRS.indexOf(d) + steps) % 4]);
}

export function openings_EXT(type: TileTypeExt, rotation: number): DirExt[] {
  const steps = (((rotation / 90) % 4) + 4) % 4;
  return TILE_EXT_DEFS[type].map((d) => DIRS_EXT[(DIRS_EXT.indexOf(d) + steps) % 8]);
}
