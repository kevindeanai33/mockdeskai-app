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
// Track layers whose text has been modified (need re-rendering in composite)
const modifiedTextLayers = new Set();

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'parse': handleParse(msg); break;
      case 'edit': handleEdit(msg); break;
      case 'undo': handleUndo(msg); break;
      case 'export': handleExport(msg); break;
      case 'composite': handleComposite(msg); break;
      case 'rename': handleRename(msg); break;
      case 'delete': handleDelete(msg); break;
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
  layerIndex = new Map();
  modifiedTextLayers.clear();
  buildLayerIndex(activePsd.children || []);
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
  // Support both ID-based (UI clicks) and name-based (AI commands) lookups
  const layer = command.id
    ? findLayerById(command.id)
    : findLayerByName(activePsd.children || [], command.layer);
  if (!layer) throw new Error(`Layer '${command.id || command.layer}' not found`);

  // Store the layer ref key for undo (prefer ID, fall back to name)
  const layerKey = command.id || command.layer;
  const lookupForUndo = command.id ? 'id' : 'name';

  switch (command.action) {
    case 'set_text': {
      if (!layer.text) throw new Error(`Layer '${layerKey}' is not a text layer`);
      const oldText = layer.text.text;
      // Save original canvas for undo (only on first edit)
      if (!layer._originalCanvas && layer.canvas) {
        layer._originalCanvas = layer.canvas;
      }
      undoStack.push({ type: 'text', layerKey, lookupForUndo, oldValue: oldText });
      layer.text.text = command.value || '';
      // Re-render the text layer canvas so it shows in the composite
      rerenderTextLayer(layer);
      modifiedTextLayers.add(layer);
      break;
    }
    case 'set_visibility': {
      undoStack.push({ type: 'visibility', layerKey, lookupForUndo, oldValue: layer.hidden });
      layer.hidden = !command.visible;
      break;
    }
    case 'set_opacity': {
      undoStack.push({ type: 'opacity', layerKey, lookupForUndo, oldValue: layer.opacity });
      layer.opacity = (command.opacity ?? 255) / 255;
      break;
    }
    case 'set_text_color': {
      if (!layer.text) throw new Error(`Layer '${layerKey}' is not a text layer`);
      if (!layer._originalCanvas && layer.canvas) layer._originalCanvas = layer.canvas;
      const oldColor = layer.text.style?.fillColor || null;
      undoStack.push({ type: 'text_color', layerKey, lookupForUndo, oldValue: oldColor });
      // Parse hex color to RGB
      const hex = (command.color || '#ffffff').replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      if (!layer.text.style) layer.text.style = {};
      layer.text.style.fillColor = { r, g, b };
      // Also update style runs if they exist
      if (layer.text.styleRuns) {
        for (const run of layer.text.styleRuns) {
          if (run.style) run.style.fillColor = { r, g, b };
        }
      }
      rerenderTextLayer(layer);
      modifiedTextLayers.add(layer);
      break;
    }
    case 'set_font_size': {
      if (!layer.text) throw new Error(`Layer '${layerKey}' is not a text layer`);
      if (!layer._originalCanvas && layer.canvas) layer._originalCanvas = layer.canvas;
      const oldSize = layer.text.style?.fontSize || 24;
      undoStack.push({ type: 'font_size', layerKey, lookupForUndo, oldValue: oldSize });
      if (!layer.text.style) layer.text.style = {};
      layer.text.style.fontSize = command.fontSize;
      if (layer.text.styleRuns) {
        for (const run of layer.text.styleRuns) {
          if (run.style) run.style.fontSize = command.fontSize;
        }
      }
      rerenderTextLayer(layer);
      modifiedTextLayers.add(layer);
      break;
    }
    case 'set_font': {
      if (!layer.text) throw new Error(`Layer '${layerKey}' is not a text layer`);
      if (!layer._originalCanvas && layer.canvas) layer._originalCanvas = layer.canvas;
      const oldFont = layer.text.style?.font?.name || 'Arial';
      undoStack.push({ type: 'font', layerKey, lookupForUndo, oldValue: oldFont });
      if (!layer.text.style) layer.text.style = {};
      if (!layer.text.style.font) layer.text.style.font = {};
      layer.text.style.font.name = command.fontName;
      if (layer.text.styleRuns) {
        for (const run of layer.text.styleRuns) {
          if (run.style) {
            if (!run.style.font) run.style.font = {};
            run.style.font.name = command.fontName;
          }
        }
      }
      rerenderTextLayer(layer);
      modifiedTextLayers.add(layer);
      break;
    }
    case 'move_layer': {
      const oldLeft = layer.left ?? 0;
      const oldTop = layer.top ?? 0;
      undoStack.push({ type: 'move', layerKey, lookupForUndo, oldValue: { left: oldLeft, top: oldTop } });
      if (command.x !== undefined) layer.left = command.x;
      if (command.y !== undefined) layer.top = command.y;
      // Update right/bottom to maintain dimensions
      const w = (layer.right ?? 0) - oldLeft;
      const h = (layer.bottom ?? 0) - oldTop;
      layer.right = (layer.left ?? 0) + w;
      layer.bottom = (layer.top ?? 0) + h;
      break;
    }
    case 'resize_layer': {
      if (!layer.text) throw new Error('Resize only supported for text layers currently');
      const oldBounds = { left: layer.left, top: layer.top, right: layer.right, bottom: layer.bottom };
      undoStack.push({ type: 'resize', layerKey, lookupForUndo, oldValue: oldBounds });
      if (command.width !== undefined) layer.right = (layer.left ?? 0) + command.width;
      if (command.height !== undefined) layer.bottom = (layer.top ?? 0) + command.height;
      if (!layer._originalCanvas && layer.canvas) layer._originalCanvas = layer.canvas;
      rerenderTextLayer(layer);
      modifiedTextLayers.add(layer);
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
  const layer = entry.lookupForUndo === 'id'
    ? findLayerById(entry.layerKey)
    : findLayerByName(activePsd.children || [], entry.layerKey);
  if (!layer) throw new Error('Undo target layer not found');

  switch (entry.type) {
    case 'text':
      if (layer.text) {
        layer.text.text = entry.oldValue;
        // Re-render with old text, or restore original canvas if reverting to original
        if (layer._originalCanvas && entry.oldValue === layer._originalText) {
          layer.canvas = layer._originalCanvas;
          modifiedTextLayers.delete(layer);
        } else {
          rerenderTextLayer(layer);
        }
      }
      break;
    case 'visibility': layer.hidden = entry.oldValue; break;
    case 'opacity': layer.opacity = entry.oldValue; break;
    case 'text_color':
      if (layer.text) {
        if (!layer.text.style) layer.text.style = {};
        layer.text.style.fillColor = entry.oldValue;
        if (layer.text.styleRuns) {
          for (const run of layer.text.styleRuns) {
            if (run.style) run.style.fillColor = entry.oldValue;
          }
        }
        rerenderTextLayer(layer);
      }
      break;
    case 'font_size':
      if (layer.text) {
        if (!layer.text.style) layer.text.style = {};
        layer.text.style.fontSize = entry.oldValue;
        if (layer.text.styleRuns) {
          for (const run of layer.text.styleRuns) { if (run.style) run.style.fontSize = entry.oldValue; }
        }
        rerenderTextLayer(layer);
      }
      break;
    case 'font':
      if (layer.text) {
        if (!layer.text.style) layer.text.style = {};
        if (!layer.text.style.font) layer.text.style.font = {};
        layer.text.style.font.name = entry.oldValue;
        if (layer.text.styleRuns) {
          for (const run of layer.text.styleRuns) {
            if (run.style) { if (!run.style.font) run.style.font = {}; run.style.font.name = entry.oldValue; }
          }
        }
        rerenderTextLayer(layer);
      }
      break;
    case 'move':
      layer.left = entry.oldValue.left;
      layer.top = entry.oldValue.top;
      layer.right = entry.oldValue.left + ((layer.right ?? 0) - (layer.left ?? 0));
      layer.bottom = entry.oldValue.top + ((layer.bottom ?? 0) - (layer.top ?? 0));
      break;
    case 'resize':
      layer.left = entry.oldValue.left;
      layer.top = entry.oldValue.top;
      layer.right = entry.oldValue.right;
      layer.bottom = entry.oldValue.bottom;
      if (layer.text) rerenderTextLayer(layer);
      break;
  }

  const composite = renderComposite();
  self.postMessage({ id: msg.id, type: 'undone', composite }, composite ? [composite] : []);
}

function handleRename(msg) {
  if (!activePsd) throw new Error('No PSD loaded');
  const layer = findLayerById(msg.layerId);
  if (!layer) throw new Error(`Layer '${msg.layerId}' not found`);
  const oldName = layer.name;
  layer.name = msg.newName;
  const layers = extractLayerInfo(activePsd.children || []);
  self.postMessage({ id: msg.id, type: 'renamed', oldName, newName: msg.newName, layers });
}

function handleDelete(msg) {
  if (!activePsd) throw new Error('No PSD loaded');

  function removeFromChildren(children, targetId, parentPath) {
    if (!children) return false;
    for (let i = 0; i < children.length; i++) {
      const id = parentPath ? `${parentPath}/${i}` : `${i}`;
      if (id === targetId) {
        const removed = children.splice(i, 1)[0];
        undoStack.push({ type: 'delete', layerKey: targetId, lookupForUndo: 'id', parentChildren: children, index: i, layer: removed });
        return true;
      }
      if (children[i].children) {
        if (removeFromChildren(children[i].children, targetId, id)) return true;
      }
    }
    return false;
  }

  if (!removeFromChildren(activePsd.children || [], msg.layerId, '')) {
    throw new Error(`Layer '${msg.layerId}' not found`);
  }

  layerIndex = new Map();
  buildLayerIndex(activePsd.children || []);
  const layers = extractLayerInfo(activePsd.children || []);
  const composite = renderComposite();
  self.postMessage({ id: msg.id, type: 'deleted', layers, composite }, composite ? [composite] : []);
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

// Build a flat index mapping unique IDs to layer references
let layerIndex = new Map();

function buildLayerIndex(layers, parentPath = '', depth = 0) {
  if (!layers) return;
  const nameCount = {};
  for (const layer of layers) {
    const name = layer.name || 'Unnamed';
    nameCount[name] = (nameCount[name] || 0) + 1;
    const suffix = nameCount[name] > 1 ? `#${nameCount[name]}` : '';
    // But we need a forward pass to know duplicates, so use index instead
  }
  // Use index-based unique ID
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const id = parentPath ? `${parentPath}/${i}` : `${i}`;
    layerIndex.set(id, layer);
    if (layer.children) {
      buildLayerIndex(layer.children, id, depth + 1);
    }
  }
}

function findLayerById(id) {
  return layerIndex.get(id) || null;
}

// Legacy: find by name (used by AI commands which reference layer names)
function findLayerByName(layers, name) {
  const trimmed = name.trim();
  for (const layer of layers) {
    if (layer.name === name || layer.name?.trim() === trimmed) return layer;
    if (layer.children) {
      const found = findLayerByName(layer.children, name);
      if (found) return found;
    }
  }
  return null;
}

function extractLayerInfo(layers, depth = 0, parentPath = '') {
  const result = [];
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const isGroup = !!layer.children;
    const isText = !!layer.text;
    const id = parentPath ? `${parentPath}/${i}` : `${i}`;

    const info = {
      id,
      name: layer.name || 'Unnamed',
      type: isGroup ? 'group' : isText ? 'text' : 'pixel',
      visible: !layer.hidden,
      opacity: Math.round((layer.opacity ?? 1) * 255),
      depth,
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
    if (layer.children) result.push(...extractLayerInfo(layer.children, depth + 1, id));
  }
  return result;
}

/**
 * Re-render a text layer's canvas with the current text content.
 * Uses the font/size/color metadata from the PSD to approximate the rendering.
 * Won't be pixel-perfect to Photoshop, but good enough for proofing.
 */
function rerenderTextLayer(layer) {
  if (!layer.text || !layer.canvas) return;

  const text = layer.text.text || '';
  const style = layer.text.style || {};
  const w = (layer.right ?? 0) - (layer.left ?? 0);
  const h = (layer.bottom ?? 0) - (layer.top ?? 0);

  if (w <= 0 || h <= 0) return;

  // Save original text for undo detection
  if (!layer._originalText) {
    layer._originalText = layer._originalCanvas
      ? undefined  // already saved
      : layer.text.text;
  }

  // Extract font info
  let fontSize = style.fontSize || 24;
  let fontName = style.font?.name || 'Arial';
  // Clean up font name for CSS (remove PostScript suffixes)
  fontName = fontName.replace(/-Bold$|-Regular$|-Italic$|-Light$|-Medium$|-Semibold$/i, '');

  // Determine font weight from style or font name
  let fontWeight = 'normal';
  if (style.fauxBold || /bold/i.test(style.font?.name || '')) fontWeight = 'bold';

  let fontStyle = 'normal';
  if (style.fauxItalic || /italic|oblique/i.test(style.font?.name || '')) fontStyle = 'italic';

  // Extract color from text style runs or layer style
  let fillColor = 'white';
  if (style.fillColor) {
    const c = style.fillColor;
    if (c.r !== undefined) {
      fillColor = `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
    }
  }

  // Also check paragraph style runs for per-run colors
  const styleRuns = layer.text.styleRuns || [];
  if (styleRuns.length > 0 && styleRuns[0].style?.fillColor) {
    const c = styleRuns[0].style.fillColor;
    if (c.r !== undefined) {
      fillColor = `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
    }
    if (styleRuns[0].style?.fontSize) {
      fontSize = styleRuns[0].style.fontSize;
    }
    if (styleRuns[0].style?.font?.name) {
      fontName = styleRuns[0].style.font.name.replace(/-Bold$|-Regular$|-Italic$|-Light$|-Medium$|-Semibold$/i, '');
    }
  }

  // Create a new canvas for this layer
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // Set up text rendering
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = fillColor;
  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px "${fontName}", Arial, sans-serif`;
  ctx.textBaseline = 'top';

  // Check text justification
  const paragraphStyle = layer.text.paragraphStyle || {};
  const justify = paragraphStyle.justification || 'left';
  if (justify === 'center') {
    ctx.textAlign = 'center';
  } else if (justify === 'right') {
    ctx.textAlign = 'right';
  } else {
    ctx.textAlign = 'left';
  }

  // Word wrap and render
  const lines = wordWrap(ctx, text, w);
  const lineHeight = fontSize * 1.2;
  const xPos = justify === 'center' ? w / 2 : justify === 'right' ? w : 0;

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], xPos, i * lineHeight);
  }

  // Replace the layer canvas
  layer.canvas = canvas;
}

/**
 * Simple word wrap for canvas text rendering
 */
function wordWrap(ctx, text, maxWidth) {
  // Handle explicit newlines
  const paragraphs = text.split('\n');
  const allLines = [];

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      allLines.push('');
      continue;
    }

    const words = paragraph.split(/\s+/);
    let line = '';

    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && line) {
        allLines.push(line);
        line = word;
      } else {
        line = testLine;
      }
    }
    if (line) allLines.push(line);
  }

  return allLines.length > 0 ? allLines : [''];
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
