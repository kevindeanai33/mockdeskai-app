/**
 * FileTree — Left sidebar showing workspace files
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Folder,
  FolderOpen,
  FileImage,
  File,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  HardDrive,
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

export default function FileTree({ onFileSelect }) {
  const [tree, setTree] = useState([]);
  const [workspace, setWorkspace] = useState('');
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [loading, setLoading] = useState(true);

  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/files');
      const data = await res.json();
      setTree(data.tree);
      setWorkspace(data.workspace);
      // Auto-expand root level directories
      const rootDirs = new Set(data.tree.filter((n) => n.type === 'directory').map((n) => n.path));
      setExpandedDirs(rootDirs);
    } catch (err) {
      console.error('Failed to load file tree:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadTree(); }, [loadTree]);

  const toggleDir = useCallback((dirPath) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }, []);

  const handleFileClick = useCallback(async (filePath) => {
    // Fetch the PSD file from workspace and pass to parent
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
      const blob = await res.blob();
      const file = new File([blob], filePath.split('/').pop() || filePath, { type: 'application/octet-stream' });
      onFileSelect(file);
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  }, [onFileSelect]);

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-gray-800 bg-gray-900">
      <div className="flex h-10 items-center border-b border-gray-800 px-3">
        <HardDrive size={13} className="mr-2 text-gray-500" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Files
        </h2>
        <button
          onClick={loadTree}
          className="ml-auto p-1 text-gray-500 transition-colors hover:text-white"
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto py-1" aria-label="File tree">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-gray-500">Loading...</div>
        ) : tree.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-500">
            No files yet. Open a PSD to get started.
          </div>
        ) : (
          tree.map((node) => (
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
    </aside>
  );
}
