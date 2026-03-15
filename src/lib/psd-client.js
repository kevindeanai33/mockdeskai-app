/**
 * PSD Client — interface between React and the Web Worker
 *
 * Promise-based API for PSD operations.
 * Ported from mockdeskai-web/src/lib/psd-client.ts
 */

let worker = null;
let messageId = 0;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('../workers/psd-worker.js', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e) => {
      const { id, type, error, ...data } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (type === 'error') {
        p.reject(new Error(error));
      } else {
        p.resolve(data);
      }
    };
  }
  return worker;
}

function send(msg, transfer) {
  return new Promise((resolve, reject) => {
    const id = String(++messageId);
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...msg, id }, transfer || []);
  });
}

export async function parsePsd(file) {
  const buffer = (file instanceof ArrayBuffer) ? file
    : (typeof file.arrayBuffer === 'function') ? await file.arrayBuffer()
    : file;
  const result = await send({ type: 'parse', buffer }, [buffer]);
  return {
    width: result.width,
    height: result.height,
    layers: result.layers,
    compositeRgba: result.composite,
  };
}

export async function editPsd(command) {
  const result = await send({ type: 'edit', command });
  return result.composite;
}

export async function undoPsd() {
  const result = await send({ type: 'undo' });
  return result.composite;
}

export async function exportPsd(format, quality) {
  const result = await send({ type: 'export', format, quality });
  return result.buffer;
}

export async function renameLayer(layerId, newName) {
  const result = await send({ type: 'rename', layerId, newName });
  return result;
}

export async function deleteLayer(layerId) {
  const result = await send({ type: 'delete', layerId });
  return result;
}

export async function getComposite() {
  const result = await send({ type: 'composite' });
  return result.composite;
}

/**
 * Convert RGBA ArrayBuffer to a data URL for display.
 */
export function rgbaToDataUrl(rgba, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Convert RGBA ArrayBuffer to a Blob for downloading.
 */
export async function rgbaToBlob(rgba, width, height, format = 'image/png', quality = 0.92) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
  ctx.putImageData(imageData, 0, 0);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), format, quality);
  });
}
