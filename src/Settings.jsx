import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  User,
  Palette,
  Sparkles,
  FolderOpen,
  Info,
  Check,
  ExternalLink,
} from 'lucide-react';

const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'ai', label: 'AI Assistant', icon: Sparkles },
  { id: 'workspace', label: 'Workspace', icon: FolderOpen },
  { id: 'about', label: 'About', icon: Info },
];

const ROLES = ['Sales Rep', 'Art Director', 'Manager', 'Other'];

const THEMES = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light', comingSoon: true },
  { id: 'system', label: 'System', comingSoon: true },
];

const TONES = [
  { id: 'professional', label: 'Professional', desc: 'Formal, business-appropriate responses' },
  { id: 'casual', label: 'Casual', desc: 'Friendly, conversational tone' },
  { id: 'concise', label: 'Concise', desc: 'Brief, to-the-point answers' },
  { id: 'detailed', label: 'Detailed', desc: 'Thorough explanations with context' },
  { id: 'pirate', label: 'Pirate', desc: "Ahoy! Speak like a seafarin' swashbuckler" },
];

const EXPORT_FORMATS = ['png', 'jpg', 'psd'];

function SelectableCard({ selected, onClick, children, disabled }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      className={`relative rounded-lg border p-4 text-left transition-all ${
        selected
          ? 'border-blue-500 bg-blue-500/10'
          : disabled
            ? 'border-gray-700 bg-gray-800/30 opacity-50 cursor-not-allowed'
            : 'border-gray-700 bg-gray-800/50 hover:border-gray-500 cursor-pointer'
      }`}
    >
      {selected && (
        <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-blue-500">
          <Check size={12} className="text-white" />
        </div>
      )}
      {children}
    </button>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-10 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-blue-500' : 'bg-gray-600'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function SectionTitle({ children }) {
  return <h3 className="mb-4 text-lg font-semibold text-white">{children}</h3>;
}

function FieldLabel({ children }) {
  return <label className="mb-2 block text-sm font-medium text-gray-300">{children}</label>;
}

export default function Settings({ settings, onSettingsChange, onClose }) {
  const [activeSection, setActiveSection] = useState('profile');
  const [localSettings, setLocalSettings] = useState(settings);
  const [claudeVersion, setClaudeVersion] = useState(null);
  const [workspacePath, setWorkspacePath] = useState('~/MockDeskAI');

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then((data) => {
        if (data.claude?.version) setClaudeVersion(data.claude.version);
        if (data.workspace) setWorkspacePath(data.workspace);
      })
      .catch(() => {});
  }, []);

  const update = useCallback((path, value) => {
    setLocalSettings((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      const keys = path.split('.');
      let obj = next;
      for (let i = 0; i < keys.length - 1; i++) {
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;

      // Save to server and notify parent
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      }).catch(() => {});
      onSettingsChange(next);

      return next;
    });
  }, [onSettingsChange]);

  const renderSection = () => {
    switch (activeSection) {
      case 'profile':
        return (
          <div>
            <SectionTitle>Profile</SectionTitle>
            <div className="space-y-5">
              <div>
                <FieldLabel>Your Name</FieldLabel>
                <input
                  type="text"
                  value={localSettings.profile.name}
                  onChange={(e) => update('profile.name', e.target.value)}
                  placeholder="Enter your name"
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none transition-colors focus:border-blue-500"
                />
              </div>
              <div>
                <FieldLabel>Company Name</FieldLabel>
                <input
                  type="text"
                  value={localSettings.profile.company}
                  onChange={(e) => update('profile.company', e.target.value)}
                  placeholder="Enter company name"
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none transition-colors focus:border-blue-500"
                />
              </div>
              <div>
                <FieldLabel>Role</FieldLabel>
                <div className="grid grid-cols-2 gap-3">
                  {ROLES.map((role) => (
                    <SelectableCard
                      key={role}
                      selected={localSettings.profile.role === role}
                      onClick={() => update('profile.role', role)}
                    >
                      <span className="text-sm font-medium text-gray-200">{role}</span>
                    </SelectableCard>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );

      case 'appearance':
        return (
          <div>
            <SectionTitle>Appearance</SectionTitle>
            <div>
              <FieldLabel>Theme</FieldLabel>
              <div className="grid grid-cols-3 gap-3">
                {THEMES.map((theme) => (
                  <SelectableCard
                    key={theme.id}
                    selected={localSettings.appearance.theme === theme.id}
                    onClick={() => update('appearance.theme', theme.id)}
                    disabled={theme.comingSoon}
                  >
                    <span className="text-sm font-medium text-gray-200">{theme.label}</span>
                    {theme.comingSoon && (
                      <span className="mt-1 block text-xs text-gray-500">Coming soon</span>
                    )}
                  </SelectableCard>
                ))}
              </div>
            </div>
          </div>
        );

      case 'ai':
        return (
          <div>
            <SectionTitle>AI Assistant</SectionTitle>
            <div className="space-y-6">
              <div>
                <FieldLabel>Response Tone</FieldLabel>
                <div className="grid grid-cols-1 gap-3">
                  {TONES.map((tone) => (
                    <SelectableCard
                      key={tone.id}
                      selected={localSettings.ai.responseTone === tone.id}
                      onClick={() => update('ai.responseTone', tone.id)}
                    >
                      <div>
                        <span className="text-sm font-medium text-gray-200">{tone.label}</span>
                        <span className="mt-0.5 block text-xs text-gray-500">{tone.desc}</span>
                      </div>
                    </SelectableCard>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-3">
                <div>
                  <span className="text-sm font-medium text-gray-200">Auto-apply edits</span>
                  <span className="mt-0.5 block text-xs text-gray-500">
                    When off, AI asks for confirmation before executing edits
                  </span>
                </div>
                <Toggle
                  checked={localSettings.ai.autoApplyEdits}
                  onChange={(v) => update('ai.autoApplyEdits', v)}
                />
              </div>
              <div className="rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-3">
                <span className="text-sm font-medium text-gray-200">Model</span>
                <span className="mt-0.5 block text-xs text-gray-400">
                  Claude CLI {claudeVersion ? `(${claudeVersion})` : ''}
                </span>
              </div>
            </div>
          </div>
        );

      case 'workspace':
        return (
          <div>
            <SectionTitle>Workspace</SectionTitle>
            <div className="space-y-5">
              <div className="rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-3">
                <span className="text-sm font-medium text-gray-200">Workspace Path</span>
                <span className="mt-0.5 block font-mono text-xs text-gray-400">{workspacePath}</span>
              </div>
              <div>
                <FieldLabel>Default Export Format</FieldLabel>
                <div className="grid grid-cols-3 gap-3">
                  {EXPORT_FORMATS.map((fmt) => (
                    <SelectableCard
                      key={fmt}
                      selected={localSettings.workspace.defaultExportFormat === fmt}
                      onClick={() => update('workspace.defaultExportFormat', fmt)}
                    >
                      <span className="text-sm font-medium uppercase text-gray-200">{fmt}</span>
                    </SelectableCard>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-3">
                <div>
                  <span className="text-sm font-medium text-gray-200">Show hidden files</span>
                  <span className="mt-0.5 block text-xs text-gray-500">
                    Display dotfiles in the file tree
                  </span>
                </div>
                <Toggle
                  checked={localSettings.workspace.showHiddenFiles}
                  onChange={(v) => update('workspace.showHiddenFiles', v)}
                />
              </div>
            </div>
          </div>
        );

      case 'about':
        return (
          <div>
            <SectionTitle>About</SectionTitle>
            <div className="space-y-4">
              <div className="rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-3">
                <span className="text-sm font-medium text-gray-200">MockDeskAI</span>
                <span className="mt-0.5 block text-xs text-gray-400">v0.1.1-beta</span>
              </div>
              <div className="rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-3">
                <span className="text-sm font-medium text-gray-200">Workspace</span>
                <span className="mt-0.5 block font-mono text-xs text-gray-400">{workspacePath}</span>
              </div>
              <div className="rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-3">
                <span className="text-sm font-medium text-gray-200">Claude CLI</span>
                <span className="mt-0.5 block text-xs text-gray-400">
                  {claudeVersion || 'Checking...'}
                </span>
              </div>
              <a
                href="https://mockdeskai.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
                mockdeskai.com
                <ExternalLink size={13} />
              </a>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="mx-auto my-8 flex h-[80vh] w-full max-w-3xl overflow-hidden rounded-xl border border-gray-700 bg-gray-900">
        {/* Left nav */}
        <div className="flex w-[200px] shrink-0 flex-col border-r border-gray-800 bg-gray-950">
          <div className="flex items-center justify-between px-4 py-4">
            <span className="text-sm font-semibold text-white">Settings</span>
            <button
              onClick={onClose}
              className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
          <nav className="flex-1 space-y-0.5 px-2">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              const isActive = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-4 py-2.5 text-sm transition-colors ${
                    isActive
                      ? 'bg-blue-500/10 text-blue-400'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`}
                >
                  <Icon size={16} />
                  {section.label}
                </button>
              );
            })}
          </nav>
          <div className="px-4 py-3 text-xs text-gray-600">v0.1.1-beta</div>
        </div>

        {/* Right content */}
        <div className="flex-1 overflow-y-auto p-6">
          {renderSection()}
        </div>
      </div>
    </div>
  );
}
