/**
 * PSD JSON Command Context Service
 *
 * Builds context for Claude to generate structured JSON commands.
 * Parses JSON command blocks from Claude's responses.
 * Ported from mockdeskai-web/src/services/psdJsonContext.ts
 */

/**
 * Build PSD context string that instructs Claude to generate JSON commands.
 */
export function buildPsdJsonContext(fileName, layers, textLayers) {
  let context = `[DESIGN FILE EDITING MODE]
You control a PSD editor via JSON commands. The user has "${fileName}" open.

AVAILABLE COMMANDS:
\`\`\`json
{ "action": "set_text", "layer": "Layer Name", "value": "New Text" }
{ "action": "set_visibility", "layer": "Layer Name", "visible": false }
{ "action": "set_opacity", "layer": "Layer Name", "opacity": 50 }
{ "action": "set_text_color", "layer": "Layer Name", "color": "#FF0000" }
\`\`\`

RULES:
- Wrap commands in \`\`\`json code blocks.
- Send multiple commands as a JSON array: [{ ... }, { ... }].
- Layer names must match exactly (case-sensitive).
- For questions about the file, answer using the layer structure below — do NOT generate commands.
- Keep explanation to 1 sentence.
`;

  if (layers && layers.length > 0) {
    context += '\nCURRENT LAYER STRUCTURE:\n';
    for (const l of layers) {
      const vis = l.visible ? 'visible' : 'hidden';
      const opacity = l.opacity !== undefined && l.opacity < 255 ? ` (${Math.round(l.opacity / 255 * 100)}%)` : '';
      context += `- [${l.type}] "${l.name}" ${vis}${opacity}`;
      if (l.textContent) context += ` text="${l.textContent}"`;
      context += '\n';
    }
  }

  if (textLayers && textLayers.length > 0) {
    context += '\nEDITABLE TEXT LAYERS:\n';
    for (const tl of textLayers) {
      let line = `- "${tl.name}": "${tl.textContent}"`;
      if (tl.fontName) line += ` [font: ${tl.fontName}`;
      if (tl.fontSize) line += tl.fontName ? `, ${tl.fontSize}pt` : ` [${tl.fontSize}pt`;
      if (tl.fontName || tl.fontSize) line += ']';
      context += line + '\n';
    }
  }

  context += '\n';
  return context;
}

/**
 * Check if text contains a ```json code block.
 */
export function containsJsonCommand(text) {
  return /```json\s*\n[\s\S]*?```/.test(text);
}

/**
 * Extract all JSON command objects from ```json code blocks.
 */
export function extractJsonCommands(text) {
  const regex = /```json\s*\n([\s\S]*?)```/g;
  const commands = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    const block = match[1].trim();
    try {
      const parsed = JSON.parse(block);
      if (Array.isArray(parsed)) {
        commands.push(...parsed);
      } else if (parsed && typeof parsed === 'object' && parsed.action) {
        commands.push(parsed);
      }
    } catch {
      const objectRegex = /\{[^{}]*\}/g;
      let objMatch;
      while ((objMatch = objectRegex.exec(block)) !== null) {
        try {
          const obj = JSON.parse(objMatch[0]);
          if (obj && obj.action) commands.push(obj);
        } catch { /* skip */ }
      }
    }
  }

  const validActions = ['set_text', 'set_visibility', 'set_opacity', 'set_text_color'];
  return commands.filter((cmd) => {
    if (!cmd.action || typeof cmd.action !== 'string') return false;
    if (!validActions.includes(cmd.action)) return false;
    if (!cmd.layer || typeof cmd.layer !== 'string') return false;
    if (cmd.action === 'set_text' && typeof cmd.value !== 'string') return false;
    if (cmd.action === 'set_visibility' && typeof cmd.visible !== 'boolean') return false;
    if (cmd.action === 'set_opacity' && typeof cmd.opacity !== 'number') return false;
    return true;
  });
}

/**
 * Strip ```json code blocks from text, leaving only the explanation.
 */
export function stripJsonCommandBlocks(text) {
  return text.replace(/```json\s*\n[\s\S]*?```/g, '').trim();
}
