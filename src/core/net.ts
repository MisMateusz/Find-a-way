import { Peer, type DataConnection } from 'peerjs';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getClient, realtimeAllowed, countRealtimeGame } from './db';
import { t } from './i18n';
import { TILE_DEFS, TILE_EXT_DEFS } from './tiles';
import type { Labirynth, Position, Tile } from './game';

export type msg = 
| { t: 'init', role: 'mapper' | 'explorer', maze: Labirynth } 
| { t: 'rotation', i: number, rotation: number }
| { t: 'player-join', nick: string }
| { t: 'vote', level: string }
| {t: 'refresh_top'}
| { t: 'chat', text: string }
| { t: 'end', result: 'win' | 'trap' };

const ID_PREFIX = 'findaway-';
const PEER_TIMEOUT = 10000;
const NO_BACKUP = 'Backup server is unavailable or paused for this month. Try another browser or network, or come back later.';

type RtPacket = { k: 'hello' | 'welcome' | 'data'; gid: string; m?: msg };

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
    case 'chat':
      return typeof m.text === 'string' && m.text.length > 0 && m.text.length <= 200;
    default:
      return false;
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