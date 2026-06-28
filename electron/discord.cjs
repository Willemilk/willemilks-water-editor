// Discord Rich Presence for the editor.
//
// This is a tiny, self contained implementation of the Discord IPC protocol on
// top of Node's built in `net` module. It deliberately avoids the
// @xhayper/discord-rpc / discord-rpc packages so the feature adds ZERO
// dependencies: nothing new to bundle, no supply chain or version risk, and it
// can never break the build or the (sacred) playtest pipeline. The wire format
// is the same one those libraries speak, so swapping to a library later is easy.
//
// Robustness is the whole point: if Discord is not running, the socket can't be
// reached, or anything throws, we fail silently and retry on a timer. The editor
// is never blocked or slowed by any of this.

const net = require('node:net');
const path = require('node:path');

// ============================================================================
//  CONFIG -- REPLACE THIS WITH YOUR OWN DISCORD APPLICATION ID
//  1. Go to https://discord.com/developers/applications and create an app.
//  2. Copy its "Application ID" (an 18-19 digit number) over the value below.
//  3. Under Rich Presence > Art Assets, upload two images named exactly
//     "app_logo" (large) and "editor_icon" (small), or change the keys below.
//  Until you do this, presence simply will not show -- the app keeps working.
// ============================================================================
const CLIENT_ID = '1393740000000000000'; // TODO Willemilk: replace with your own Discord application ID
const LARGE_IMAGE = 'app_logo';   // Rich Presence art asset key (large icon)
const SMALL_IMAGE = 'editor_icon'; // Rich Presence art asset key (small icon)
const LARGE_TEXT = 'Willemilks Water Editor';

// Discord IPC opcodes
const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

const RETRY_MS = 15000; // how often to retry while Discord is unreachable

class DiscordPresence {
  constructor() {
    this.socket = null;
    this.enabled = false;
    this.ready = false;        // handshake completed
    this.connecting = false;
    this.startTimestamp = Date.now(); // elapsed timer counts from app start
    this.lastActivity = null;  // re-sent after a (re)connect
    this.readBuf = Buffer.alloc(0);
    this.retryTimer = null;
  }

  /** Turn the feature on/off (driven by the Settings toggle). */
  setEnabled(on) {
    on = !!on;
    if (on === this.enabled) { if (on) this._ensureConnected(); return; }
    this.enabled = on;
    if (on) this._ensureConnected();
    else this._teardown(true);
  }

  /** Update what is shown. activity = { details, state, smallText }. */
  update(activity) {
    this.lastActivity = activity || null;
    if (!this.enabled) return;
    if (this.ready) this._setActivity();
    else this._ensureConnected();
  }

  /** Called on app quit: best effort clear + close. */
  shutdown() { this._teardown(true); }

  // ---- internals (everything below fails silently) ----

  _ipcPath(id) {
    if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${id}`;
    const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR
      || process.env.TMP || process.env.TEMP || '/tmp';
    return path.join(base, `discord-ipc-${id}`);
  }

  _scheduleRetry() {
    if (this.retryTimer || !this.enabled) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this._ensureConnected();
    }, RETRY_MS);
    if (this.retryTimer.unref) this.retryTimer.unref(); // never keep the app alive
  }

  _ensureConnected() {
    if (!this.enabled || this.socket || this.connecting) return;
    this.connecting = true;
    this._tryPipe(0);
  }

  _tryPipe(id) {
    if (!this.enabled || id > 9) { this.connecting = false; this._scheduleRetry(); return; }
    let sock;
    try {
      sock = net.createConnection(this._ipcPath(id));
    } catch {
      this._tryPipe(id + 1);
      return;
    }
    let opened = false;
    sock.on('connect', () => {
      opened = true;
      this.socket = sock;
      this.connecting = false;
      this.readBuf = Buffer.alloc(0);
      this._send(OP_HANDSHAKE, { v: 1, client_id: CLIENT_ID });
    });
    sock.on('data', (chunk) => this._onData(chunk));
    sock.on('error', () => {
      if (opened) return;          // a live socket erroring is handled by 'close'
      try { sock.destroy(); } catch {}
      this._tryPipe(id + 1);       // pipe not there, try the next slot
    });
    sock.on('close', () => {
      if (this.socket !== sock) return;
      this.socket = null;
      this.ready = false;
      this.connecting = false;
      this._scheduleRetry();
    });
  }

  _send(op, dataObj) {
    if (!this.socket) return;
    try {
      const json = Buffer.from(JSON.stringify(dataObj), 'utf8');
      const head = Buffer.alloc(8);
      head.writeInt32LE(op, 0);
      head.writeInt32LE(json.length, 4);
      this.socket.write(Buffer.concat([head, json]));
    } catch { /* socket went away mid write; the 'close' handler will retry */ }
  }

  _onData(chunk) {
    try {
      this.readBuf = Buffer.concat([this.readBuf, chunk]);
      // parse as many complete [op][len][payload] frames as we have
      while (this.readBuf.length >= 8) {
        const op = this.readBuf.readInt32LE(0);
        const len = this.readBuf.readInt32LE(4);
        if (this.readBuf.length < 8 + len) break;
        const payload = this.readBuf.slice(8, 8 + len);
        this.readBuf = this.readBuf.slice(8 + len);
        this._onFrame(op, payload);
      }
    } catch { /* malformed frame: drop it, stay alive */ }
  }

  _onFrame(op, payload) {
    if (op === OP_PING) { this._send(OP_PONG, this._parse(payload)); return; }
    if (op === OP_CLOSE) {
      // usually an invalid CLIENT_ID (placeholder not yet replaced). Drop and
      // back off so we don't hammer Discord with a bad handshake.
      try { this.socket?.destroy(); } catch {}
      return;
    }
    if (op === OP_FRAME) {
      const msg = this._parse(payload);
      if (msg && msg.evt === 'READY') {
        this.ready = true;
        if (this.lastActivity) this._setActivity();
      }
    }
  }

  _parse(buf) { try { return JSON.parse(buf.toString('utf8')); } catch { return null; } }

  _clamp(s) {
    if (s == null) return undefined;
    s = String(s);
    if (s.length < 2) s = (s + '  ').slice(0, 2); // Discord requires >= 2 chars
    return s.slice(0, 128);
  }

  _setActivity() {
    if (!this.ready || !this.socket) return;
    const a = this.lastActivity || {};
    const activity = {
      details: this._clamp(a.details),
      state: this._clamp(a.state),
      timestamps: { start: this.startTimestamp },
      assets: {
        large_image: LARGE_IMAGE,
        large_text: LARGE_TEXT,
        small_image: SMALL_IMAGE,
        small_text: this._clamp(a.smallText) || LARGE_TEXT,
      },
      instance: false,
    };
    this._send(OP_FRAME, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity },
      nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
  }

  _teardown(clear) {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.socket && clear && this.ready) {
      // clear the presence so the user's status goes back to nothing
      this._send(OP_FRAME, {
        cmd: 'SET_ACTIVITY',
        args: { pid: process.pid, activity: null },
        nonce: `${Date.now()}-clear`,
      });
    }
    try { this.socket?.destroy(); } catch {}
    this.socket = null;
    this.ready = false;
    this.connecting = false;
  }
}

module.exports = new DiscordPresence();
