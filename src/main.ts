import './style.css';
import type { DirExt as Dir } from './core/tiles';
import { saveResult, topResults } from './core/db';
import { t, setLanguage } from './core/i18n';
import { DEFAULT_KEYS, loadKeys, saveKeys, loadConsent, saveConsent } from './core/storage';
import { GameState, Labirynth, LobbySetting } from './core/game';
import { NetService, validMessage, type msg } from './core/net';
import { GameView } from './core/view';
import { Chat } from './core/chat';

type Screen = 'home' | 'lobby' | 'mapper' | 'explorer' | 'result' | 'leaderboard' | 'privacy' | 'settings' | 'howtoplay';

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
  chat = new Chat((text) => this.net.send({ t: 'chat', text }));

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
    this.chat.setVisible(this.net.connected && ['lobby', 'mapper', 'explorer', 'result'].includes(name));
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

      case 'chat':
        this.chat.receive(m.text);
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
      this.chat.clear();
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
      this.chat.clear();
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