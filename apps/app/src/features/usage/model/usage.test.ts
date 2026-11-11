import { describe, expect, it } from 'vitest';
import { meterPresentation, meterView, sharedMissingReason, USAGE_GROUPS, unavailableExplanationKey, WEBSITE_HIDDEN_METERS } from './usage';

const meter = (overrides: Partial<Parameters<typeof meterView>[0]> = {}) => ({
  key: 'published_page',
  quantity: '40',
  ratio: 0.4,
  state: 'available' as const,
  limit: '100',
  ...overrides,
});

describe('usage meters', () => {
  it('names every grouped meter and falls back for an unknown key', () => {
    for (const key of USAGE_GROUPS.flatMap((group) => group.keys)) expect(meterPresentation(key).label).not.toBe('settings.usage.meter.unknown');
    expect(meterPresentation('future_meter')).toEqual({ icon: 'database', label: 'settings.usage.meter.unknown' });
    expect(meterPresentation('toString').label).toBe('settings.usage.meter.unknown');
  });

  it('keeps seats off a website', () => {
    expect(WEBSITE_HIDDEN_METERS.has('editor_seat')).toBe(true);
  });

  it('shows the share of the limit and a matching bar', () => {
    expect(meterView(meter())).toEqual({
      badge: { label: 'settings.usage.state.available', tone: 'success' },
      limit: '100',
      share: 40,
      bar: { width: 40, value: 40, tone: 'primary' },
      missing: null,
    });
  });

  it('only lets approaching and exceeded look like a warning; "No limit" and unknown are neutral', () => {
    expect(meterView(meter({ state: 'approaching', ratio: 0.85 })).badge.tone).toBe('warning');
    expect(meterView(meter({ state: 'exceeded', ratio: 1.2 })).badge.tone).toBe('danger');
    expect(meterView(meter({ state: 'unlimited', ratio: null, limit: null })).badge).toEqual({
      label: 'settings.usage.state.unlimited',
      tone: 'neutral',
    });
    expect(meterView(meter({ state: 'unknown' })).badge.tone).toBe('neutral');
    expect(meterView(meter({ availability: 'partial' })).badge).toEqual({ label: 'settings.usage.state.partial', tone: 'neutral' });
  });

  it('keeps the real share past 100% while the bar stops at full', () => {
    const view = meterView(meter({ state: 'exceeded', ratio: 1.5, quantity: '150' }));
    expect(view.share).toBe(150);
    expect(view.bar).toEqual({ width: 100, value: 100, tone: 'danger' });
  });

  it('draws a sliver for a tiny amount without announcing it', () => {
    const view = meterView(meter({ ratio: 0.001, quantity: '1', limit: '1000' }));
    expect(view.bar?.width).toBe(2);
    expect(view.bar?.value).toBe(0);
  });

  it('never invents 0% for a zero limit', () => {
    expect(meterView(meter({ ratio: null, limit: '0', quantity: '0', state: 'available' })).share).toBeNull();
    expect(meterView(meter({ ratio: null, limit: '0', quantity: '3', state: 'exceeded' })).bar).toEqual({ width: 100, value: 100, tone: 'danger' });
  });

  it('names why a number is missing and draws no bar', () => {
    const view = meterView(meter({ quantity: null, unavailableReason: 'catching_up' }));
    expect(view.missing).toBe('settings.usage.reason.catchingUp');
    expect(view.bar).toBeNull();
    expect(unavailableExplanationKey('something_new')).toBe('settings.usage.unknownExplanation');
    expect(unavailableExplanationKey('constructor')).toBe('settings.usage.unknownExplanation');
    expect(unavailableExplanationKey(null)).toBe('settings.usage.unknownExplanation');
  });

  it('says a reason once when every missing number shares it', () => {
    const off = (key: string) => meter({ key, quantity: null, unavailableReason: 'metering_disabled' });
    expect(sharedMissingReason([off('build'), off('search_query'), meter()])).toBe('settings.usage.reason.meteringDisabled');
    expect(sharedMissingReason([off('build'), meter({ key: 'ai_answer', quantity: null, unavailableReason: 'delayed' })])).toBeNull();
    expect(sharedMissingReason([off('build'), meter()])).toBeNull();
    expect(sharedMissingReason([meter()])).toBeNull();
  });
});
