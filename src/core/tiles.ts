// Definicje kafelków. To jedyne miejsce, które trzeba zmienić, gdy dodajesz nowy typ.
export type Dir = 'N' | 'E' | 'S' | 'W';
export const DIRS: Dir[] = ['N', 'E', 'S', 'W']; // kolejność zgodna z ruchem wskazówek zegara

// Typy kafelków. Nowy typ: dopisz nazwę tutaj i otwory poniżej (oraz grafikę).
export type TileType = 'straight' | 'corner' | 'tee' | 'cross';

// Otwory kafelka przy obrocie 0°.
export const TILE_DEFS: Record<TileType, Dir[]> = {
  straight: ['W', 'E'],
  corner: ['N', 'E'],
  tee: ['N', 'E', 'S'],
  cross: ['N', 'E', 'S', 'W'],
};

export const OPPOSITE: Record<Dir, Dir> = { N: 'S', E: 'W', S: 'N', W: 'E' };
export const DELTA: Record<Dir, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

/** Otwory kafelka po obrocie (rotation: 0, 90, 180 lub 270 stopni). */
export function openings(type: TileType, rotation: number): Dir[] {
  const steps = (((rotation / 90) % 4) + 4) % 4;
  return TILE_DEFS[type].map((d) => DIRS[(DIRS.indexOf(d) + steps) % 4]);
}
