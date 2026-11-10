import { describe, expect, it } from 'vitest';
import { errorMessages, fieldErrorsVisible, invalidFieldCount, validateOnBlurThenChange, withoutStaleErrors, withServerError } from './field-errors';

describe('errorMessages', () => {
  it('keeps distinct non-empty strings in order', () => {
    expect(errorMessages(['Required', undefined, '', 'Required', { message: 'x' }, 'Too long'])).toEqual(['Required', 'Too long']);
  });
});

describe('fieldErrorsVisible', () => {
  const invalid = { errors: ['Required'] };
  it.each([
    ['a fresh field the person is typing in', { ...invalid, isTouched: true, isBlurred: false }, 0, false],
    ['a field that was left', { ...invalid, isTouched: true, isBlurred: true }, 0, true],
    ['an untouched field after a submit attempt', { ...invalid, isTouched: false, isBlurred: false }, 1, true],
    ['a valid field after a submit attempt', { errors: [], isBlurred: true }, 1, false],
  ])('%s', (_label, meta, attempts, visible) => {
    expect(fieldErrorsVisible(meta, attempts)).toBe(visible);
  });
});

describe('validateOnBlurThenChange', () => {
  const validate = (value: string) => (value ? undefined : 'Required');
  const validators = validateOnBlurThenChange(validate);
  const args = (value: string, isBlurred: boolean, submissionAttempts: number) => ({
    value,
    fieldApi: { state: { meta: { isBlurred } }, form: { state: { submissionAttempts } } },
  });

  it('checks on blur and submit', () => {
    expect(validators.onBlur({ value: '' })).toBe('Required');
    expect(validators.onSubmit({ value: '' })).toBe('Required');
  });

  it('stays quiet while typing in a fresh field', () => {
    expect(validators.onChange(args('', false, 0))).toBeUndefined();
  });

  it('checks on every change once the field was left or the form submitted, so a fix clears the error', () => {
    expect(validators.onChange(args('', true, 0))).toBe('Required');
    expect(validators.onChange(args('', false, 1))).toBe('Required');
    expect(validators.onChange(args('ok', true, 0))).toBeUndefined();
  });
});

describe('invalidFieldCount', () => {
  it('counts fields with at least one message', () => {
    expect(invalidFieldCount({ name: { errors: ['Required'] }, slug: { errors: [] }, desc: undefined, x: { errors: [''] } })).toBe(1);
  });
});

describe('server errors', () => {
  it('sets a server error next to the other causes', () => {
    expect(withServerError({ errorMap: { onBlur: 'Required' } }, 'Taken').errorMap).toEqual({ onBlur: 'Required', onServer: 'Taken' });
  });

  it('drops the errors a new value makes stale and keeps the change check', () => {
    const meta = { errorMap: { onBlur: 'Required', onSubmit: 'Required', onServer: 'Taken', onChange: 'Too long' } };
    expect(withoutStaleErrors(meta).errorMap).toEqual({ onChange: 'Too long' });
    const clean = { errorMap: { onChange: undefined } };
    expect(withoutStaleErrors(clean)).toBe(clean);
  });
});
