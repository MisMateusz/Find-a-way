import './style.css';
import { DELTA, OPPOSITE, TILE_DEFS, openings, type Dir, type TileType } from './core/tiles';

type Screen = 'home' | 'lobby' | 'mapper' | 'explorer' | 'result';
interface Tile { type: TileType; rotation: number; trap: boolean }

let N: number = 5;

const startButton = document.getElementById('start');

startButton?.addEventListener('click', () => {
  const levelInput = document.querySelector<HTMLInputElement>('input[name="level"]:checked')?.value;
  
  if (levelInput === 'random') {
    const levels = [5, 7, 9];
    N = levels[Math.floor(Math.random() * levels.length)];
  } else {
    N = Number(levelInput ?? 5);
  }

  console.log("Wybrany rozmiar N:", N);
  newBoard(); 
});

const types = Object.keys(TILE_DEFS) as TileType[];
const rnd = (n: number) => Math.floor(Math.random() * n);
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

let board: Tile[] = [];
let pos = { x: 0, y: 2 };
let exit = { x: N - 1, y: 2 }; // zmienione na let, aby zmieniało się wraz z N
let t0 = 0;
let timerId = 0;

const at = (x: number, y: number) => board[y * N + x];

function newBoard() {
  exit = { x: N - 1, y: 2 }; // aktualizacja pozycji wyjścia dla aktualnego N
  board = Array.from({ length: N * N }, () => ({ type: types[rnd(types.length)], rotation: 90 * rnd(4), trap: false }));
  at(0, 2).type = 'cross'; // start i wyjście zawsze przejezdne
  at(exit.x, exit.y).type = 'cross';
  for (let k = 0; k < 3; k++) {
    const x = 1 + rnd(N - 2), y = rnd(N);
    at(x, y).trap = true;
  }
  pos = { x: 0, y: 2 };
}

function div(cls: string) {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

function tileEl(t: Tile, mark?: string): HTMLElement {
const container = document.createElement('div');
    container.className = 'tile';

    // 2. Tworzymy obrazek kafelka
    const img = document.createElement('img');
    img.src = `tiles/${t.type}.png`;
    img.style.transform = `rotate(${t.rotation}deg)`;
    img.draggable = false; // blokuje domyślne przeciąganie obrazka przez przeglądarkę
    container.appendChild(img);

    // 3. Jeśli jest mark (np. wyjście '>'), dodajemy go jako nakładkę
    if (mark) {
        const markEl = document.createElement('span');
        markEl.className = 'tile-mark';
        markEl.textContent = mark;
        container.appendChild(markEl);
    }

    return container;
}

function renderMapper() {
  const el = $('#board-mapper');
  el.style.setProperty('--n', String(N));
  el.replaceChildren(
    ...board.map((t, i) => {
      const c = tileEl(t, i === exit.y * N + exit.x ? '>' : undefined);
      c.dataset.i = String(i);
      return c;
    }),
  );
}

$('#board-mapper').addEventListener('click', (e) => {
  const tile = (e.target as HTMLElement).closest<HTMLElement>('.tile');
  if (!tile) return;
  const r = tile.getBoundingClientRect();
  const turn = e.clientX < r.left + r.width / 2 ? -90 : 90;
  const t = board[Number(tile.dataset.i)];
  t.rotation = (t.rotation + turn + 360) % 360;
  renderMapper();
});

function renderExplorer() {
  const el = $('#board-explorer');
  el.style.setProperty('--n', String(N));
  el.replaceChildren(
    ...board.map((t, i) => {
      const x = i % N, y = Math.floor(i / N);
      const dist = Math.abs(x - pos.x) + Math.abs(y - pos.y);
      let mark: string | undefined;
      if (dist === 0) mark = '@';
      else if (dist === 1 && t.trap) mark = '!';
      else if (dist === 1 && x === exit.x && y === exit.y) mark = '>';
      const c = tileEl(t, mark);
      if (dist > 1) c.classList.add('fog');
      return c;
    }),
  );
}

function move(d: Dir) {
  const from = at(pos.x, pos.y);
  const nx = pos.x + DELTA[d][0], ny = pos.y + DELTA[d][1];
  if (nx < 0 || ny < 0 || nx >= N || ny >= N) return;
  const to = at(nx, ny);
  if (!openings(from.type, from.rotation).includes(d)) return;
  if (!openings(to.type, to.rotation).includes(OPPOSITE[d])) return;
  pos = { x: nx, y: ny };
  if (to.trap) return finish('trap');
  if (nx === exit.x && ny === exit.y) return finish('win');
  renderExplorer();
}

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function finish(result: 'win' | 'trap') {
  clearInterval(timerId);
  $('#result-title').textContent = result === 'win' ? 'Wyjście znalezione' : 'Pułapka';
  $('#result-text').textContent = result === 'win' ? 'Udało się wydostać z labiryntu.' : 'Eksplorer wpadł w pułapkę.';
  $('#result-time').textContent = fmt(Date.now() - t0);
  show('result');
}

function show(name: Screen) {
  document.querySelectorAll<HTMLElement>('.screen').forEach((s) => (s.hidden = s.dataset.screen !== name));
  if (name !== 'explorer') clearInterval(timerId);
  if (name === 'lobby') {
    newBoard();
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $('#lobby-code').textContent = Array.from({ length: 4 }, () => abc[rnd(abc.length)]).join('');
  }
  if (name === 'mapper') renderMapper();
  if (name === 'explorer') {
    renderExplorer();
    t0 = Date.now();
    timerId = window.setInterval(() => ($('#timer').textContent = fmt(Date.now() - t0)), 250);
  }
}

document.addEventListener('click', (e) => {
  const el = e.target as HTMLElement;
  const go = el.closest<HTMLElement>('[data-go]');
  if (go) show(go.dataset.go as Screen);
  const mv = el.closest<HTMLElement>('[data-move]');
  if (mv) move(mv.dataset.move as Dir);
});

document.addEventListener('keydown', (e) => {
  if ($('[data-screen="explorer"]').hidden) return;
  const map: Record<string, Dir> = { ArrowUp: 'N', w: 'N', ArrowRight: 'E', d: 'E', ArrowDown: 'S', s: 'S', ArrowLeft: 'W', a: 'W' };
  const d = map[e.key];
  if (d) { e.preventDefault(); move(d); }
});

newBoard();
show('home');