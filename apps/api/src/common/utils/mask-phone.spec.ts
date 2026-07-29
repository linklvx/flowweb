import { describe, it, expect } from 'vitest';
import { maskPhone } from './mask-phone';

describe('maskPhone', () => {
  it('should mask middle 4 digits of +86 phone', () => {
    expect(maskPhone('+8613800138000')).toBe('+86138****8000');
  });

  it('should handle any +86 phone', () => {
    expect(maskPhone('+8613912345678')).toBe('+86139****5678');
  });

  it('should not modify already masked phone', () => {
    expect(maskPhone('+86138****8000')).toBe('+86138****8000');
  });
});
