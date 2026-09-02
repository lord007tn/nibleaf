import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { detectShortcutPlatform, searchShortcutLabel, useSearchShortcutLabel } from './shortcut';

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';

describe('detectShortcutPlatform', () => {
  it('treats a missing navigator as a non-Apple platform', () => {
    expect(detectShortcutPlatform()).toBe('other');
    expect(detectShortcutPlatform(null)).toBe('other');
    expect(detectShortcutPlatform({})).toBe('other');
  });

  it('detects macOS from the user agent or navigator.platform', () => {
    expect(detectShortcutPlatform({ userAgent: MAC_UA })).toBe('apple');
    expect(detectShortcutPlatform({ platform: 'MacIntel' })).toBe('apple');
    expect(detectShortcutPlatform({ userAgentData: { platform: 'macOS' } })).toBe('apple');
  });

  it('detects iOS and iPadOS devices', () => {
    expect(detectShortcutPlatform({ userAgent: IPHONE_UA })).toBe('apple');
    expect(detectShortcutPlatform({ platform: 'iPad' })).toBe('apple');
    // iPadOS Safari masquerades as a Mac in navigator.platform but Chromium exposes the real platform via userAgentData.
    expect(detectShortcutPlatform({ platform: 'Linux armv8l', userAgentData: { platform: 'iOS' } })).toBe('apple');
  });

  it('returns other for Windows, Linux, and Android', () => {
    expect(detectShortcutPlatform({ platform: 'Win32', userAgent: WINDOWS_UA })).toBe('other');
    expect(detectShortcutPlatform({ userAgentData: { platform: 'Windows' } })).toBe('other');
    expect(detectShortcutPlatform({ platform: 'Linux x86_64' })).toBe('other');
    expect(detectShortcutPlatform({ userAgent: ANDROID_UA })).toBe('other');
  });
});

describe('searchShortcutLabel', () => {
  it('uses the command glyph on Apple platforms and Ctrl elsewhere', () => {
    expect(searchShortcutLabel('apple')).toBe('⌘K');
    expect(searchShortcutLabel('other')).toBe('Ctrl K');
  });
});

describe('useSearchShortcutLabel', () => {
  it('renders the platform-neutral label on the server so hydration never mismatches', () => {
    const Label = () => createElement('kbd', null, useSearchShortcutLabel());
    expect(renderToStaticMarkup(createElement(Label))).toBe('<kbd>Ctrl K</kbd>');
  });
});
