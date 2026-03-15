/**
 * Express + WebSocket Server
 *
 * Serves the React frontend (production) and provides WebSocket
 * for Claude CLI streaming. Ported from telcoOS-webapp.
 */

const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { startStream, cancelStream, checkClaudeAvailable } = require('./claude');

function startServer(port) {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json());

    // Serve static frontend (production build)
    const distPath = path.join(__dirname, '..', 'dist');
    app.use(express.static(distPath));

    // Health + CLI status endpoint
    app.get('/api/status', async (_req, res) => {
      const claude = await checkClaudeAvailable();
      res.json({ ok: true, claude });
    });

    // SPA fallback (Express 5 requires named param for wildcard)
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });

    const server = http.createServer(app);

    // WebSocket server
    const wss = new WebSocketServer({ server, path: '/ws/claude' });

    wss.on('connection', (ws) => {
      console.log('WebSocket: Claude connection opened');

      let activeStreamId = null;
      let cancelGraceTimer = null;

      const send = (event) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify(event));
        }
      };

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());

          switch (msg.type) {
            case 'start':
              handleStart(msg);
              break;
            case 'cancel':
              handleCancel(msg.streamId);
              break;
            case 'pong':
              break;
            default:
              send({ type: 'error', error: `Unknown message type: ${msg.type}` });
          }
        } catch (err) {
          send({ type: 'error', error: err.message || 'Invalid message' });
        }
      });

      ws.on('close', () => {
        console.log('WebSocket: Claude connection closed');
        if (activeStreamId) {
          const idToCancel = activeStreamId;
          cancelGraceTimer = setTimeout(() => {
            cancelStream(idToCancel);
            cancelGraceTimer = null;
          }, 5000);
        }
      });

      function handleStart(msg) {
        if (!msg.message) {
          send({ type: 'error', error: 'Message is required' });
          return;
        }

        if (cancelGraceTimer) {
          clearTimeout(cancelGraceTimer);
          cancelGraceTimer = null;
        }

        if (activeStreamId) {
          cancelStream(activeStreamId);
        }

        const streamId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        activeStreamId = streamId;

        try {
          const stream = startStream(streamId, msg.message, msg.sessionId);

          stream.on('init', (sessionId) => {
            send({ type: 'init', streamId, sessionId });
          });

          stream.on('message', (text, content) => {
            send({ type: 'message', streamId, text, content });
          });

          stream.on('result', (result, sessionId, cost) => {
            send({ type: 'result', streamId, sessionId, result, cost });
          });

          stream.on('error', (error) => {
            send({ type: 'error', streamId, error: error.message });
          });

          stream.on('exit', (code, signal) => {
            send({ type: 'exit', streamId, code, signal });
            if (activeStreamId === streamId) activeStreamId = null;
          });

        } catch (err) {
          activeStreamId = null;
          send({ type: 'error', streamId, error: err.message });
        }
      }

      function handleCancel(streamId) {
        const idToCancel = streamId || activeStreamId;
        if (idToCancel) {
          cancelStream(idToCancel);
          if (activeStreamId === idToCancel) activeStreamId = null;
        }
        send({ type: 'cancelled', streamId: idToCancel });
      }
    });

    // Heartbeat to detect stale connections
    const heartbeat = setInterval(() => {
      wss.clients.forEach((ws) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      });
    }, 30000);

    wss.on('close', () => clearInterval(heartbeat));

    server.listen(port, () => {
      console.log(`MockDeskAI server listening on port ${port}`);
      resolve(server);
    });
  });
}

module.exports = { startServer };
