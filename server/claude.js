/**
 * Claude CLI Service
 *
 * Spawns Claude Code CLI as a child process with NDJSON streaming.
 * Ported from telcoOS-webapp/server/src/services/claude.ts
 */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');

class ClaudeStream extends EventEmitter {
  constructor(streamId, sessionId) {
    super();
    this.process = null;
    this.streamId = streamId;
    this.sessionId = sessionId;
    this.killed = false;
    this.buffer = '';
  }

  isRunning() {
    return this.process !== null && !this.killed;
  }

  getSessionId() {
    return this.sessionId;
  }

  start(message) {
    if (this.process) throw new Error('Stream already started');

    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ];

    if (this.sessionId) {
      args.push('--resume', this.sessionId);
    }

    args.push(message);

    // Escape for shell
    const escapedArgs = ['claude', ...args]
      .map(arg => `'${arg.replace(/'/g, "'\\''")}'`)
      .join(' ');

    // Spawn via login shell for PATH resolution
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
    const shellArgs = process.platform === 'win32'
      ? ['/c', `claude ${args.map(a => `"${a}"`).join(' ')}`]
      : ['-l', '-c', escapedArgs];

    this.process = spawn(shell, shellArgs, {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.process.stdout.on('data', (chunk) => this._handleStdout(chunk));
    this.process.stderr.on('data', (chunk) => this._handleStderr(chunk));

    this.process.on('close', (code, signal) => {
      this.process = null;
      this.emit('exit', code, signal);
    });

    this.process.on('error', (err) => {
      this.emit('error', err);
      this.process = null;
    });
  }

  _handleStdout(chunk) {
    this.buffer += chunk.toString('utf-8');
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed);
        this._handleEvent(event);
      } catch {
        // Non-JSON output, ignore
      }
    }
  }

  _handleStderr(chunk) {
    const text = chunk.toString('utf-8').trim();
    if (text) console.error('[Claude stderr]:', text);
  }

  _handleEvent(event) {
    if (event.type === 'system' && event.session_id) {
      this.sessionId = event.session_id;
      this.emit('init', event.session_id);
      return;
    }

    if (event.type === 'assistant' && event.message?.content) {
      const textParts = [];
      for (const part of event.message.content) {
        if (part.type === 'text' && typeof part.text === 'string') {
          textParts.push(part.text);
        }
      }
      this.emit('message', textParts.join(''), event.message.content);
      return;
    }

    if (event.type === 'result' && 'result' in event) {
      if (event.session_id) this.sessionId = event.session_id;
      this.emit('result', event.result, event.session_id, event.total_cost_usd);
      return;
    }
  }

  cancel() {
    if (!this.process || this.killed) return;
    this.killed = true;
    this.process.kill('SIGTERM');
    setTimeout(() => {
      if (this.process) this.process.kill('SIGKILL');
    }, 2000);
  }
}

// Stream manager singleton
const streams = new Map();

function startStream(streamId, message, sessionId) {
  if (streams.has(streamId)) throw new Error(`Stream ${streamId} already exists`);

  const stream = new ClaudeStream(streamId, sessionId);
  streams.set(streamId, stream);

  stream.on('exit', () => streams.delete(streamId));
  stream.start(message);

  return stream;
}

function cancelStream(streamId) {
  const stream = streams.get(streamId);
  if (stream) {
    stream.cancel();
    return true;
  }
  return false;
}

function cancelAllStreams() {
  for (const stream of streams.values()) stream.cancel();
  streams.clear();
}

/**
 * Check if Claude CLI is available on this machine
 */
function checkClaudeAvailable() {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
    const args = process.platform === 'win32'
      ? ['/c', 'claude --version']
      : ['-l', '-c', 'claude --version'];

    const proc = spawn(shell, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });

    let stdout = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });

    proc.on('close', (code) => {
      resolve(code === 0
        ? { available: true, version: stdout.trim() }
        : { available: false }
      );
    });

    proc.on('error', () => resolve({ available: false }));
    setTimeout(() => { proc.kill(); resolve({ available: false }); }, 5000);
  });
}

module.exports = { ClaudeStream, startStream, cancelStream, cancelAllStreams, checkClaudeAvailable };
