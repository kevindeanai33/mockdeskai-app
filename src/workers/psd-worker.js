/**
 * PSD Web Worker — powered by ag-psd
 *
 * Handles all PSD operations off the main thread.
 * Ported from mockdeskai-web/src/workers/psd-worker.ts
 */

import { readPsd, writePsd, initializeCanvas } from 'ag-psd';

// Initialize ag-psd with OffscreenCanvas for Web Worker environment
initializeCanvas(
  (width, height) => new OffscreenCanvas(width, height),
  (width, height) => new ImageData(width, height)
);

let activePsd = null;
let undoStack = [];

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'parse': handleParse(msg); break;
      case 'edit': handleEdit(msg); break;
      case 'undo': handleUndo(msg); break;
      case 'export': handleExport(msg); break;
      case 'composite': handleComposite(msg); break;
    }
  } catch (err) {
    self.postMessage({
      id: msg.id,
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

function handleParse(msg) {
  const buffer = new Uint8Array(msg.buffer);
  activePsd = readPsd(buffer, {
    skipCompositeImageData: false,
    skipLayerImageData: false,
    skipThumbnail: true,
  });

  undoStack = [];
  const layers = extractLayerInfo(activePsd.children || []);
  const composite = renderComposite();

  self.postMessage({
    id: msg.id,
    type: 'parsed',
    width: activePsd.width,
    height: activePsd.height,
    layers,
    composite,
  }, composite ? [composite] : []);
}

function handleEdit(msg) {
  if (!activePsd) throw new Error('No PSD loaded');

  const { command } = msg;
  const layer = findLayer(activePsd.children || [], command.layer);
  if (!layer) throw new Error(`Layer '${command.layer}' not found`);

  switch (command.action) {
    case 'set_text': {
      if (!layer.text) throw new Error(`Layer '${command.layer}' is not a text layer`);
      undoStack.push({ type: 'text', layerPath: command.layer, oldValue: layer.text.text });
      layer.text.text = command.value || '';
      break;
    }
    case 'set_visibility': {
      undoStack.push({ type: 'visibility', layerPath: command.layer, oldValue: layer.hidden });
      layer.hidden = !command.visible;
      break;
    }
    case 'set_opacity': {
      undoStack.push({ type: 'opacity', layerPath: command.layer, oldValue: layer.opacity });
      layer.opacity = (command.opacity ?? 255) / 255;
      break;
    }
    case 'set_text_color': {
      if (!layer.text) throw new Error(`Layer '${command.layer}' is not a text layer`);
      // TODO: parse command.color hex and apply to text style
      break;
    }
    default:
      throw new Error(`Unknown action: ${command.action}`);
  }

  const composite = renderComposite();
  self.postMessage({ id: msg.id, type: 'edited', composite }, composite ? [composite] : []);
}

function handleUndo(msg) {
  if (!activePsd) throw new Error('No PSD loaded');
  if (undoStack.length === 0) throw new Error('Nothing to undo');

  const entry = undoStack.pop();
  const layer = findLayer(activePsd.children || [], entry.layerPath);
  if (!layer) throw new Error('Undo target layer not found');

  switch (entry.type) {
    case 'text': if (layer.text) layer.text.text = entry.oldValue; break;
    case 'visibility': layer.hidden = entry.oldValue; break;
    case 'opacity': layer.opacity = entry.oldValue; break;
  }

  const composite = renderComposite();
  self.postMessage({ id: msg.id, type: 'undone', composite }, composite ? [composite] : []);
}

function handleExport(msg) {
  if (!activePsd) throw new Error('No PSD loaded');

  if (msg.format === 'psd') {
    const buffer = writePsd(activePsd);
    self.postMessage({ id: msg.id, type: 'exported', format: 'psd', buffer }, [buffer]);
    return;
  }

  const composite = renderComposite();
  if (!composite) throw new Error('Failed to render composite');
  self.postMessage({ id: msg.id, type: 'exported', format: msg.format, buffer: composite }, [composite]);
}

function handleComposite(msg) {
  if (!activePsd) throw new Error('No PSD loaded');
  const composite = renderComposite();
  self.postMessage({ id: msg.id, type: 'composited', composite }, composite ? [composite] : []);
}

function findLayer(layers, name) {
  const trimmed = name.trim();
  for (const layer of layers) {
    if (layer.name === name || layer.name?.trim() === trimmed) return layer;
    if (layer.children) {
      const found = findLayer(layer.children, name);
      if (found) return found;
    }
  }
  return null;
}

function extractLayerInfo(layers) {
  const result = [];
  for (const layer of layers) {
    const isGroup = !!layer.children;
    const isText = !!layer.text;

    const info = {
      name: layer.name || 'Unnamed',
      type: isGroup ? 'group' : isText ? 'text' : 'pixel',
      visible: !layer.hidden,
      opacity: Math.round((layer.opacity ?? 1) * 255),
      left: layer.left ?? 0,
      top: layer.top ?? 0,
      width: (layer.right ?? 0) - (layer.left ?? 0),
      height: (layer.bottom ?? 0) - (layer.top ?? 0),
    };

    if (isText && layer.text) {
      info.textContent = layer.text.text;
      if (layer.text.style) {
        info.fontName = layer.text.style.font?.name;
        info.fontSize = layer.text.style.fontSize;
      }
    }

    result.push(info);
    if (layer.children) result.push(...extractLayerInfo(layer.children));
  }
  return result;
}

function renderComposite() {
  if (!activePsd) return null;

  const w = activePsd.width;
  const h = activePsd.height;
  const outCanvas = new OffscreenCanvas(w, h);
  const ctx = outCanvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);

  function drawLayers(layers) {
    if (!layers) return;
    for (const layer of layers) {
      if (layer.hidden) continue;
      if (layer.children) {
        drawLayers(layer.children);
      } else if (layer.canvas) {
        const opacity = layer.opacity ?? 1;
        ctx.globalAlpha = opacity;
        ctx.drawImage(layer.canvas, layer.left ?? 0, layer.top ?? 0);
        ctx.globalAlpha = 1;
      }
    }
  }

  drawLayers(activePsd.children);
  const imageData = ctx.getImageData(0, 0, w, h);
  return imageData.data.buffer;
}
