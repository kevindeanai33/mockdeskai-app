import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Upload,
  Eye,
  EyeOff,
  Type,
  Image as ImageIcon,
  FolderOpen,
  FolderClosed,
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
  ChevronRight,
  ChevronDown,
  ZoomIn,
  ZoomOut,
  Maximize,
  Trash2,
} from 'lucide-react';
import { parsePsd, editPsd, undoPsd, renameLayer, deleteLayer, rgbaToDataUrl, ensureLoaded } from '@/lib/psd-client';
import {
  buildPsdJsonContext,
  extractJsonCommands,
  containsJsonCommand,
  stripJsonCommandBlocks,
} from '@/services/psdJsonContext';
import { useWebSocket } from '@/hooks/useWebSocket';
import FileTree from './FileTree';

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function layerTypeIcon(type, isCollapsed) {
  switch (type) {
    case 'text': return <Type size={14} className="shrink-0 text-blue-400" />;
    case 'pixel': return <ImageIcon size={14} className="shrink-0 text-green-400" />;
    case 'group': return isCollapsed
      ? <FolderClosed size={14} className="shrink-0 text-yellow-400" />
      : <FolderOpen size={14} className="shrink-0 text-yellow-400" />;
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

function createTab(fileName, psdDoc, editHistory = []) {
  return {
    id: generateId(),
    fileName,
    psdDoc,
    editHistory,
    zoom: 1,
    panOffset: { x: 0, y: 0 },
    collapsedGroups: new Set(psdDoc ? psdDoc.layers.filter((l) => l.type === 'group').map((l) => l.id) : []),
    claudeSessionId: null,
  };
}

async function saveChatToServer(fileName, history) {
  try {
    const saveable = history.map(({ id, prompt, response, status, timestamp }) => ({ id, prompt, response, status, timestamp }));
    await fetch('/api/chats/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, history: saveable }),
    });
  } catch {}
}

async function loadChatFromServer(fileName) {
  try {
    const res = await fetch(`/api/chats/load?fileName=${encodeURIComponent(fileName)}`);
    const data = await res.json();
    return data.history || [];
  } catch {
    return [];
  }
}

export default function App() {
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [showLayers, setShowLayers] = useState(true);
  const [parseError, setParseError] = useState(null);
  const [claudeStatus, setClaudeStatus] = useState(null);

  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const canvasContainerRef = useRef(null);

  const streamingEntryRef = useRef(null);
  const streamingTextRef = useRef('');
  const streamingTabIdRef = useRef(null);
  const psdDocRef = useRef(null);

  const [renamingLayerId, setRenamingLayerId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef(null);

  const fileInputRef = useRef(null);
  const chatInputRef = useRef(null);
  const historyEndRef = useRef(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) || null;

  function updateTab(tabId, updates) {
    setTabs((prev) => prev.map((t) => t.id === tabId ? { ...t, ...updates } : t));
  }

  function updateActiveTab(updates) {
    if (!activeTabId) return;
    updateTab(activeTabId, updates);
  }

  useEffect(() => { psdDocRef.current = activeTab?.psdDoc || null; }, [activeTab?.psdDoc]);

  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeTab?.editHistory?.length]);

  const handleWsMessage = useCallback((event) => {
    switch (event.type) {
      case 'init':
        if (event.sessionId && streamingTabIdRef.current) {
          updateTab(streamingTabIdRef.current, { claudeSessionId: event.sessionId });
        }
        break;

      case 'message': {
        const text = event.text || '';
        streamingTextRef.current = text;
        if (streamingEntryRef.current && streamingTabIdRef.current) {
          const entryId = streamingEntryRef.current;
          const tabId = streamingTabIdRef.current;
          setTabs((prev) => prev.map((t) =>
            t.id === tabId
              ? { ...t, editHistory: t.editHistory.map((e) => e.id === entryId ? { ...e, response: text } : e) }
              : t
          ));
        }
        break;
      }

      case 'result': {
        if (event.sessionId && streamingTabIdRef.current) {
          updateTab(streamingTabIdRef.current, { claudeSessionId: event.sessionId });
        }
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
        if (streamingEntryRef.current && streamingTabIdRef.current) {
          const entryId = streamingEntryRef.current;
          const tabId = streamingTabIdRef.current;
          setTabs((prev) => prev.map((t) =>
            t.id === tabId
              ? { ...t, editHistory: t.editHistory.map((e) => e.id === entryId ? { ...e, response: event.error || 'Error occurred', status: 'failed' } : e) }
              : t
          ));
          streamingEntryRef.current = null;
          streamingTextRef.current = '';
          streamingTabIdRef.current = null;
        }
        break;

      case 'cancelled':
        if (streamingEntryRef.current && streamingTabIdRef.current) {
          const entryId = streamingEntryRef.current;
          const tabId = streamingTabIdRef.current;
          setTabs((prev) => prev.map((t) =>
            t.id === tabId
              ? { ...t, editHistory: t.editHistory.map((e) => e.id === entryId ? { ...e, response: streamingTextRef.current || 'Cancelled', status: 'failed' } : e) }
              : t
          ));
          streamingEntryRef.current = null;
          streamingTextRef.current = '';
          streamingTabIdRef.current = null;
        }
        break;
    }
  }, []);

  const { send, isConnected } = useWebSocket('/ws/claude', {
    onMessage: handleWsMessage,
    autoConnect: true,
  });

  const finalizeResponse = useCallback(async (responseText) => {
    const entryId = streamingEntryRef.current;
    const tabId = streamingTabIdRef.current;
    streamingEntryRef.current = null;
    streamingTextRef.current = '';
    streamingTabIdRef.current = null;

    if (!entryId || !tabId) return;

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
          setTabs((prev) => prev.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  psdDoc: t.psdDoc ? { ...t.psdDoc, compositeDataUrl: dataUrl } : null,
                  editHistory: t.editHistory.map((e) =>
                    e.id === entryId ? { ...e, response: explanation || `Applied ${commands.length} edit(s).`, status: 'applied' } : e
                  ),
                }
              : t
          ));
        } else {
          setTabs((prev) => prev.map((t) =>
            t.id === tabId
              ? { ...t, editHistory: t.editHistory.map((e) => e.id === entryId ? { ...e, response: explanation || `Applied ${commands.length} edit(s).`, status: 'applied' } : e) }
              : t
          ));
        }
      } catch (err) {
        setTabs((prev) => prev.map((t) =>
          t.id === tabId
            ? { ...t, editHistory: t.editHistory.map((e) => e.id === entryId ? { ...e, response: `Edit failed: ${err.message}`, status: 'failed' } : e) }
            : t
        ));
      }
    } else {
      setTabs((prev) => prev.map((t) =>
        t.id === tabId
          ? { ...t, editHistory: t.editHistory.map((e) => e.id === entryId ? { ...e, response: responseText, status: 'applied' } : e) }
          : t
      ));
    }

    setTabs((prev) => {
      const tab = prev.find((t) => t.id === tabId);
      if (tab && tab.psdDoc) {
        saveChatToServer(tab.psdDoc.fileName, tab.editHistory);
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    setClaudeStatus('checking');
    fetch('/api/status')
      .then((r) => r.json())
      .then((data) => {
        setClaudeStatus(data.claude?.available ? 'available' : 'unavailable');
      })
      .catch(() => setClaudeStatus('unavailable'));
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file.name.toLowerCase().endsWith('.psd')) {
      setParseError('Only .psd files are supported.');
      return;
    }

    const existing = tabs.find((t) => t.fileName === file.name);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }

    setIsLoading(true);
    setParseError(null);

    try {
      const doc = await parsePsd(file, file.name);
      const dataUrl = rgbaToDataUrl(doc.compositeRgba, doc.width, doc.height);

      const psdDoc = {
        width: doc.width,
        height: doc.height,
        layers: doc.layers,
        compositeDataUrl: dataUrl,
        fileName: file.name,
        rawBuffer: doc.rawBuffer,
      };

      const savedHistory = await loadChatFromServer(file.name);

      const tab = createTab(file.name, psdDoc, savedHistory);
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
      setIsLoading(false);
    } catch (err) {
      console.error('Failed to parse PSD:', err);
      setIsLoading(false);
      setParseError(err instanceof Error ? err.message : 'Failed to parse PSD file.');
    }
  }, [tabs]);

  const closeTab = useCallback((tabId) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === tabId);
      const next = prev.filter((t) => t.id !== tabId);
      if (tabId === activeTabId && next.length > 0) {
        const newIdx = Math.min(idx, next.length - 1);
        setActiveTabId(next[newIdx].id);
      } else if (next.length === 0) {
        setActiveTabId(null);
      }
      return next;
    });
  }, [activeTabId]);

  const onFileSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const toggleLayerVisibility = useCallback(async (layerId, currentlyVisible) => {
    if (!activeTab?.psdDoc) return;
    try {
      await ensureLoaded(activeTab.psdDoc.rawBuffer, activeTab.psdDoc.fileName);
      const rgba = await editPsd({
        action: 'set_visibility',
        id: layerId,
        visible: !currentlyVisible,
      });
      const dataUrl = rgbaToDataUrl(rgba, activeTab.psdDoc.width, activeTab.psdDoc.height);

      updateActiveTab({
        psdDoc: {
          ...activeTab.psdDoc,
          compositeDataUrl: dataUrl,
          layers: activeTab.psdDoc.layers.map((l) =>
            l.id === layerId ? { ...l, visible: !l.visible } : l
          ),
        },
      });
    } catch (err) {
      console.error('Failed to toggle visibility:', err);
    }
  }, [activeTab]);

  const handleLayerRename = useCallback(async (layerId, newName) => {
    if (!activeTab?.psdDoc || !newName.trim()) return;
    try {
      await ensureLoaded(activeTab.psdDoc.rawBuffer, activeTab.psdDoc.fileName);
      const result = await renameLayer(layerId, newName.trim());
      updateActiveTab({
        psdDoc: {
          ...activeTab.psdDoc,
          layers: result.layers,
        },
      });
    } catch (err) {
      console.error('Failed to rename layer:', err);
    }
    setRenamingLayerId(null);
    setRenameValue('');
  }, [activeTab]);

  const handleLayerDelete = useCallback(async (layerId) => {
    if (!activeTab?.psdDoc) return;
    try {
      await ensureLoaded(activeTab.psdDoc.rawBuffer, activeTab.psdDoc.fileName);
      const result = await deleteLayer(layerId);
      const dataUrl = rgbaToDataUrl(result.composite, activeTab.psdDoc.width, activeTab.psdDoc.height);
      updateActiveTab({
        psdDoc: {
          ...activeTab.psdDoc,
          layers: result.layers,
          compositeDataUrl: dataUrl,
        },
      });
    } catch (err) {
      console.error('Failed to delete layer:', err);
    }
  }, [activeTab]);

  const handleUndo = useCallback(async (entryId) => {
    if (!activeTab?.psdDoc) return;
    try {
      await ensureLoaded(activeTab.psdDoc.rawBuffer, activeTab.psdDoc.fileName);
      const rgba = await undoPsd();
      const dataUrl = rgbaToDataUrl(rgba, activeTab.psdDoc.width, activeTab.psdDoc.height);
      const newHistory = activeTab.editHistory.filter((e) => e.id !== entryId);
      updateActiveTab({
        psdDoc: { ...activeTab.psdDoc, compositeDataUrl: dataUrl },
        editHistory: newHistory,
      });
      saveChatToServer(activeTab.psdDoc.fileName, newHistory);
    } catch (err) {
      console.error('Failed to undo:', err);
    }
  }, [activeTab]);

  const spaceHeldRef = useRef(false);

  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        spaceHeldRef.current = true;
      }
    };
    const onKeyUp = (e) => {
      if (e.code === 'Space') {
        spaceHeldRef.current = false;
        isPanningRef.current = false;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (!activeTab?.psdDoc) return;
      e.preventDefault();
      const delta = -e.deltaY * 0.002;
      const newZoom = Math.min(Math.max((activeTab.zoom || 1) + (activeTab.zoom || 1) * delta, 0.05), 8);
      updateActiveTab({ zoom: newZoom });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [activeTab?.psdDoc, activeTab?.zoom]);

  const handleMouseDown = useCallback((e) => {
    if (e.button === 0 || e.button === 1) {
      e.preventDefault();
      isPanningRef.current = true;
      const offset = activeTab?.panOffset || { x: 0, y: 0 };
      panStartRef.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    }
  }, [activeTab?.panOffset]);

  const handleMouseMove = useCallback((e) => {
    if (!isPanningRef.current) return;
    updateActiveTab({
      panOffset: {
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      },
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  const resetView = useCallback(() => {
    updateActiveTab({ zoom: 1, panOffset: { x: 0, y: 0 } });
  }, []);

  const toggleGroupCollapse = useCallback((layerId) => {
    if (!activeTab) return;
    const next = new Set(activeTab.collapsedGroups);
    if (next.has(layerId)) next.delete(layerId);
    else next.add(layerId);
    updateActiveTab({ collapsedGroups: next });
  }, [activeTab]);

  const visibleLayers = activeTab?.psdDoc ? activeTab.psdDoc.layers.filter((layer) => {
    const parts = layer.id.split('/');
    for (let i = 1; i < parts.length; i++) {
      const ancestorId = parts.slice(0, i).join('/');
      if (activeTab.collapsedGroups.has(ancestorId)) return false;
    }
    return true;
  }) : [];

  const handleExport = useCallback(async (format) => {
    if (!activeTab?.psdDoc) return;
    const doc = activeTab.psdDoc;

    const img = new Image();
    img.src = doc.compositeDataUrl;
    await new Promise((resolve) => (img.onload = resolve));

    const canvas = document.createElement('canvas');
    canvas.width = doc.width;
    canvas.height = doc.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
    const ext = format === 'png' ? 'png' : 'jpg';
    const baseName = doc.fileName.replace(/\.psd$/i, '');

    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `${baseName}.${ext}`);
    }, mimeType, 0.92);
  }, [activeTab?.psdDoc]);

  const handleChatSubmit = useCallback((e) => {
    e.preventDefault();
    const prompt = chatInput.trim();
    if (!prompt || !activeTab?.psdDoc || !isConnected) return;

    const entryId = generateId();
    const doc = activeTab.psdDoc;

    const textLayers = doc.layers.filter((l) => l.type === 'text');
    const context = buildPsdJsonContext(doc.fileName, doc.layers, textLayers);
    const fullMessage = `${context}\n\nUser request: ${prompt}`;

    streamingEntryRef.current = entryId;
    streamingTextRef.current = '';
    streamingTabIdRef.current = activeTab.id;

    const newEntry = {
      id: entryId,
      prompt,
      response: '',
      status: 'streaming',
      timestamp: Date.now(),
    };

    updateActiveTab({
      editHistory: [...activeTab.editHistory, newEntry],
    });
    setChatInput('');

    send({
      type: 'start',
      message: fullMessage,
      sessionId: activeTab.claudeSessionId,
    });
  }, [chatInput, activeTab, isConnected, send]);

  const psdDoc = activeTab?.psdDoc || null;
  const editHistory = activeTab?.editHistory || [];
  const zoom = activeTab?.zoom || 1;
  const panOffset = activeTab?.panOffset || { x: 0, y: 0 };

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept=".psd"
      onChange={onFileSelect}
      className="hidden"
      aria-hidden="true"
    />
  );

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-gray-200">
      {fileInput}

      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-gray-800 bg-gray-900 px-4">
        <div className="flex items-center gap-2">
          <FileImage size={18} className="text-blue-500" />
          <span className="text-sm font-semibold text-white">MockDeskAI</span>
        </div>

        <div className="mx-2 h-5 w-px bg-gray-700" />

        {psdDoc ? (
          <>
            <span className="max-w-[200px] truncate text-sm text-gray-300" title={psdDoc.fileName}>
              {psdDoc.fileName}
            </span>
            <span className="text-xs text-gray-500">
              {psdDoc.width} x {psdDoc.height}
            </span>
          </>
        ) : (
          <span className="text-sm text-gray-500">No file open</span>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-1.5">
          <div className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="text-xs text-gray-500">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
        >
          <Upload size={14} />
          Open PSD
        </button>

        {psdDoc && (
          <>
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
          </>
        )}
      </header>

      {tabs.length > 0 && (
        <div className="flex h-8 shrink-0 items-end gap-0 border-b border-gray-800 bg-gray-900 overflow-x-auto">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`group flex h-full items-center gap-1.5 px-3 text-xs cursor-pointer border-b-2 transition-colors ${
                tab.id === activeTabId
                  ? 'bg-gray-800 text-white border-blue-500'
                  : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-gray-800/50'
              }`}
              onClick={() => setActiveTabId(tab.id)}
            >
              <span className="truncate max-w-[120px]">{tab.fileName}</span>
              <button
                className="ml-1 shrink-0 text-gray-600 hover:text-red-400 transition-colors"
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <FileTree onFileSelect={handleFile} />

        <div className="flex flex-1 flex-col overflow-hidden">
          <div
            ref={canvasContainerRef}
            className="relative flex-1 overflow-hidden bg-gray-950"
            onMouseDown={psdDoc ? handleMouseDown : undefined}
            onMouseMove={psdDoc ? handleMouseMove : undefined}
            onMouseUp={psdDoc ? handleMouseUp : undefined}
            onMouseLeave={psdDoc ? handleMouseUp : undefined}
            style={{ cursor: psdDoc ? (isPanningRef.current ? 'grabbing' : 'grab') : 'default' }}
          >
            {psdDoc ? (
              <>
                <div
                  className="absolute inset-0 flex items-center justify-center"
                  style={{
                    transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
                    transformOrigin: 'center center',
                  }}
                >
                  <img
                    src={psdDoc.compositeDataUrl}
                    alt={`PSD composite: ${psdDoc.fileName}`}
                    className="max-h-full max-w-full object-contain select-none"
                    style={{ imageRendering: 'auto', boxShadow: '0 0 40px rgba(0,0,0,0.5)' }}
                    draggable={false}
                  />
                </div>
                <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg bg-gray-900/80 px-2 py-1 backdrop-blur">
                  <button onClick={() => updateActiveTab({ zoom: Math.max(zoom - 0.25, 0.1) })} className="p-1 text-gray-400 hover:text-white">
                    <ZoomOut size={14} />
                  </button>
                  <span className="min-w-[3rem] text-center text-xs text-gray-400">{Math.round(zoom * 100)}%</span>
                  <button onClick={() => updateActiveTab({ zoom: Math.min(zoom + 0.25, 5) })} className="p-1 text-gray-400 hover:text-white">
                    <ZoomIn size={14} />
                  </button>
                  <button onClick={resetView} className="p-1 text-gray-400 hover:text-white" title="Reset view">
                    <Maximize size={14} />
                  </button>
                </div>
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex flex-col items-center justify-center px-12 py-16">
                  {isLoading ? (
                    <>
                      <Loader2 size={40} className="mb-3 animate-spin text-blue-500" />
                      <p className="text-sm font-medium text-white">Parsing PSD...</p>
                    </>
                  ) : (
                    <>
                      <FileImage size={40} className="mb-3 text-gray-700" />
                      <p className="text-sm font-medium text-gray-400">Open a PSD from the file tree</p>
                    </>
                  )}
                  {parseError && (
                    <p className="mt-3 text-xs text-red-400">{parseError}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-gray-800 bg-gray-900">
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

            <form onSubmit={handleChatSubmit} className="flex items-center gap-2 px-4 py-3">
              <input
                ref={chatInputRef}
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={psdDoc ? 'Describe an edit... e.g. "Change the headline to Summer Sale"' : 'Open a PSD file to start editing...'}
                disabled={!isConnected || !psdDoc}
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

        {showLayers && psdDoc && (
          <aside className="flex w-[250px] shrink-0 flex-col border-l border-gray-800 bg-gray-900">
            <div className="flex h-10 items-center border-b border-gray-800 px-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                Layers
              </h2>
              <span className="ml-auto text-xs text-gray-500">{psdDoc.layers.length}</span>
            </div>
            <nav className="flex-1 overflow-y-auto" aria-label="Layer list">
              {visibleLayers.map((layer) => {
                const isGroup = layer.type === 'group';
                const isCollapsed = activeTab.collapsedGroups.has(layer.id);
                const isRenaming = renamingLayerId === layer.id;

                return (
                  <div
                    key={layer.id}
                    className={`group/layer flex items-center gap-1.5 border-b border-gray-800/50 py-1.5 hover:bg-gray-800/50 ${isGroup ? 'bg-gray-900/50' : ''}`}
                    style={{ paddingLeft: `${8 + (layer.depth || 0) * 14}px`, paddingRight: '8px' }}
                  >
                    {isGroup ? (
                      <button
                        onClick={() => toggleGroupCollapse(layer.id)}
                        className="shrink-0 p-0.5 text-gray-500 transition-colors hover:text-white"
                      >
                        {isCollapsed
                          ? <ChevronRight size={12} />
                          : <ChevronDown size={12} />
                        }
                      </button>
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}

                    <button
                      onClick={() => toggleLayerVisibility(layer.id, layer.visible)}
                      className="shrink-0 text-gray-400 transition-colors hover:text-white"
                    >
                      {layer.visible
                        ? <Eye size={13} />
                        : <EyeOff size={13} className="text-gray-600" />
                      }
                    </button>

                    {layerTypeIcon(layer.type, isCollapsed)}

                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleLayerRename(layer.id, renameValue);
                          if (e.key === 'Escape') { setRenamingLayerId(null); setRenameValue(''); }
                        }}
                        onBlur={() => handleLayerRename(layer.id, renameValue)}
                        className="flex-1 min-w-0 rounded border border-blue-500 bg-gray-800 px-1 py-0 text-xs text-white outline-none"
                        autoFocus
                      />
                    ) : (
                      <span
                        className={`flex-1 truncate text-xs ${
                          isGroup
                            ? 'font-medium ' + (layer.visible ? 'text-gray-200' : 'text-gray-500')
                            : layer.visible ? 'text-gray-300' : 'text-gray-600'
                        }`}
                        title={layer.name}
                        onDoubleClick={() => {
                          setRenamingLayerId(layer.id);
                          setRenameValue(layer.name);
                        }}
                      >
                        {layer.name}
                      </span>
                    )}

                    <button
                      onClick={(e) => { e.stopPropagation(); handleLayerDelete(layer.id); }}
                      className="shrink-0 opacity-0 group-hover/layer:opacity-100 text-gray-600 hover:text-red-400 transition-all p-0.5"
                      title="Delete layer"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })}
            </nav>
          </aside>
        )}
      </div>
    </div>
  );
}
