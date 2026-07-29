import { describe, it, expect } from 'vitest';
import {
  LUA_WRITE_OTP,
  LUA_VERIFY_OTP,
  parseVerifyResult,
} from './lua-scripts';

describe('Lua Scripts', () => {
  describe('LUA_WRITE_OTP', () => {
    it('should contain SET commands for code and errors', () => {
      expect(LUA_WRITE_OTP).toContain('SET');
      expect(LUA_WRITE_OTP).toContain('KEYS[1]'); // code key
      expect(LUA_WRITE_OTP).toContain('KEYS[2]'); // errors key
      expect(LUA_WRITE_OTP).toContain('EX');
      expect(LUA_WRITE_OTP).toContain('ARGV[2]'); // TTL
    });
  });

  describe('LUA_VERIFY_OTP', () => {
    it('should return -1 for not found', () => {
      expect(LUA_VERIFY_OTP).toContain('return -1');
    });

    it('should return -2 for too many attempts', () => {
      expect(LUA_VERIFY_OTP).toContain('return -2');
    });

    it('should return -3 for wrong code', () => {
      expect(LUA_VERIFY_OTP).toContain('return -3');
    });

    it('should return 0 for success', () => {
      expect(LUA_VERIFY_OTP).toContain('return 0');
    });

    it('should delete code and errors keys on success', () => {
      expect(LUA_VERIFY_OTP).toContain("redis.call('DEL', KEYS[1])");
      expect(LUA_VERIFY_OTP).toContain("redis.call('DEL', KEYS[2])");
    });

    it('should increment error count on wrong code', () => {
      expect(LUA_VERIFY_OTP).toContain("redis.call('INCR', KEYS[2])");
    });
  });

  describe('parseVerifyResult', () => {
    it('should parse OK result', () => {
      expect(parseVerifyResult(0)).toBe('OK');
    });
    it('should parse NOT_FOUND result', () => {
      expect(parseVerifyResult(-1)).toBe('NOT_FOUND');
    });
    it('should parse TOO_MANY result', () => {
      expect(parseVerifyResult(-2)).toBe('TOO_MANY');
    });
    it('should parse WRONG result', () => {
      expect(parseVerifyResult(-3)).toBe('WRONG');
    });
    it('should return UNKNOWN for unexpected values', () => {
      expect(parseVerifyResult(999)).toBe('UNKNOWN');
    });
  });
});
