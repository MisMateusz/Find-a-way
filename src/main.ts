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
import type { RealtimeChannel } from '@supabase/supabase-js';
import { saveResult, topResults, getClient, realtimeAllowed, countRealtimeGame } from './core/db';

type Screen = 'home' | 'lobby' | 'mapper' | 'explorer' | 'result' | 'leaderboard' | 'privacy' | 'settings' | 'howtoplay';
type Mark = 'explorer' | 'warning' | 'exit';

const SUPPORTED_LANGS = ['pl', 'en'] as const;
type Lang = (typeof SUPPORTED_LANGS)[number];

const cache: Partial<Record<Lang, Record<string, unknown>>> = {};
let dict: Record<string, unknown> = {};

const MARK_IMG: Record<Mark, string> = {
  explorer: 'marks/explorer.png',
  warning: 'marks/warning.png',
  exit: 'marks/exit.png',
};

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return null;
  }, obj);
}

function t(key: string, vars: Record<string, string | number> = {}): string {
  const raw = getByPath(dict, key);
  if (typeof raw !== 'string') return key;

  let text = raw;
  for (const [k, v] of Object.entries(vars)) {
    text = text.split(`{${k}}`).join(String(v));
  }
  return text;
}

async function setLanguage(lang: string | null | undefined) {
  const targetLang: Lang = SUPPORTED_LANGS.includes(lang as Lang) ? (lang as Lang) : 'pl';

  try {
    if (!cache[targetLang]) {
     const res = await fetch(`${import.meta.env.BASE_URL}locales/${targetLang}.json`);
      if (!res.ok) throw new Error(`Brak pliku: ${targetLang}.json`);
      cache[targetLang] = (await res.json()) as Record<string, unknown>;
    }

    dict = cache[targetLang]!;
    localStorage.setItem('lang', targetLang);
    document.documentElement.lang = targetLang;

    document.querySelectorAll<HTMLElement>('[data-lang]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.lang === targetLang);
    });

    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
      const key = el.dataset.i18n;
      if (!key) return;
      const val = getByPath(dict, key);
      if (typeof val === 'string') el.textContent = val;
    });

    document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((el) => {
      const key = el.dataset.i18nPlaceholder;
      if (!key) return;
      const val = getByPath(dict, key);
      if (typeof val === 'string') el.placeholder = val;
    });
  } catch (err) {
    console.error(err);
  }
}

const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

type msg = 
| { t: 'init', role: 'mapper' | 'explorer', maze: Labirynth } 
| { t: 'rotation', i: number, rotation: number }
| { t: 'player-join', nick: string }
| { t: 'vote', level: string }
| {t: 'refresh_top'}
| { t: 'end', result: 'win' | 'trap' };

const ID_PREFIX = 'findaway-';
const PEER_TIMEOUT = 10000;
const NO_BACKUP = 'Backup server is unavailable or paused for this month. Try another browser or network, or come back later.';

type RtPacket = { k: 'hello' | 'welcome' | 'data'; gid: string; m?: msg };

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

const CONSENT_STORE = 'findaway-consent';

const loadConsent = (): 'direct' | 'relay' | null => {
  try {
    const v = localStorage.getItem(CONSENT_STORE);
    return v === 'direct' || v === 'relay' ? v : null;
  } catch {
    return null;
  }
};

const saveConsent = (v: 'direct' | 'relay' | null) => {
  try {
    if (v) localStorage.setItem(CONSENT_STORE, v);
    else localStorage.removeItem(CONSENT_STORE);
  } catch {}
};

const KNOWN_TILES = [...Object.keys(TILE_DEFS), ...Object.keys(TILE_EXT_DEFS)];

export function validMessage(m: msg, isHost: boolean, sender: 'mapper' | 'explorer', tileCount: number): boolean {
  switch (m.t) {
    case 'init': {
      const d = m.maze;
      const n = d?.size;
      const inside = (p: Position) => Number.isInteger(p?.x) && Number.isInteger(p?.y) && p.x >= 0 && p.y >= 0 && p.x < n && p.y < n;
      const tileOk = (t: Tile) => KNOWN_TILES.includes(t?.type) && [0, 90, 180, 270].includes(t.rotation);
      return !isHost && [5, 7, 9, 11].includes(n) && Array.isArray(d.tiles) && d.tiles.length === n * n
        && d.tiles.every(tileOk) && inside(d.startPos) && inside(d.exitPos);
    }
    case 'rotation':
      return sender === 'mapper' && Number.isInteger(m.i) && m.i >= 0 && m.i < tileCount && (m.rotation === 90 || m.rotation === -90);
    case 'end':
      return sender === 'explorer' && (m.result === 'win' || m.result === 'trap');
    case 'vote':
      return isHost && ['5', '7', '9', '11', 'random'].includes(m.level);
    case 'player-join':
      return isHost && typeof m.nick === 'string';
    case 'refresh_top':
      return !isHost;
    default:
      return false;
  }
}

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

// Klasa NetService
export class NetService {
  onMessage: (msg: msg) => void = () => {};
  onClose: () => void = () => {};
  onStatus: (text: string, isError?: boolean) => void = () => {};

  private peer?: Peer;
  private conn?: DataConnection;
  private channel?: RealtimeChannel;
  private role: 'host' | 'guest' = 'host';
  private rtOpen = false;
  private gid = '';
  private session = 0;
  private onGuestCb: () => void = () => {};
  private onOpenCb: () => void = () => {};
  relayOnly = false;

  get connected() { return !!this.conn?.open || this.rtOpen; }

  private status(text: string, isError = false) { this.onStatus(text, isError); }

  host(onCode: (code: string) => void, onGuest: () => void) {
    this.close();
    this.role = 'host';
    this.onGuestCb = onGuest;
    const sid = this.session;
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = Array.from({ length: 6 }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
    onCode(code);
    this.status('Creating lobby...');
    if (this.relayOnly) {
      this.listenRealtime(code, sid, true);
      return;
    }

    const peer = (this.peer = new Peer(ID_PREFIX + code));
    let settled = false;
    const settle = (peerOk: boolean) => {
      if (settled || sid !== this.session) return;
      settled = true;
      this.status(peerOk ? '' : t('connection.tryingAnother'));
      this.listenRealtime(code, sid, !peerOk);
    };
    peer.on('open', () => settle(true));
    peer.on('connection', (c) => {
      if (this.connected) return c.close();
      this.attach(c);
      c.on('open', () => {
        this.closeChannel();
        onGuest();
      });
    });
    peer.on('error', (e) => {
      if (sid !== this.session) return;
      if (e.type === 'unavailable-id') return this.host(onCode, onGuest);
      settle(false);
    });
    window.setTimeout(() => settle(false), PEER_TIMEOUT);
  }

  join(code: string, onOpen: () => void) {
    this.close();
    this.role = 'guest';
    this.onOpenCb = onOpen;
    const sid = this.session;
    if (this.relayOnly) {
      this.status('Connecting through the server...');
      this.joinRealtime(code, sid);
      return;
    }
    this.status(t('connection.trying'));

    let fell = false;
    const fallback = () => {
      if (fell || sid !== this.session || this.connected) return;
      fell = true;
      this.closePeer();
      this.status(t('connection.tryingAnother'));
      this.joinRealtime(code, sid);
    };
    window.setTimeout(fallback, PEER_TIMEOUT);

    const peer = (this.peer = new Peer());
    peer.on('open', () => {
      const c = peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' });
      this.attach(c);
      c.on('open', () => {
        if (fell || sid !== this.session) return;
        this.status('');
        onOpen();
      });
      c.on('error', fallback);
    });
    peer.on('error', fallback);
  }

  private async listenRealtime(code: string, sid: number, required: boolean) {
    const allowed = await realtimeAllowed();
    if (sid !== this.session) return;
    if (!allowed) {
      if (required) this.fail(NO_BACKUP);
      return;
    }
    this.subscribe(
      code,
      sid,
      () => { if (required) this.status(''); },
      (why) => { if (required) this.fail(`Could not reach the backup server (${why}).`); },
    );
  }

  private async joinRealtime(code: string, sid: number) {
    const allowed = await realtimeAllowed();
    if (sid !== this.session) return;
    if (!allowed) return this.fail(NO_BACKUP);
    this.gid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    this.subscribe(
      code,
      sid,
      () => {
        let tries = 0;
        const hello = () => {
          if (sid !== this.session || this.rtOpen) return;
          if (tries++ >= 3) return this.fail(t('errors.notFound'));
          this.sendRt({ k: 'hello', gid: this.gid });
          window.setTimeout(hello, 2000);
        };
        hello();
      },
      (why) => this.fail(`Could not reach the backup server (${why}).`),
    );
  }

  private subscribe(code: string, sid: number, onReady: () => void, onFail: (why: string) => void) {
    const ch = getClient().channel(`lobby-${code}`);
    ch.on('broadcast', { event: 'msg' }, ({ payload }) => {
      if (sid === this.session) this.onPacket(payload as RtPacket);
    }).subscribe((status) => {
      if (sid !== this.session) return;
      if (status === 'SUBSCRIBED') onReady();
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onFail(status);
      else if (status === 'CLOSED' && this.rtOpen) this.lost();
    });
    this.channel = ch;
  }

  private onPacket(p: RtPacket) {
    if (this.role === 'host') {
      if (p.k === 'hello') {
        if (this.gid && this.gid !== p.gid) return;
        this.gid = p.gid;
        this.sendRt({ k: 'welcome', gid: p.gid });
        if (!this.rtOpen && !this.conn?.open) {
          this.rtOpen = true;
          this.closePeer();
          this.status('');
          this.onGuestCb();
        }
      } else if (p.k === 'data' && this.rtOpen && p.gid === this.gid) {
        this.onMessage(p.m!);
      }
      return;
    }
    if (p.k === 'welcome' && !this.rtOpen && p.gid === this.gid) {
      this.rtOpen = true;
      this.status('');
      this.onOpenCb();
    } else if (p.k === 'data' && this.rtOpen && p.gid === this.gid) {
      this.onMessage(p.m!);
    }
  }

  private sendRt(p: RtPacket) {
    this.channel?.send({ type: 'broadcast', event: 'msg', payload: p });
  }

  private attach(c: DataConnection) {
    this.conn = c;
    c.on('data', (d) => this.onMessage(d as msg));
    c.on('close', () => {
      if (this.conn === c) this.lost();
    });
  }

  private lost() {
    this.close();
    this.onClose();
    this.status('Connection lost.', true);
  }

  private fail(text: string) {
    this.close();
    this.onClose();
    this.status(text, true);
  }

  send(m: msg) {
    if (this.conn?.open) {
      this.conn.send(m);
    } else if (this.rtOpen) {
      this.sendRt({ k: 'data', gid: this.gid, m });
      if (m.t === 'init') countRealtimeGame();
    }
  }

  private closePeer() {
    this.conn = undefined;
    this.peer?.destroy();
    this.peer = undefined;
  }

  private closeChannel() {
    if (this.channel) getClient().removeChannel(this.channel);
    this.channel = undefined;
  }

  close() {
    this.session++;
    this.rtOpen = false;
    this.gid = '';
    this.closePeer();
    this.closeChannel();
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
  previousScreen: Screen = 'home';
  overlayReturn: Screen = 'home';
  isHost = false;
  assignedRole: 'mapper' | 'explorer' = 'explorer';
  guestVote?: string;
  secondNick?: string;
  lastMs = 0;
  keys: Record<Dir, string> = loadKeys();
  consent = loadConsent();
  capturing: Dir | null = null;
  drawKeys = () => {};

  constructor() {
    this.initNetListeners();
    this.initListeners();
    this.initKeyMap();
    this.net.relayOnly = this.consent === 'relay';
    this.show(this.consent ? 'home' : 'privacy');
  }

  show(name: Screen) {
    const isOverlay = name === 'settings' || name === 'howtoplay';
    const wasOverlay =
    this.currentScreen === 'settings' ||
    this.currentScreen === 'howtoplay' ;

    if (!isOverlay && !wasOverlay && this.currentScreen !== name) {
      this.previousScreen = this.currentScreen;
    }
    if (isOverlay && !wasOverlay) {
      this.overlayReturn = this.currentScreen;
    }

    this.currentScreen = name;
    
    document.querySelectorAll<HTMLElement>('.screen').forEach((s) => (s.hidden = s.dataset.screen !== name));
    const topBar = document.querySelector<HTMLElement>('.top-bar');
    if (topBar) topBar.hidden = name === 'privacy';

    if (name !== 'explorer' && name !== 'mapper') {
      if (this.state?.timerId) clearInterval(this.state.timerId);
    }

    document.getElementById('app')!.classList.toggle('wide', name === 'leaderboard');
    if (name !== 'home' && name !== 'lobby') this.setInfo('');
    if (name !== 'settings') {
      document.getElementById('keys-panel')!.hidden = true;
        this.capturing = null;
    }
    if (name !== 'explorer') {
      document.getElementById('keys-panel')!.hidden = true;
      this.capturing = null;
    }

    if (name === 'leaderboard') {
      this.loadLeaderboard();
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
        ? t('lobby.connected')
        : t('lobby.waiting');
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

      const nick2 = this.secondNick || 'Guest'; 

      const box = document.getElementById('save-box')!;
      box.hidden = true;

      const ok = await saveResult({ nick1, nick2, completion_time: this.lastMs}, this.state.maze.size);
      if (!ok) {
        this.setInfo(t('errors.saveFailed'), true);
        box.hidden = false;
        return;
      }
      this.loadTop();

      if (this.net.connected) {
        this.net.send({ t: 'refresh_top' }); 
      }
  }

  finish(result: 'win' | 'trap', notifyNetwork = true) {
    if (this.state?.timerId) clearInterval(this.state.timerId);
    
    if (notifyNetwork && this.net.connected) {
      this.net.send({ t: 'end', result });
    }

    const titleEl = document.getElementById('result-title');
    const textEl = document.getElementById('result-text');
    const timeEl = document.getElementById('result-time');
    
    if (titleEl) titleEl.textContent = result === 'win' ? t('result.winTitle') : t('result.trapTitle');
    if (textEl) textEl.textContent = result === 'win' ? t('result.winText') : t('result.trapText');
    if (timeEl) timeEl.textContent = this.formatTime(this.state.elapsedTime());
    
    this.lastMs = this.state.elapsedTime();
    if(result==='win') this.save();
    this.loadTop();
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
      if (this.currentScreen === 'settings' || this.currentScreen === 'howtoplay') return;
      this.show('home');
    };
    this.net.onStatus = (text, isError) => this.setInfo(text, isError);
  }

  setInfo(text: string, isError = false) {
    const el = document.getElementById('info')!;
    el.textContent = text;
    el.classList.toggle('error', isError);
  }

  private handleNetworkMessage(m: msg) {
    const sender = this.assignedRole === 'mapper' ? 'explorer' : 'mapper';
    if (!validMessage(m, this.isHost, sender, this.state?.maze.tiles.length ?? 0)) return;
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
        this.secondNick = m.nick;
        this.updateLobbyStatus();
        break;
      
      case 'vote':
        this.guestVote = m.level;
        break;

      case 'refresh_top':
        this.loadTop();
        break;
        
      case 'end':
        this.finish(m.result, false);
        break;
    }
  }

  loadTop() {
    return this.renderTop(this.state.maze.size, 'top', 'top-title');
  }

  loadLeaderboard() {
    document.getElementById('leaderboard-title')!.textContent = t('leaderboard.subTitle');
    if (!document.querySelector('.lb-row')) {
      const row = document.createElement('div');
      row.className = 'lb-row';
      document.getElementById('leaderboard5')!.before(row);
      for (const level of [5, 7, 9, 11]) {
        const col = document.createElement('div');
        const h = document.createElement('p');
        h.className = 'lb-title';
        h.textContent = `${level}x${level}`;
        col.append(h, document.getElementById(`leaderboard${level}`)!);
        row.append(col);
      }
    }
    for (const level of [5, 7, 9, 11]) this.renderTop(level, `leaderboard${level}`);
  }

  async renderTop(level: number, listId: string, titleId?: string) {
    if (titleId) document.getElementById(titleId)!.textContent = `Top 10 (${level}x${level})`;

    const rows = await topResults(level);

    document.getElementById(listId)!.replaceChildren(
        ...Array.from({ length: 10 }, (_, i) => {
            const li = document.createElement('li');
            const r = rows[i];

            if (r) {
                li.textContent = `${r.nick1} & ${r.nick2} ${this.formatTime(r.completion_time)}`;
            } else {
                li.textContent = `---`;
                li.classList.add('empty');
            }

            return li;
        })
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
    const btn = document.getElementById('keys-btn')!;
    const panel = document.createElement('div');
    panel.id = 'keys-panel';
    panel.hidden = true;
    document.body.append(panel);

    const arrows: Record<Dir, string> = { N:'up', NE: 'upRight', E: 'right', SE: 'downRight', S: 'down', SW: 'downLeft', W: 'left', NW: 'upLeft'};
    const fmt = (k: string) => (k === ' ' ? 'SPACE' : k.toUpperCase());

    this.drawKeys = () => {
      const rows = (Object.keys(arrows) as Dir[]).map((d) => {
        const row = document.createElement('div');
        row.className = 'keys-row';
        const name = document.createElement('span');
        name.textContent = arrows[d];
        const b = document.createElement('button');
        name.textContent = t(`settings.keys.${arrows[d]}`);
        b.textContent = this.capturing === d ? '…' : fmt(this.keys[d]);
        b.onclick = () => {
          this.capturing = d;
          this.drawKeys();
        };
        row.append(name, b);
        return row;
      });
      const reset = document.createElement('button');
      reset.textContent = t('settings.keys.default');
      reset.onclick = () => {
        this.keys = { ...DEFAULT_KEYS };
        this.capturing = null;
        saveKeys(this.keys);
        this.drawKeys();
      };
      const title = document.createElement('div');
      title.textContent = t('settings.keys.title');
      const close = document.createElement('button');
      close.textContent = t('settings.keys.saveClose');
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

    document.querySelectorAll<HTMLElement>('[data-lang]').forEach((btn) => {
      btn.addEventListener('click', () => setLanguage(btn.dataset.lang));
    });

    document.getElementById('open-settings')?.addEventListener('click', () => {
      this.show('settings');
    });

    document.getElementById('open-info')?.addEventListener('click', () => {
      this.show('howtoplay');
    });

    document.getElementById('howtoplay-back')?.addEventListener('click', () => {
      this.show(this.overlayReturn);
    });

    document.getElementById('chprivacy')?.addEventListener('click', () => {
      this.show('privacy');
    });

    document.querySelector('[data-screen="settings"] [data-go]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation(); 
      this.show(this.overlayReturn);
    });

    const codeEl = document.getElementById('lobby-code')!;
    document.getElementById('create')?.addEventListener('click', (e) => {
      e.preventDefault();
      const nick1 = document.querySelector<HTMLInputElement>('#nick')!.value.trim();
      if (!nick1) {
        this.setInfo(t('errors.needNick'), true);
        return;
      }

      this.isHost = true;
      this.guestVote = undefined;
      this.secondNick = undefined;
      codeEl.textContent = '…';
      this.net.host(
        (code) => (codeEl.textContent = code),
        () => {
          this.guestVote = undefined;
          this.secondNick = undefined;
          this.show('lobby');
          this.updateLobbyStatus();
        },
      );
      this.show('lobby');
    });

    const choose = (mode: 'direct' | 'relay') => {
      this.consent = mode;
      this.net.relayOnly = mode === 'relay';
      saveConsent(mode);
      this.show('home');
    };
    document.getElementById('consent-direct')?.addEventListener('click', () => choose('direct'));
    document.getElementById('consent-relay')?.addEventListener('click', () => choose('relay'));
    document.getElementById('consent-deny')?.addEventListener('click', () => {
      this.consent = null;
      saveConsent(null);
      this.net.close();
      this.setInfo(t('errors.privacy'));
    });

    document.getElementById('leaderboard')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.show('leaderboard');
    });

    document.getElementById('join')?.addEventListener('click', (e) => {
      e.preventDefault();
      const code = document.querySelector<HTMLInputElement>('#code')!.value.trim().toUpperCase();
      const nickVal = document.querySelector<HTMLInputElement>('#nick')!.value.trim(); // Pobieramy nick z pola
      
      if (!code || !nickVal) {
        this.setInfo(t('errors.needCodeAndNick'), true);
        return;
      }
      
      this.isHost = false;
      this.net.join(code, () => {
        codeEl.textContent = code;
        this.show('lobby');
        this.sendVote();
        
        if (this.net.connected) {
          this.net.send({ t: 'player-join', nick: nickVal });
        }
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

      if (e.key === 'Escape') {
        const keysPanel = document.getElementById('keys-panel');
        if (keysPanel && !keysPanel.hidden) {
          e.preventDefault();
          keysPanel.hidden = true;
          this.capturing = null;
          this.drawKeys();
          return;
        }

        if (this.currentScreen !== 'settings' && this.currentScreen !== 'privacy') {
          e.preventDefault();
          this.show('settings');
          return;
        }
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
setLanguage(localStorage.getItem('lang') ?? 'en');
new GameSession();