/**
 * Setup Wizard — First-launch experience
 *
 * Detects Claude CLI, guides user through install + auth if needed.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  FileImage,
  Check,
  X,
  Loader2,
  Terminal,
  ExternalLink,
  RefreshCw,
  ChevronRight,
  Copy,
} from 'lucide-react';

const STEPS = {
  CHECKING: 'checking',
  NEEDS_INSTALL: 'needs_install',
  NEEDS_AUTH: 'needs_auth',
  READY: 'ready',
};

export default function SetupWizard({ onComplete }) {
  const [step, setStep] = useState(STEPS.CHECKING);
  const [claudeVersion, setClaudeVersion] = useState(null);
  const [copied, setCopied] = useState(null);
  const [checking, setChecking] = useState(false);

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (data.claude?.available) {
        setClaudeVersion(data.claude.version);
        setStep(STEPS.READY);
      } else {
        setStep(STEPS.NEEDS_INSTALL);
      }
    } catch {
      setStep(STEPS.NEEDS_INSTALL);
    }
    setChecking(false);
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const copyToClipboard = useCallback((text, label) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  // Checking state
  if (step === STEPS.CHECKING) {
    return (
      <div className="wizard-container">
        <div className="wizard-card">
          <div className="wizard-logo">
            <FileImage size={48} className="text-blue-500" />
          </div>
          <h1 className="wizard-title">MockDeskAI</h1>
          <div className="wizard-checking">
            <Loader2 size={24} className="animate-spin text-blue-500" />
            <p>Checking system requirements...</p>
          </div>
        </div>
      </div>
    );
  }

  // Ready state
  if (step === STEPS.READY) {
    return (
      <div className="wizard-container">
        <div className="wizard-card">
          <div className="wizard-logo">
            <FileImage size={48} className="text-blue-500" />
          </div>
          <h1 className="wizard-title">MockDeskAI</h1>
          <p className="wizard-subtitle">AI-powered design proofing</p>

          <div className="wizard-status-row success">
            <Check size={20} />
            <div>
              <strong>Claude CLI detected</strong>
              <span className="wizard-version">{claudeVersion}</span>
            </div>
          </div>

          <button className="wizard-btn primary" onClick={onComplete}>
            Get Started
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    );
  }

  // Install / Auth flow
  const platform = window.mockdeskai?.platform || 'darwin';

  return (
    <div className="wizard-container">
      <div className="wizard-card wide">
        <div className="wizard-logo">
          <FileImage size={48} className="text-blue-500" />
        </div>
        <h1 className="wizard-title">Setup Required</h1>
        <p className="wizard-subtitle">
          MockDeskAI needs Claude CLI to power AI edits. Follow these steps to get set up.
        </p>

        {/* Step 1: Install */}
        <div className="wizard-step">
          <div className="wizard-step-header">
            <div className="wizard-step-num">1</div>
            <h2>Install Claude CLI</h2>
          </div>
          <p className="wizard-step-desc">
            Open your terminal and run this command:
          </p>
          <div className="wizard-code-block">
            <code>
              {platform === 'win32'
                ? 'npm install -g @anthropic-ai/claude-code'
                : 'npm install -g @anthropic-ai/claude-code'}
            </code>
            <button
              className="wizard-copy-btn"
              onClick={() => copyToClipboard('npm install -g @anthropic-ai/claude-code', 'install')}
            >
              {copied === 'install' ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <p className="wizard-step-note">
            Requires Node.js 18+. Don't have Node?{' '}
            <a href="https://nodejs.org" target="_blank" rel="noopener noreferrer" className="wizard-link">
              Download it here <ExternalLink size={12} />
            </a>
          </p>
        </div>

        {/* Step 2: Authenticate */}
        <div className="wizard-step">
          <div className="wizard-step-header">
            <div className="wizard-step-num">2</div>
            <h2>Authenticate</h2>
          </div>
          <p className="wizard-step-desc">
            Run this command and follow the prompts to sign in with your Anthropic account:
          </p>
          <div className="wizard-code-block">
            <code>claude login</code>
            <button
              className="wizard-copy-btn"
              onClick={() => copyToClipboard('claude login', 'auth')}
            >
              {copied === 'auth' ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <p className="wizard-step-note">
            Need an account?{' '}
            <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" className="wizard-link">
              Sign up at Anthropic <ExternalLink size={12} />
            </a>
          </p>
        </div>

        {/* Step 3: Verify */}
        <div className="wizard-step">
          <div className="wizard-step-header">
            <div className="wizard-step-num">3</div>
            <h2>Verify & Launch</h2>
          </div>
          <p className="wizard-step-desc">
            Once installed and authenticated, click the button below to verify and continue.
          </p>
          <button
            className="wizard-btn primary"
            onClick={checkStatus}
            disabled={checking}
          >
            {checking ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Checking...
              </>
            ) : (
              <>
                <RefreshCw size={18} />
                Check Again
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
