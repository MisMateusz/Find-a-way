import './style.css';
import { DELTA, OPPOSITE, TILE_DEFS, openings, type Dir, type TileType } from './core/tiles';

type Screen = 'home' | 'lobby' | 'mapper' | 'explorer' | 'result';
type Mark = 'explorer' | 'warning' | 'exit';

const MARK_IMG: Record<Mark, string> = {
  explorer: 'marks/explorer.png',
  warning: 'marks/warning.png',
  exit: 'marks/exit.png',
};

const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

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

  type: TileType;
  rotation: number;
  trap: boolean; 

  constructor(type: TileType,rotation: number = 0,trap: boolean = false) {
    this.type = type;
    this.rotation = rotation;
    this.trap = trap;
  }

  rotate(turn: number) {
    this.rotation = (this.rotation + turn + 360) % 360;
  }

  getOpenings(): Dir[] {
    return openings(this.type, this.rotation);
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

  at(x: number, y: number): Tile {
    return this.tiles[y * this.size + x];
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
    const types = Object.keys(TILE_DEFS) as TileType[];
    const rnd = (n: number) => Math.floor(Math.random() * n);

    maze.exitPos = new Position(rnd(size), rnd(size));
    maze.startPos = new Position(rnd(size), rnd(size));

    maze.tiles = Array.from({ length: size * size }, () => ({
      type: types[rnd(types.length)],
      rotation: 90 * rnd(4),
      trap: false,
    })).map(t => new Tile(t.type, t.rotation, t.trap));

    for (let k = 0; k < (size * size) / 8; k++) {
      const x = 1 + rnd(size - 2), y = rnd(size);
      maze.at(x, y).trap = true;
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

  constructor(size: number) {
    this.maze = LabirynthGenerator.generate(size);
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

// Klasa NetService
export class NetService {
  createLobby(): string {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
  }
  join(code: string) {}
  send(data: any) {}
  close() {}
}

// Klasa GameView
export class GameView {
  static renderTile(t: Tile, mark?: Mark): HTMLElement {
    const container = document.createElement('div');
    container.className = 'tile';

    const img = document.createElement('img');
    img.src = `tiles/${t.type}.png`;
    img.style.transform = `rotate(${t.rotation}deg)`;
    img.draggable = false;
    container.appendChild(img);

    if (mark) {
      const m = document.createElement('img');
      m.src = asset(MARK_IMG[mark]);
      m.className = `tile-mark ${mark}`;
      m.alt = '';
      m.draggable = false;
      container.appendChild(m);
    }

    return container;
  }

  static renderMapper(state: GameState, containerSel: string) {
    const el = document.querySelector<HTMLElement>(containerSel)!;
    const N = state.maze.size;
    el.style.setProperty('--n', String(N));
    el.replaceChildren(
      ...state.maze.tiles.map((t, i) => {
        const isExit = i === state.maze.exitPos.y * N + state.maze.exitPos.x;
        const c = GameView.renderTile(t, isExit ? 'exit' : undefined);
        c.dataset.i = String(i);
        return c;
      })
    );
  }

  static renderExplorer(state: GameState, containerSel: string) {
    const el = document.querySelector<HTMLElement>(containerSel)!;
    const N = state.maze.size;
    el.style.setProperty('--n', String(N));
    el.replaceChildren(
      ...state.maze.tiles.map((t, i) => {
        const x = i % N, y = Math.floor(i / N);
        const dist = Math.abs(x - state.explorerPos.x) + Math.abs(y - state.explorerPos.y);
        let mark: Mark | undefined;
        if (dist === 0) mark = 'explorer';
        else if (dist === 1 && t.trap) mark = 'warning';
        else if (dist === 1 && x === state.maze.exitPos.x && y === state.maze.exitPos.y) mark = 'exit';
        
        const c = GameView.renderTile(t, mark);
        if (dist > 1) c.classList.add('fog');
        return c;
      })
    );
  }
}

// Klasa GameSession 
export class GameSession {
  settings = new LobbySetting();
  net = new NetService();
  state!: GameState;
  currentScreen: Screen = 'home';

  constructor() {
    this.initListeners();
    this.show('home');
  }

  show(name: Screen) {
    this.currentScreen = name;
    document.querySelectorAll<HTMLElement>('.screen').forEach((s) => (s.hidden = s.dataset.screen !== name));
    
    if (name !== 'explorer' && name !== 'mapper') {
      if (this.state?.timerId) clearInterval(this.state.timerId);
    }

    if (name === 'lobby') {
      const code = this.net.createLobby();
      const lobbyCodeEl = document.getElementById('lobby-code');
      if (lobbyCodeEl) lobbyCodeEl.textContent = code;
    }

    if (name === 'mapper') {
      if (!this.state) this.startNewGame();
      GameView.renderMapper(this.state, '#board-mapper');
      this.startTimer('#timer1');
    }

    if (name === 'explorer') {
      if (!this.state) this.startNewGame();
      GameView.renderExplorer(this.state, '#board-explorer');
      this.startTimer('#timer2');
    }
  }

  startNewGame() {
    const size = this.settings.getMazeSize();
    this.state = new GameState(size);
    this.state.t0 = Date.now();
  }

  startTimer(timerSelector: string) {
    if (this.state.timerId) clearInterval(this.state.timerId);
    this.state.timerId = window.setInterval(() => {
      const timerEl = document.querySelector(timerSelector);
      if (timerEl) {
        timerEl.textContent = this.formatTime(this.state.elapsedTime());
      }
    }, 250);
  }

  formatTime(ms: number): string {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  finish(result: 'win' | 'trap') {
    if (this.state?.timerId) clearInterval(this.state.timerId);
    const titleEl = document.getElementById('result-title');
    const textEl = document.getElementById('result-text');
    const timeEl = document.getElementById('result-time');
    
    if (titleEl) titleEl.textContent = result === 'win' ? 'Wyjście znalezione' : 'Pułapka';
    if (textEl) textEl.textContent = result === 'win' ? 'Udało się wydostać z labiryntu.' : 'Eksplorer wpadł w pułapkę.';
    if (timeEl) timeEl.textContent = this.formatTime(this.state.elapsedTime());
    
    this.show('result');
  }

  move(dir: Dir) {
    const res = this.state.moveExplorer(dir);
    if (!res) return;
    if (res === 'trap' || res === 'win') {
      this.finish(res);
    } else {
      GameView.renderExplorer(this.state, '#board-explorer');
    }
  }

  initListeners() {
    const startButton = document.getElementById('start');
    startButton?.addEventListener('click', () => {
      const levelInput = document.querySelector<HTMLInputElement>('input[name="level"]:checked')?.value ?? '5';
      this.settings.difficulty = levelInput;
      this.startNewGame();

      const roleInput = document.querySelector<HTMLInputElement>('input[name="role"]:checked')?.value;
      if (roleInput === 'mapper') {
        this.show('mapper');
      } else if (roleInput === 'explorer') {
        this.show('explorer');
      } else {
        const role = Math.floor(Math.random() * 2);
        this.show(role === 0 ? 'mapper' : 'explorer');
      }
    });

    document.getElementById('board-mapper')?.addEventListener('click', (e) => {
      const tile = (e.target as HTMLElement).closest<HTMLElement>('.tile');
      if (!tile) return;
      const r = tile.getBoundingClientRect();
      const turn = e.clientX < r.left + r.width / 2 ? -90 : 90;
      const idx = Number(tile.dataset.i);
      const t = this.state.maze.tiles[idx];
      t.rotate(turn);
      GameView.renderMapper(this.state, '#board-mapper');
    });

    document.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      const go = el.closest<HTMLElement>('[data-go]');
      if (go) this.show(go.dataset.go as Screen);
      const mv = el.closest<HTMLElement>('[data-move]');
      if (mv) this.move(mv.dataset.move as Dir);
    });

    document.addEventListener('keydown', (e) => {
      if (this.currentScreen !== 'explorer') return;
      const map: Record<string, Dir> = { ArrowUp: 'N', w: 'N', ArrowRight: 'E', d: 'E', ArrowDown: 'S', s: 'S', ArrowLeft: 'W', a: 'W' };
      const d = map[e.key];
      if (d) {
        e.preventDefault();
        this.move(d);
      }
    });
  }
}

new GameSession();