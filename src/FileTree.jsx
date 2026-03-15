import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Folder,
  FolderOpen,
  FileImage,
  File,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Eye,
  EyeOff,
  FolderPlus,
  Upload,
  Search,
  X,
} from 'lucide-react';

function FileIcon({ ext }) {
  if (ext === '.psd') return <FileImage size={14} className="shrink-0 text-blue-400" />;
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') return <FileImage size={14} className="shrink-0 text-green-400" />;
  return <File size={14} className="shrink-0 text-gray-500" />;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function matchesSearch(node, query) {
  const q = query.toLowerCase();
  if (node.name.toLowerCase().includes(q)) return true;
  if (node.children) return node.children.some((c) => matchesSearch(c, q));
  return false;
}

function filterTree(nodes, query) {
  if (!query) return nodes;
  return nodes
    .filter((n) => matchesSearch(n, query))
    .map((n) => {
      if (!n.children) return n;
      return { ...n, children: filterTree(n.children, query) };
    });
}

function TreeNode({ node, depth = 0, onFileClick, expandedDirs, toggleDir }) {
  const isDir = node.type === 'directory';
  const isExpanded = expandedDirs.has(node.path);
  const isPsd = node.ext === '.psd';

  return (
    <>
      <div
        className={`flex items-center gap-1.5 py-1 hover:bg-gray-800/50 ${isPsd ? 'cursor-pointer' : ''}`}
        style={{ paddingLeft: `${8 + depth * 14}px`, paddingRight: '8px' }}
        onClick={() => {
          if (isDir) toggleDir(node.path);
          else if (isPsd) onFileClick(node.path);
        }}
      >
        {isDir ? (
          <>
            <button className="shrink-0 p-0.5 text-gray-500">
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            {isExpanded
              ? <FolderOpen size={14} className="shrink-0 text-yellow-400" />
              : <Folder size={14} className="shrink-0 text-yellow-400" />
            }
          </>
        ) : (
          <>
            <span className="w-4 shrink-0" />
            <FileIcon ext={node.ext} />
          </>
        )}
        <span className={`flex-1 truncate text-xs ${isPsd ? 'text-gray-200 font-medium' : 'text-gray-400'}`}>
          {node.name}
        </span>
        {!isDir && node.size && (
          <span className="shrink-0 text-[10px] text-gray-600">{formatSize(node.size)}</span>
        )}
      </div>
      {isDir && isExpanded && node.children?.map((child) => (
        <TreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          onFileClick={onFileClick}
          expandedDirs={expandedDirs}
          toggleDir={toggleDir}
        />
      ))}
    </>
  );
}

function UploadModal({ onClose, onUploadDone }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const doUpload = async (file) => {
    setUploading(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buf).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );
      const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, data: base64 }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Upload failed');
      }
      onUploadDone();
      onClose();
    } catch (err) {
      setError(err.message);
    }
    setUploading(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) doUpload(file);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) doUpload(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-96 rounded-lg bg-gray-900 border border-gray-700 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Upload File</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <div
          className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
            dragging ? 'border-blue-500 bg-blue-500/10' : 'border-gray-700 hover:border-gray-500'
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          style={{ cursor: 'pointer' }}
        >
          <Upload size={28} className="mb-2 text-gray-500" />
          <p className="text-xs text-gray-400">Drop a file here</p>
          <p className="text-[10px] text-gray-600 mt-1">or click to choose files</p>
          <p className="text-[10px] text-gray-600 mt-1">.psd, .png, .jpg</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".psd,.png,.jpg,.jpeg"
          className="hidden"
          onChange={handleFileChange}
        />
        {uploading && <p className="mt-3 text-xs text-blue-400">Uploading...</p>}
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}

export default function FileTree({ onFileSelect }) {
  const [tree, setTree] = useState([]);
  const [workspace, setWorkspace] = useState('');
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [creatingDir, setCreatingDir] = useState(false);
  const [newDirName, setNewDirName] = useState('');
  const newDirRef = useRef(null);

  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/files');
      const data = await res.json();
      setTree(data.tree);
      setWorkspace(data.workspace);
      const rootDirs = new Set(data.tree.filter((n) => n.type === 'directory').map((n) => n.path));
      setExpandedDirs(rootDirs);
    } catch (err) {
      console.error('Failed to load file tree:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadTree(); }, [loadTree]);

  useEffect(() => {
    if (creatingDir && newDirRef.current) newDirRef.current.focus();
  }, [creatingDir]);

  const toggleDir = useCallback((dirPath) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }, []);

  const handleFileClick = useCallback(async (filePath) => {
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
      const blob = await res.blob();
      const file = new File([blob], filePath.split('/').pop() || filePath, { type: 'application/octet-stream' });
      onFileSelect(file);
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  }, [onFileSelect]);

  const handleCreateDir = async () => {
    const name = newDirName.trim();
    if (!name) { setCreatingDir(false); return; }
    try {
      await fetch('/api/files/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      setCreatingDir(false);
      setNewDirName('');
      loadTree();
    } catch (err) {
      console.error('Failed to create directory:', err);
    }
  };

  const filteredTree = showHidden ? filterTree(tree, searchQuery) : filterTree(
    tree.filter((n) => !n.name.startsWith('.')),
    searchQuery
  );

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-gray-800 bg-gray-900">
      <div className="flex h-10 items-center border-b border-gray-800 px-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Explorer</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setShowHidden((s) => !s)}
            className="p-1 text-gray-500 transition-colors hover:text-white"
            title={showHidden ? 'Hide dot-folders' : 'Show dot-folders'}
          >
            {showHidden ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
          <button
            onClick={() => { setCreatingDir(true); setNewDirName(''); }}
            className="p-1 text-gray-500 transition-colors hover:text-white"
            title="New folder"
          >
            <FolderPlus size={12} />
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className="p-1 text-gray-500 transition-colors hover:text-white"
            title="Upload file"
          >
            <Upload size={12} />
          </button>
          <button
            onClick={loadTree}
            className="p-1 text-gray-500 transition-colors hover:text-white"
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      <div className="px-2 py-1.5 border-b border-gray-800">
        <div className="flex items-center gap-1.5 rounded bg-gray-800 px-2 py-1">
          <Search size={11} className="shrink-0 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files..."
            className="flex-1 bg-transparent text-xs text-gray-300 placeholder-gray-600 outline-none"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-gray-500 hover:text-white">
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      <div className="px-2 py-1.5 border-b border-gray-800">
        <button
          onClick={() => setShowUpload(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded bg-blue-600 px-2 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500"
        >
          <Upload size={12} />
          Upload
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-1" aria-label="File tree">
        {creatingDir && (
          <div className="flex items-center gap-1.5 px-2 py-1">
            <FolderPlus size={14} className="shrink-0 text-yellow-400" />
            <input
              ref={newDirRef}
              type="text"
              value={newDirName}
              onChange={(e) => setNewDirName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateDir();
                if (e.key === 'Escape') { setCreatingDir(false); setNewDirName(''); }
              }}
              onBlur={handleCreateDir}
              placeholder="folder name"
              className="flex-1 rounded border border-blue-500 bg-gray-800 px-1.5 py-0.5 text-xs text-white placeholder-gray-600 outline-none"
            />
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-gray-500">Loading...</div>
        ) : filteredTree.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-500">
            {searchQuery ? 'No matches found.' : 'No files yet. Upload a PSD to get started.'}
          </div>
        ) : (
          filteredTree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              onFileClick={handleFileClick}
              expandedDirs={expandedDirs}
              toggleDir={toggleDir}
            />
          ))
        )}
      </nav>
      <div className="border-t border-gray-800 px-3 py-2">
        <p className="truncate text-[10px] text-gray-600" title={workspace}>
          ~/MockDeskAI
        </p>
      </div>
      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onUploadDone={loadTree}
        />
      )}
    </aside>
  );
}
