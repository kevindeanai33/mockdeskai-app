/**
 * MockDeskAI — Editor App
 *
 * PSD editor with AI chat powered by Claude CLI.
 * Ported from mockdeskai-web page.tsx, adapted for Electron + WebSocket.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Upload,
  Eye,
  EyeOff,
  Type,
  Image as ImageIcon,
  FolderOpen,
  Send,
  Undo2,
  Download,
  Layers,
  Loader2,
  Check,
  X,
  FileImage,
  AlertCircle,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { parsePsd, editPsd, undoPsd, rgbaToDataUrl } from '@/lib/psd-client';
import {
  buildPsdJsonContext,
  extractJsonCommands,
  containsJsonCommand,
  stripJsonCommandBlocks,
} from '@/services/psdJsonContext';
import { useWebSocket } from '@/hooks/useWebSocket';

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function layerTypeIcon(type) {
  switch (type) {
    case 'text': return <Type size={14} className="shrink-0 text-blue-400" />;
    case 'pixel': return <ImageIcon size={14} className="shrink-0 text-green-400" />;
    case 'group': return <FolderOpen size={14} className="shrink-0 text-yellow-400" />;
    default: return <ImageIcon size={14} className="shrink-0 text-gray-400" />;
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function App() {
  // ---- State ----
  const [psdDoc, setPsdDoc] = useState(null);
  const [editHistory, setEditHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [showLayers, setShowLayers] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [parseError, setParseError] = useState(null);
  const [claudeStatus, setClaudeStatus] = useState(null); // null | 'checking' | 'available' | 'unavailable'
  const [claudeSessionId, setClaudeSessionId] = useState(null);

  // Track streaming state per entry
  const streamingEntryRef = useRef(null);
  const streamingTextRef = useRef('');
  const psdDocRef = useRef(null);

  // Keep psdDocRef in sync
  useEffect(() => { psdDocRef.current = psdDoc; }, [psdDoc]);

  const fileInputRef = useRef(null);
  const chatInputRef = useRef(null);
  const historyEndRef = useRef(null);

  // Scroll to bottom on new history entries
  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [editHistory.length]);

  // ---- WebSocket ----

  const handleWsMessage = useCallback((event) => {
    switch (event.type) {
      case 'init':
        if (event.sessionId) setClaudeSessionId(event.sessionId);
        break;

      case 'message': {
        const text = event.text || '';
        streamingTextRef.current = text;

        // Update streaming entry with accumulated text
        if (streamingEntryRef.current) {
          setEditHistory((prev) =>
            prev.map((e) =>
              e.id === streamingEntryRef.current
                ? { ...e, response: text }
                : e
            )
          );
        }
        break;
      }

      case 'result': {
        if (event.sessionId) setClaudeSessionId(event.sessionId);
        const finalText = streamingTextRef.current || event.result || '';
        finalizeResponse(finalText);
        break;
      }

      case 'exit': {
        const exitText = streamingTextRef.current;
        if (exitText && streamingEntryRef.current) {
          finalizeResponse(exitText);
        }
        break;
      }

      case 'error':
        if (streamingEntryRef.current) {
          setEditHistory((prev) =>
            prev.map((e) =>
              e.id === streamingEntryRef.current
                ? { ...e, response: event.error || 'Error occurred', status: 'failed' }
                : e
            )
          );
          streamingEntryRef.current = null;
          streamingTextRef.current = '';
        }
        break;

      case 'cancelled':
        if (streamingEntryRef.current) {
          setEditHistory((prev) =>
            prev.map((e) =>
              e.id === streamingEntryRef.current
                ? { ...e, response: streamingTextRef.current || 'Cancelled', status: 'failed' }
                : e
            )
          );
          streamingEntryRef.current = null;
          streamingTextRef.current = '';
        }
        break;
    }
  }, []);

  const { send, isConnected } = useWebSocket('/ws/claude', {
    onMessage: handleWsMessage,
    autoConnect: true,
  });

  // ---- Finalize AI response: extract + execute commands ----

  const finalizeResponse = useCallback(async (responseText) => {
    const entryId = streamingEntryRef.current;
    streamingEntryRef.current = null;
    streamingTextRef.current = '';

    if (!entryId) return;

    const doc = psdDocRef.current;

    if (containsJsonCommand(responseText) && doc) {
      const commands = extractJsonCommands(responseText);
      const explanation = stripJsonCommandBlocks(responseText);

      try {
        let lastRgba = null;
        for (const cmd of commands) {
          lastRgba = await editPsd(cmd);
        }

        if (lastRgba) {
          const dataUrl = rgbaToDataUrl(lastRgba, doc.width, doc.height);
          setPsdDoc((prev) => prev ? { ...prev, compositeDataUrl: dataUrl } : null);
        }

        setEditHistory((prev) =>
          prev.map((e) =>
            e.id === entryId
              ? { ...e, response: explanation || `Applied ${commands.length} edit(s).`, status: 'applied' }
              : e
          )
        );
      } catch (err) {
        setEditHistory((prev) =>
          prev.map((e) =>
            e.id === entryId
              ? { ...e, response: `Edit failed: ${err.message}`, status: 'failed' }
              : e
          )
        );
      }
    } else {
      // No commands — conversational response
      setEditHistory((prev) =>
        prev.map((e) =>
          e.id === entryId
            ? { ...e, response: responseText, status: 'applied' }
            : e
        )
      );
    }
  }, []);

  // ---- Check Claude CLI on mount ----

  useEffect(() => {
    setClaudeStatus('checking');
    fetch('/api/status')
      .then((r) => r.json())
      .then((data) => {
        setClaudeStatus(data.claude?.available ? 'available' : 'unavailable');
      })
      .catch(() => setClaudeStatus('unavailable'));
  }, []);

  // ---- File handling ----

  const handleFile = useCallback(async (file) => {
    if (!file.name.toLowerCase().endsWith('.psd')) {
      setParseError('Only .psd files are supported.');
      return;
    }

    setIsLoading(true);
    setParseError(null);
    setDragOver(false);

    try {
      const doc = await parsePsd(file);
      const dataUrl = rgbaToDataUrl(doc.compositeRgba, doc.width, doc.height);

      setPsdDoc({
        width: doc.width,
        height: doc.height,
        layers: doc.layers,
        compositeDataUrl: dataUrl,
        fileName: file.name,
      });
      setIsLoading(false);
      setEditHistory([]);
      setClaudeSessionId(null);
    } catch (err) {
      setIsLoading(false);
      setParseError(err instanceof Error ? err.message : 'Failed to parse PSD file.');
    }
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const onFileSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // ---- Layer visibility ----

  const toggleLayerVisibility = useCallback(async (layerId, currentlyVisible) => {
    if (!psdDoc) return;
    try {
      const rgba = await editPsd({
        action: 'set_visibility',
        id: layerId,
        visible: !currentlyVisible,
      });
      const dataUrl = rgbaToDataUrl(rgba, psdDoc.width, psdDoc.height);

      setPsdDoc((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          compositeDataUrl: dataUrl,
          layers: prev.layers.map((l) =>
            l.id === layerId ? { ...l, visible: !l.visible } : l
          ),
        };
      });
    } catch (err) {
      console.error('Failed to toggle visibility:', err);
    }
  }, [psdDoc]);

  // ---- Undo ----

  const handleUndo = useCallback(async (entryId) => {
    if (!psdDoc) return;
    try {
      const rgba = await undoPsd();
      const dataUrl = rgbaToDataUrl(rgba, psdDoc.width, psdDoc.height);
      setPsdDoc((prev) => prev ? { ...prev, compositeDataUrl: dataUrl } : null);
      setEditHistory((prev) => prev.filter((e) => e.id !== entryId));
    } catch (err) {
      console.error('Failed to undo:', err);
    }
  }, [psdDoc]);

  // ---- Export ----

  const handleExport = useCallback(async (format) => {
    if (!psdDoc) return;

    const img = new Image();
    img.src = psdDoc.compositeDataUrl;
    await new Promise((resolve) => (img.onload = resolve));

    const canvas = document.createElement('canvas');
    canvas.width = psdDoc.width;
    canvas.height = psdDoc.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
    const ext = format === 'png' ? 'png' : 'jpg';
    const baseName = psdDoc.fileName.replace(/\.psd$/i, '');

    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `${baseName}.${ext}`);
    }, mimeType, 0.92);
  }, [psdDoc]);

  // ---- Chat submit ----

  const handleChatSubmit = useCallback((e) => {
    e.preventDefault();
    const prompt = chatInput.trim();
    if (!prompt || !psdDoc || !isConnected) return;

    const entryId = generateId();

    // Build the full message with PSD context
    const textLayers = psdDoc.layers.filter((l) => l.type === 'text');
    const context = buildPsdJsonContext(psdDoc.fileName, psdDoc.layers, textLayers);
    const fullMessage = `${context}\n\nUser request: ${prompt}`;

    // Track streaming state
    streamingEntryRef.current = entryId;
    streamingTextRef.current = '';

    setEditHistory((prev) => [
      ...prev,
      {
        id: entryId,
        prompt,
        response: '',
        status: 'streaming',
        timestamp: Date.now(),
      },
    ]);
    setChatInput('');

    // Send via WebSocket
    send({
      type: 'start',
      message: fullMessage,
      sessionId: claudeSessionId,
    });
  }, [chatInput, psdDoc, isConnected, send, claudeSessionId]);

  // =========================================================================
  // Render: Upload State
  // =========================================================================

  if (!psdDoc) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-950 px-4">
        {/* Header */}
        <div className="mb-12 text-center">
          <div className="mb-3 flex items-center justify-center gap-3">
            <FileImage size={36} className="text-blue-500" />
            <h1 className="text-3xl font-bold tracking-tight text-white">
              MockDeskAI
            </h1>
          </div>
          <p className="text-base text-gray-400">
            AI-powered design proofing for sales teams
          </p>
        </div>

        {/* Status indicators */}
        <div className="mb-6 flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            {isConnected
              ? <Wifi size={14} className="text-green-400" />
              : <WifiOff size={14} className="text-red-400" />
            }
            <span className={isConnected ? 'text-green-400' : 'text-red-400'}>
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {claudeStatus === 'available' && (
              <>
                <Check size={14} className="text-green-400" />
                <span className="text-green-400">Claude CLI ready</span>
              </>
            )}
            {claudeStatus === 'unavailable' && (
              <>
                <AlertCircle size={14} className="text-yellow-400" />
                <span className="text-yellow-400">Claude CLI not found</span>
              </>
            )}
            {(claudeStatus === 'checking' || claudeStatus === null) && (
              <>
                <Loader2 size={14} className="animate-spin text-gray-400" />
                <span className="text-gray-400">Checking CLI...</span>
              </>
            )}
          </div>
        </div>

        {/* Drop zone */}
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          aria-label="Upload PSD file"
          className={`flex w-full max-w-lg cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-8 py-16 transition-all ${
            dragOver
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-gray-700 bg-gray-900 hover:border-gray-500 hover:bg-gray-900/80'
          }`}
        >
          {isLoading ? (
            <>
              <Loader2 size={48} className="mb-4 animate-spin text-blue-500" />
              <p className="text-lg font-medium text-white">Parsing PSD file...</p>
              <p className="mt-1 text-sm text-gray-400">This may take a moment for large files</p>
            </>
          ) : (
            <>
              <Upload size={48} className="mb-4 text-gray-500" />
              <p className="text-lg font-medium text-white">Drop a PSD file or click to upload</p>
              <p className="mt-1 text-sm text-gray-400">Accepts .psd files only</p>
            </>
          )}
        </div>

        {parseError && (
          <div className="mt-4 rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
            {parseError}
          </div>
        )}

        {claudeStatus === 'unavailable' && (
          <div className="mt-4 max-w-lg rounded-lg border border-yellow-800 bg-yellow-900/20 px-4 py-3 text-sm text-yellow-300">
            Claude CLI is not installed or not authenticated. Install it from{' '}
            <span className="font-mono text-yellow-200">npm install -g @anthropic-ai/claude-code</span>{' '}
            and run <span className="font-mono text-yellow-200">claude auth</span> to set up.
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".psd"
          onChange={onFileSelect}
          className="hidden"
          aria-hidden="true"
        />
      </div>
    );
  }

  // =========================================================================
  // Render: Editor State
  // =========================================================================

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-gray-200">
      {/* Toolbar */}
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-gray-800 bg-gray-900 px-4">
        <div className="flex items-center gap-2">
          <FileImage size={18} className="text-blue-500" />
          <span className="text-sm font-semibold text-white">MockDeskAI</span>
        </div>

        <div className="mx-2 h-5 w-px bg-gray-700" />

        <span className="max-w-[200px] truncate text-sm text-gray-300" title={psdDoc.fileName}>
          {psdDoc.fileName}
        </span>
        <span className="text-xs text-gray-500">
          {psdDoc.width} x {psdDoc.height}
        </span>

        <div className="flex-1" />

        {/* Connection status dot */}
        <div className="flex items-center gap-1.5">
          <div className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="text-xs text-gray-500">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        <button
          onClick={() => setShowLayers((s) => !s)}
          className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
            showLayers
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:bg-gray-800 hover:text-white'
          }`}
        >
          <Layers size={14} />
          Layers
        </button>

        <button
          onClick={() => handleExport('png')}
          className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
        >
          <Download size={14} />
          PNG
        </button>

        <button
          onClick={() => handleExport('jpg')}
          className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
        >
          <Download size={14} />
          JPG
        </button>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Center: Canvas + Chat */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Canvas */}
          <div className="flex flex-1 items-center justify-center overflow-auto bg-gray-950 p-4">
            <img
              src={psdDoc.compositeDataUrl}
              alt={`PSD composite: ${psdDoc.fileName}`}
              className="max-h-full max-w-full object-contain"
              style={{ imageRendering: 'auto', boxShadow: '0 0 40px rgba(0,0,0,0.5)' }}
            />
          </div>

          {/* Chat area */}
          <div className="shrink-0 border-t border-gray-800 bg-gray-900">
            {/* Edit history */}
            {editHistory.length > 0 && (
              <div className="max-h-48 overflow-y-auto border-b border-gray-800 px-4 py-2">
                {editHistory.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-2 py-2 text-sm">
                    <div className="mt-0.5 shrink-0">
                      {entry.status === 'streaming' && <Loader2 size={14} className="animate-spin text-blue-400" />}
                      {entry.status === 'applied' && <Check size={14} className="text-green-400" />}
                      {entry.status === 'failed' && <X size={14} className="text-red-400" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-200">{entry.prompt}</p>
                      {entry.response && (
                        <p className="mt-0.5 whitespace-pre-wrap text-gray-400">{entry.response}</p>
                      )}
                    </div>
                    {entry.status === 'applied' && (
                      <button
                        onClick={() => handleUndo(entry.id)}
                        className="shrink-0 rounded p-1 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
                      >
                        <Undo2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
                <div ref={historyEndRef} />
              </div>
            )}

            {/* Chat input */}
            <form onSubmit={handleChatSubmit} className="flex items-center gap-2 px-4 py-3">
              <input
                ref={chatInputRef}
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder='Describe an edit... e.g. "Change the headline to Summer Sale"'
                disabled={!isConnected}
                className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!chatInput.trim() || !isConnected}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        </div>

        {/* Right sidebar: Layers */}
        {showLayers && (
          <aside className="flex w-[250px] shrink-0 flex-col border-l border-gray-800 bg-gray-900">
            <div className="flex h-10 items-center border-b border-gray-800 px-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                Layers
              </h2>
              <span className="ml-auto text-xs text-gray-500">{psdDoc.layers.length}</span>
            </div>
            <nav className="flex-1 overflow-y-auto" aria-label="Layer list">
              {psdDoc.layers.map((layer) => (
                <div
                  key={layer.id}
                  className="flex items-center gap-2 border-b border-gray-800/50 py-2 hover:bg-gray-800/50"
                  style={{ paddingLeft: `${12 + (layer.depth || 0) * 16}px`, paddingRight: '12px' }}
                >
                  <button
                    onClick={() => toggleLayerVisibility(layer.id, layer.visible)}
                    className="shrink-0 text-gray-400 transition-colors hover:text-white"
                  >
                    {layer.visible
                      ? <Eye size={14} />
                      : <EyeOff size={14} className="text-gray-600" />
                    }
                  </button>
                  {layerTypeIcon(layer.type)}
                  <span
                    className={`flex-1 truncate text-sm ${layer.visible ? 'text-gray-200' : 'text-gray-500'}`}
                    title={layer.name}
                  >
                    {layer.name}
                  </span>
                </div>
              ))}
            </nav>
          </aside>
        )}
      </div>
    </div>
  );
}
