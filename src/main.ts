import './style.css';
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
} from './core/tiles';

import { Peer, type DataConnection} from 'peerjs';
import { saveResult, topResults } from './core/db';

type Screen = 'home' | 'lobby' | 'mapper' | 'explorer' | 'result';
type Mark = 'explorer' | 'warning' | 'exit';

const MARK_IMG: Record<Mark, string> = {
  explorer: 'marks/explorer.png',
  warning: 'marks/warning.png',
  exit: 'marks/exit.png',
};

const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

type msg = 
| { t: 'init', role: 'mapper' | 'explorer', maze: Labirynth } 
| { t: 'rotation', i: number, rotation: number }
| { t: 'player-join', nick: string }
| { t: 'vote', level: string }
| { t: 'end', result: 'win' | 'trap' };

const ID_PREFIX = 'findaway-';

const KEYS_STORE = 'findaway-keys';
const DEFAULT_KEYS: Record<Dir, string> = { N: 'w', NE: 'e', E: 'd', SE: 'c', S: 's', SW: 'z', W: 'a', NW: 'q' };

const loadKeys = (): Record<Dir, string> => {
  try {
    return { ...DEFAULT_KEYS, ...JSON.parse(localStorage.getItem(KEYS_STORE) ?? '{}') };
  } catch {
    return { ...DEFAULT_KEYS };
  }
};

const saveKeys = (keys: Record<Dir, string>) => {
  try {
    localStorage.setItem(KEYS_STORE, JSON.stringify(keys));
  } catch {}
};

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
  secondPlayerNick?: string;

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

// Klasa NetService
export class NetService {
  onMessage: (msg: msg) => void = () => {};
  onClose: () => void = () => {};
  onError: (err: any) => void = () => {};

  private peer?: Peer;
  private conn?: DataConnection;

  get connected() { return !!this.conn?.open; }

  host(onCode: (code: string) => void, onGuest: () => void) {
    this.close();
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
    const peer = (this.peer = new Peer(ID_PREFIX + code));
    peer.on('open', () => onCode(code)); 
    peer.on('connection', (c) => {      
      if (this.conn) return c.close();   
      this.attach(c);
      c.on('open', onGuest);             
    });
    peer.on('error', (e) => (e.type === 'unavailable-id' ? this.host(onCode, onGuest) : this.onError(e.type)));
  }

  join(code: string, onOpen: () => void) {
    this.close();
    const peer = (this.peer = new Peer());
    peer.on('open', () => {
      const c = peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' });
      this.attach(c);
      c.on('open', onOpen);
    });
    peer.on('error', (e) => this.onError(e.type)); 
  }
 
  private attach(c: DataConnection) {
    this.conn = c;
    c.on('data', (d) => this.onMessage(d as msg));
    c.on('close', () => {
      if (this.conn === c) { this.conn = undefined; this.onClose(); }
    });
  }
 
  send(m: msg) { if (this.conn?.open) this.conn.send(m); }
 
  close() {
    this.conn = undefined;
    this.peer?.destroy();
    this.peer = undefined;
  }
}

// Klasa GameView
export class GameView {
  static renderTile(t: Tile, mark?: Mark, ext = false): HTMLElement {
    const container = document.createElement('div');
    container.className = 'tile';

    const img = document.createElement('img');
    img.src = asset(`${ext ? 'tiles_ext' : 'tiles'}/${t.type}${ext ? '_EXT' : ''}.png`);
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

  static label(text: string): HTMLElement {
    const d = document.createElement('div');
    d.className = 'label';
    d.textContent = text;
    return d;
  }

  static mount(el: HTMLElement, N: number) {
    let wrap = el.parentElement!;
    if (!wrap.classList.contains('board-wrap')) {
      wrap = document.createElement('div');
      wrap.className = 'board-wrap';
      const cols = document.createElement('div');
      cols.className = 'cols';
      const rows = document.createElement('div');
      rows.className = 'rows';
      el.replaceWith(wrap);
      wrap.append(document.createElement('div'), cols, rows, el);
    }
    if (wrap.dataset.n === String(N)) return;
    wrap.dataset.n = String(N);
    wrap.style.setProperty('--n', String(N));
    wrap.querySelector('.cols')!.replaceChildren(...Array.from({ length: N }, (_, c) => GameView.label(String(c + 1))));
    wrap.querySelector('.rows')!.replaceChildren(...Array.from({ length: N }, (_, r) => GameView.label(String.fromCharCode(65 + r))));
  }

  static renderMapper(state: GameState, containerSel: string) {
    const el = document.querySelector<HTMLElement>(containerSel)!;
    const N = state.maze.size;
    el.style.setProperty('--n', String(N));
    GameView.mount(el, N);
    el.replaceChildren(
      ...state.maze.tiles.map((t, i) => {
        const isExit = i === state.maze.exitPos.y * N + state.maze.exitPos.x;
        const c = GameView.renderTile(t, isExit ? 'exit' : undefined, state.maze.ext);
        c.dataset.i = String(i);
        return c;
      })
    );
  }

  static renderExplorer(state: GameState, containerSel: string) {
    const el = document.querySelector<HTMLElement>(containerSel)!;
    const N = state.maze.size;
    el.style.setProperty('--n', String(N));
    GameView.mount(el, N);
    el.replaceChildren(
      ...state.maze.tiles.map((t, i) => {
        const x = i % N, y = Math.floor(i / N);
        const dx = Math.abs(x - state.explorerPos.x), dy = Math.abs(y - state.explorerPos.y);
        const dist = state.maze.ext ? Math.max(dx, dy) : dx + dy;
        let mark: Mark | undefined;
        if (dist === 0) mark = 'explorer';
        else if (dist === 1 && t.trap) mark = 'warning';
        else if (dist === 1 && x === state.maze.exitPos.x && y === state.maze.exitPos.y) mark = 'exit';
        
        const c = GameView.renderTile(t, mark, state.maze.ext);
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
  isHost = false;
  assignedRole: 'mapper' | 'explorer' = 'explorer';
  guestVote?: string;
  lastMs = 0;
  keys: Record<Dir, string> = loadKeys();
  capturing: Dir | null = null;
  drawKeys = () => {};

  constructor() {
    this.initNetListeners();
    this.initListeners();
    this.initKeyMap();
    this.show('home');
  }

  show(name: Screen) {
   this.currentScreen = name;

    document.querySelectorAll<HTMLElement>('.screen').forEach((s) => (s.hidden = s.dataset.screen !== name));

    if (name !== 'explorer' && name !== 'mapper') {
      if (this.state?.timerId) clearInterval(this.state.timerId);
    }

    document.getElementById('keys-btn')!.hidden = name !== 'explorer';
    if (name !== 'explorer') {
      document.getElementById('keys-panel')!.hidden = true;
      this.capturing = null;
    }

    if (name === 'lobby') {
      document.getElementById('role-set')!.hidden = !this.isHost;
      this.updateLobbyStatus();
    }

    if (name === 'mapper') {
      if (!this.state) this.startNewGame();
      GameView.renderMapper(this.state, '#board-mapper');
      this.startTimer('#timer1');
    }

    if (name === 'explorer') {
      if (!this.state) this.startNewGame();
      GameView.renderExplorer(this.state, '#board-explorer');
      document.querySelectorAll<HTMLElement>('.diag').forEach((b) => (b.hidden = !this.state.maze.ext));
      this.startTimer('#timer2');
    }
  }

  updateLobbyStatus() {
    const connected = this.net.connected;

    const statusEl = document.getElementById('lobby-status');
    if (statusEl) {
      statusEl.textContent = !this.isHost || connected
        ? 'Second player connected to lobby.'
        : 'Waiting for other player...';
    }

    document.getElementById('start')!.hidden = !(this.isHost && connected);
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

  async save() {
      if (!this.isHost) return;
      const nick1 = document.querySelector<HTMLInputElement>('#nick')!.value.trim();
      if (!nick1) return;

      const nick2 = this.state.secondPlayerNick || 'Guest'; 

      const box = document.getElementById('save-box')!;
      box.hidden = true;

      const ok = await saveResult({ nick1, nick2, completion_time: this.lastMs}, this.state.maze.size);
      if (!ok) {
        alert('Nie udało się zapisać wyniku.');
        box.hidden = false;
        return;
      }
      this.loadTop();
  }

  finish(result: 'win' | 'trap', notifyNetwork = true) {
    if (this.state?.timerId) clearInterval(this.state.timerId);
    
    if (notifyNetwork && this.net.connected) {
      this.net.send({ t: 'end', result });
    }

    const titleEl = document.getElementById('result-title');
    const textEl = document.getElementById('result-text');
    const timeEl = document.getElementById('result-time');
    
    if (titleEl) titleEl.textContent = result === 'win' ? 'Exit found' : 'Trap';
    if (textEl) textEl.textContent = result === 'win' ? 'Successfully escaped the maze.' : 'The explorer fell into a trap.';
    if (timeEl) timeEl.textContent = this.formatTime(this.state.elapsedTime());
    
    this.lastMs = this.state.elapsedTime();
    if(result==='win') this.save();
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

  private initNetListeners() {
    this.net.onMessage = (m) => this.handleNetworkMessage(m);
    this.net.onClose = () => {
      alert('Połączenie zostało zerwane.');
      this.show('home');
    };
    this.net.onError = (err) => {
      alert(`Błąd połączenia: ${err}`);
    };
  }

  private handleNetworkMessage(m: msg) {
    switch (m.t) {
      case 'init':
        this.assignedRole = m.role;
        this.state = new GameState(m.maze.size, Labirynth.fromData(m.maze));
        this.state.t0 = Date.now();
        this.show(this.assignedRole);
        break;

      case 'rotation':
        this.state.maze.tiles[m.i].rotate(m.rotation);
        if (this.currentScreen === 'explorer') {
          GameView.renderExplorer(this.state, '#board-explorer');
        }
        break;

      case 'player-join':
        // Host odbiera nick drugiego gracza
        this.state.secondPlayerNick = m.nick;
        this.updateLobbyStatus();
        break;
      
      case 'vote':
        this.guestVote = m.level;
        break;

      case 'end':
        this.finish(m.result, false);
        break;
    }
  }

  async loadTop() {
    const level = this.state.maze.size;
    document.getElementById('top-title')!.textContent = `Top 10 (${level}x${level})`;
    const rows = await topResults(level);
    document.getElementById('top')!.replaceChildren(
      ...rows.map((r) => {
        const li = document.createElement('li');
        li.textContent = `${r.nick1} & ${r.nick2} ${this.formatTime(r.completion_time)}`;
        return li;
      }),
    );
  }

  sendVote() {
    const level = document.querySelector<HTMLInputElement>('input[name="level"]:checked')?.value ?? '5';
    this.net.send({ t: 'vote', level });
  }

  startNewGame() {
    if (!this.isHost) return;

    const roleInput = document.querySelector<HTMLInputElement>('input[name="role"]:checked')?.value;
    const hostRole = roleInput === 'random' || !roleInput 
      ? (Math.random() < 0.5 ? 'mapper' : 'explorer') 
      : (roleInput as 'mapper' | 'explorer');
    
    this.assignedRole = hostRole;
    const guestRole: 'mapper' | 'explorer' = hostRole === 'mapper' ? 'explorer' : 'mapper';

    const hostVote = document.querySelector<HTMLInputElement>('input[name="level"]:checked')?.value ?? '5';
    const votes = [hostVote, this.guestVote ?? hostVote];
    this.settings.difficulty = votes[Math.floor(Math.random() * votes.length)];

    const size = this.settings.getMazeSize();
    this.state = new GameState(size);
    this.state.t0 = Date.now();

    this.net.send({ t: 'init', role: guestRole, maze: this.state.maze });

    this.show(this.assignedRole);
  }

  bindKey(d: Dir, key: string) {
    const other = (Object.keys(this.keys) as Dir[]).find((o) => this.keys[o] === key);
    if (other) this.keys[other] = this.keys[d];
    this.keys[d] = key;
    saveKeys(this.keys);
  }

  initKeyMap() {
    const btn = document.createElement('button');
    btn.id = 'keys-btn';
    btn.textContent = 'Klawisze';
    const panel = document.createElement('div');
    panel.id = 'keys-panel';
    panel.hidden = true;
    document.body.append(btn, panel);

    const arrows: Record<Dir, string> = { N:'Up', NE: 'Up Right', E: 'Right', SE: 'Down Right', S: 'Down', SW: 'Down Left', W: 'Left', NW: 'Up Left' };
    const fmt = (k: string) => (k === ' ' ? 'SPACJA' : k.toUpperCase());

    this.drawKeys = () => {
      const rows = (Object.keys(arrows) as Dir[]).map((d) => {
        const row = document.createElement('div');
        row.className = 'keys-row';
        const name = document.createElement('span');
        name.textContent = arrows[d];
        const b = document.createElement('button');
        b.textContent = this.capturing === d ? '…' : fmt(this.keys[d]);
        b.onclick = () => {
          this.capturing = d;
          this.drawKeys();
        };
        row.append(name, b);
        return row;
      });
      const reset = document.createElement('button');
      reset.textContent = 'Domyślne';
      reset.onclick = () => {
        this.keys = { ...DEFAULT_KEYS };
        this.capturing = null;
        saveKeys(this.keys);
        this.drawKeys();
      };
      const title = document.createElement('div');
      title.textContent = 'Klawisze ruchu';
      const close = document.createElement('button');
      close.textContent = 'Zamknij';
      close.onclick = () => {
        panel.hidden = true;
        this.capturing = null;
      };
      panel.replaceChildren(title, ...rows, reset, close);
    };

    btn.onclick = () => {
      panel.hidden = !panel.hidden;
      this.capturing = null;
      this.drawKeys();
    };
  }

  initListeners() {

    const codeEl = document.getElementById('lobby-code')!;
    document.getElementById('create')?.addEventListener('click', (e) => {
      e.preventDefault();
      const nick1 = document.querySelector<HTMLInputElement>('#nick')!.value.trim();
      if (!nick1) {
        alert('You need a nickname!');
        return;
      }

      this.isHost = true;
      this.guestVote = undefined;
      codeEl.textContent = '…';
      this.net.host(
        (code) => (codeEl.textContent = code),
        () => {
          this.guestVote = undefined;
          this.show('lobby');
          this.updateLobbyStatus();
        },
      );
      this.show('lobby');
    });

document.getElementById('join')?.addEventListener('click', (e) => {
      e.preventDefault();
      const code = document.querySelector<HTMLInputElement>('#code')!.value.trim().toUpperCase();
      const nickVal = document.querySelector<HTMLInputElement>('#nick')!.value.trim(); // Pobieramy nick z pola
      
      if (!code || !nickVal) {
        alert('Write a valid code and nickname!');
        return;
      }
      
      this.isHost = false;
      this.net.join(code, () => {
        codeEl.textContent = code;
        this.show('lobby');
        this.sendVote();
        
        this.net.send({ t: 'player-join', nick: nickVal });
      });
    });

    document.querySelectorAll<HTMLInputElement>('input[name="level"]').forEach((r) =>
      r.addEventListener('change', () => {
        if (!this.isHost) this.sendVote();
      }),
    );

    document.getElementById('start')?.addEventListener('click', () => this.startNewGame());

    document.getElementById('board-mapper')?.addEventListener('click', (e) => {
      if (this.assignedRole !== 'mapper') return;
      const tile = (e.target as HTMLElement).closest<HTMLElement>('.tile');
      if (!tile) return;
      const r = tile.getBoundingClientRect();
      const turn = e.clientX < r.left + r.width / 2 ? -90 : 90;
      const idx = Number(tile.dataset.i);
      
      const t = this.state.maze.tiles[idx];
      t.rotate(turn);
      GameView.renderMapper(this.state, '#board-mapper');

      this.net.send({ t: 'rotation', i: idx, rotation: turn });
    });

    document.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      const go = el.closest<HTMLElement>('[data-go]');
      if (go) this.show(go.dataset.go as Screen);
      const mv = el.closest<HTMLElement>('[data-move]');
      if (mv) this.move(mv.dataset.move as Dir);
    });

    document.addEventListener('keydown', (e) => {
      if (this.capturing) {
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
        e.preventDefault();
        if (e.key !== 'Escape') this.bindKey(this.capturing, e.key.toLowerCase());
        this.capturing = null;
        this.drawKeys();
        return;
      }
      if (!document.getElementById('keys-panel')!.hidden) return;
      if (this.currentScreen !== 'explorer' || this.assignedRole !== 'explorer') return;
      const arrows: Record<string, Dir> = { ArrowUp: 'N', ArrowRight: 'E', ArrowDown: 'S', ArrowLeft: 'W' };
      const key = e.key.toLowerCase();
      const d = arrows[e.key] ?? (Object.keys(this.keys) as Dir[]).find((k) => this.keys[k] === key);
      if (d) {
        e.preventDefault();
        this.move(d);
      }
    });
  }
}

new GameSession();