import {
  DELTA_EXT as DELTA,
  OPPOSITE_EXT as OPPOSITE,
  TILE_DEFS,
  TILE_EXT_DEFS,
  openings,
  openings_EXT,
  type DirExt as Dir,
  type TileType,
  type TileTypeExt,
} from './tiles';

// Klasa Position
export class Position {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

// Klasa Tile
export class Tile {

  type: TileType | TileTypeExt;
  rotation: number;
  trap: boolean; 

  constructor(type: TileType | TileTypeExt, rotation: number = 0, trap: boolean = false) {
    this.type = type;
    this.rotation = rotation;
    this.trap = trap;
  }

  rotate(turn: number) {
    this.rotation = (this.rotation + turn + 360) % 360;
  }

  getOpenings(): Dir[] {
    return this.type in TILE_DEFS
      ? openings(this.type as TileType, this.rotation)
      : openings_EXT(this.type as TileTypeExt, this.rotation);
  }
}

// Klasa Labirynth 
export class Labirynth {
  tiles: Tile[] = [];
  startPos: Position;
  exitPos: Position;
  size: number;

  constructor(size: number) {
    this.startPos = new Position(0, 0);
    this.exitPos = new Position(0, 0);
    this.size = size
  }

  get ext(): boolean {
    return this.size === 11;
  }

  at(x: number, y: number): Tile {
    return this.tiles[y * this.size + x];
  }

  static fromData(d: Labirynth): Labirynth {
    const m = new Labirynth(d.size);
    m.startPos = new Position(d.startPos.x, d.startPos.y);
    m.exitPos = new Position(d.exitPos.x, d.exitPos.y);
    m.tiles = d.tiles.map((t) => new Tile(t.type, t.rotation, t.trap));
    return m;
  }

  canPass(fromPos: Position, toPos: Position, dir: Dir): boolean {
    if (toPos.x < 0 || toPos.y < 0 || toPos.x >= this.size || toPos.y >= this.size) return false;
    const fromTile = this.at(fromPos.x, fromPos.y);
    const toTile = this.at(toPos.x, toPos.y);
    if (!fromTile.getOpenings().includes(dir)) return false;
    if (!toTile.getOpenings().includes(OPPOSITE[dir])) return false;
    return true;
  }
}

// Klasa LabirynthGenerator
export class LabirynthGenerator {
  static generate(size: number): Labirynth {
    const maze = new Labirynth(size);
    const types = Object.keys(maze.ext ? TILE_EXT_DEFS : TILE_DEFS) as (TileType | TileTypeExt)[];
    const rnd = (n: number) => Math.floor(Math.random() * n);
    do{
      maze.startPos = new Position(rnd(size), rnd(size));
      maze.exitPos = new Position(rnd(size), rnd(size));
    } while(Math.abs(maze.startPos.x-maze.exitPos.x)+Math.abs(maze.startPos.y-maze.exitPos.y)<1.5*(size-1));
    

    maze.tiles = Array.from({ length: size * size }, () => ({
      type: types[rnd(types.length)],
      rotation: 90 * rnd(4),
      trap: false,
    })).map(t => new Tile(t.type, t.rotation, t.trap));

    const near = (p: Position) => {
      const dx = Math.abs(p.x - maze.exitPos.x), dy = Math.abs(p.y - maze.exitPos.y);
      return maze.ext ? Math.max(dx, dy) === 1 : dx + dy === 1;
    };
    const cells: Position[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 1; x < size - 1; x++) {
        const onStart = x === maze.startPos.x && y === maze.startPos.y;
        const onExit = x === maze.exitPos.x && y === maze.exitPos.y;
        if (!onStart && !onExit) cells.push(new Position(x, y));
      }
    }
    for (let i = cells.length - 1; i > 0; i--) {
      const j = rnd(i + 1);
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const wanted = Math.floor((size * size) / 8);
    let placed = 0, nearExit = 0;
    for (const p of cells) {
      if (placed === wanted) break;
      if (near(p) && nearExit === 3) continue;
      maze.at(p.x, p.y).trap = true;
      placed++;
      if (near(p)) nearExit++;
    }

    maze.at(maze.startPos.x, maze.startPos.y).type = 'cross';
    maze.at(maze.exitPos.x, maze.exitPos.y).type = 'cross';

    return maze;
  }
}

// Klasa GameState
export class GameState {
  maze: Labirynth;
  explorerPos: Position;
  t0: number = 0;
  timerId: number = 0;
  constructor(size: number, maze?: Labirynth) {
    this.maze = maze ?? LabirynthGenerator.generate(size);
    this.explorerPos = new Position(this.maze.startPos.x, this.maze.startPos.y);
  }

  moveExplorer(dir: Dir): 'win' | 'trap' | 'continue' | null {
    const nx = this.explorerPos.x + DELTA[dir][0];
    const ny = this.explorerPos.y + DELTA[dir][1];
    const nextPos = new Position(nx, ny);

    if (!this.maze.canPass(this.explorerPos, nextPos, dir)) return null;

    this.explorerPos = nextPos;
    const targetTile = this.maze.at(nx, ny);

    if (targetTile.trap) return 'trap';
    if (nx === this.maze.exitPos.x && ny === this.maze.exitPos.y) return 'win';
    return 'continue';
  }

  elapsedTime(): number {
    return Date.now() - this.t0;
  }


}

// Klasa LobbySetting
export class LobbySetting {
  role: string;
  difficulty: string;
  randomize: boolean;
  constructor(role: string = 'random',difficulty: string = '5',randomize: boolean = false) {
    this.role = role;
    this.difficulty = difficulty;
    this.randomize = randomize;
  }

  getMazeSize(): number {
    if (this.difficulty === 'random') {
      const levels = [5, 7, 9];
      return levels[Math.floor(Math.random() * levels.length)];
    }
    return Number(this.difficulty ?? 5);
  }
}