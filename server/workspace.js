/**
 * Workspace Manager
 *
 * Creates and manages the MockDeskAI workspace directory.
 * Sets up .claude/ folder with CLAUDE.md and skills for Claude CLI context.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const WORKSPACE_DIR = path.join(os.homedir(), 'MockDeskAI');
const CLAUDE_DIR = path.join(WORKSPACE_DIR, '.claude');
const EXPORTS_DIR = path.join(WORKSPACE_DIR, 'Exports');

const CLAUDE_MD = `# MockDeskAI Workspace

You are assisting a sales rep with PSD design proofing. The user uploads PSD mockup files and asks you to make edits using JSON commands.

## Available Commands

Respond with JSON code blocks to modify the PSD:

\`\`\`json
{ "action": "set_text", "layer": "Layer Name", "value": "New Text" }
{ "action": "set_visibility", "layer": "Layer Name", "visible": false }
{ "action": "set_opacity", "layer": "Layer Name", "opacity": 50 }
\`\`\`

## Rules
- Layer names must match exactly (case-sensitive)
- Multiple commands go in a JSON array: [{ ... }, { ... }]
- Keep explanations to 1 sentence
- For questions about layers, answer without generating commands
- The user is a sales rep, not a designer — use plain language
`;

/**
 * Initialize the workspace directory structure
 */
function initWorkspace() {
  // Create directories
  for (const dir of [WORKSPACE_DIR, CLAUDE_DIR, EXPORTS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Write CLAUDE.md if it doesn't exist
  const claudeMdPath = path.join(WORKSPACE_DIR, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdPath)) {
    fs.writeFileSync(claudeMdPath, CLAUDE_MD, 'utf-8');
  }

  // Write .claude/settings.json if it doesn't exist
  const settingsPath = path.join(CLAUDE_DIR, 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(settingsPath, JSON.stringify({
      permissions: {
        allow: ["Read", "Write", "Edit"],
        deny: ["Bash"]
      }
    }, null, 2), 'utf-8');
  }

  return WORKSPACE_DIR;
}

/**
 * Read the workspace file tree (PSD files and exports)
 */
function getFileTree(dir = WORKSPACE_DIR, depth = 0, maxDepth = 3) {
  if (depth > maxDepth || !fs.existsSync(dir)) return [];

  const entries = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });

  // Sort: directories first, then files, alphabetical
  items.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const item of items) {
    // Skip hidden files/dirs except .claude
    if (item.name.startsWith('.') && item.name !== '.claude') continue;

    const fullPath = path.join(dir, item.name);
    const relativePath = path.relative(WORKSPACE_DIR, fullPath);

    if (item.isDirectory()) {
      entries.push({
        name: item.name,
        path: relativePath,
        type: 'directory',
        children: getFileTree(fullPath, depth + 1, maxDepth),
      });
    } else {
      const ext = path.extname(item.name).toLowerCase();
      // Only show relevant file types
      if (['.psd', '.png', '.jpg', '.jpeg', '.md'].includes(ext)) {
        const stats = fs.statSync(fullPath);
        entries.push({
          name: item.name,
          path: relativePath,
          type: 'file',
          ext,
          size: stats.size,
          modified: stats.mtime.toISOString(),
        });
      }
    }
  }

  return entries;
}

/**
 * Copy a file into the workspace
 */
function importFile(sourcePath, destSubdir = '') {
  const destDir = destSubdir ? path.join(WORKSPACE_DIR, destSubdir) : WORKSPACE_DIR;
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const fileName = path.basename(sourcePath);
  const destPath = path.join(destDir, fileName);
  fs.copyFileSync(sourcePath, destPath);
  return path.relative(WORKSPACE_DIR, destPath);
}

/**
 * Get the full path for a workspace-relative path
 */
function resolveWorkspacePath(relativePath) {
  const resolved = path.resolve(WORKSPACE_DIR, relativePath);
  // Security: ensure it's within the workspace
  if (!resolved.startsWith(WORKSPACE_DIR)) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

function createDirectory(name) {
  const dirPath = path.resolve(WORKSPACE_DIR, name);
  if (!dirPath.startsWith(WORKSPACE_DIR)) throw new Error('Path traversal detected');
  fs.mkdirSync(dirPath, { recursive: true });
  return path.relative(WORKSPACE_DIR, dirPath);
}

function uploadFile(name, base64Data, destDir) {
  const targetDir = destDir ? path.resolve(WORKSPACE_DIR, destDir) : WORKSPACE_DIR;
  if (!targetDir.startsWith(WORKSPACE_DIR)) throw new Error('Path traversal detected');
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  const filePath = path.join(targetDir, name);
  if (!filePath.startsWith(WORKSPACE_DIR)) throw new Error('Path traversal detected');
  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(filePath, buffer);
  return path.relative(WORKSPACE_DIR, filePath);
}

function searchFiles(query, dir = WORKSPACE_DIR, depth = 0, maxDepth = 4) {
  if (depth > maxDepth || !fs.existsSync(dir)) return [];
  const results = [];
  const q = query.toLowerCase();
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    if (item.name.startsWith('.')) continue;
    const fullPath = path.join(dir, item.name);
    const relativePath = path.relative(WORKSPACE_DIR, fullPath);
    if (item.isDirectory()) {
      if (item.name.toLowerCase().includes(q)) {
        results.push({ name: item.name, path: relativePath, type: 'directory' });
      }
      results.push(...searchFiles(query, fullPath, depth + 1, maxDepth));
    } else {
      if (item.name.toLowerCase().includes(q)) {
        const ext = path.extname(item.name).toLowerCase();
        results.push({ name: item.name, path: relativePath, type: 'file', ext });
      }
    }
  }
  return results;
}

const CHATS_DIR = path.join(WORKSPACE_DIR, '.chats');

function saveChatHistory(fileName, history) {
  if (!fs.existsSync(CHATS_DIR)) fs.mkdirSync(CHATS_DIR, { recursive: true });
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(CHATS_DIR, `${safeName}.json`);
  fs.writeFileSync(filePath, JSON.stringify(history, null, 2), 'utf-8');
}

function loadChatHistory(fileName) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(CHATS_DIR, `${safeName}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

module.exports = {
  WORKSPACE_DIR,
  initWorkspace,
  getFileTree,
  importFile,
  resolveWorkspacePath,
  createDirectory,
  uploadFile,
  searchFiles,
  saveChatHistory,
  loadChatHistory,
};
