import type { GameState, Tile } from './game';

type Mark = 'explorer' | 'warning' | 'exit';

const MARK_IMG: Record<Mark, string> = {
  explorer: 'marks/explorer.png',
  warning: 'marks/warning.png',
  exit: 'marks/exit.png',
};

const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

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