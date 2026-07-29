/** 写入 OTP — 原子设置 code + errors 两个 Key */
export const LUA_WRITE_OTP = `
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('SET', KEYS[2], '0', 'EX', ARGV[2])
return 'OK'
`.trim();

/** 校验 OTP — 原子比对、计数、超限作废、写错误原因 */
export const LUA_VERIFY_OTP = `
local code = redis.call('GET', KEYS[1])
if not code then
  redis.call('SET', KEYS[3], 'NOT_FOUND', 'EX', 60)
  return -1
end

if ARGV[1] ~= code then
  local errors = redis.call('INCR', KEYS[2])
  redis.call('EXPIRE', KEYS[2], 300)
  if errors >= tonumber(ARGV[2]) then
    redis.call('DEL', KEYS[1])
    redis.call('DEL', KEYS[2])
    redis.call('SET', KEYS[3], 'TOO_MANY', 'EX', 60)
    return -2
  end
  redis.call('SET', KEYS[3], 'WRONG', 'EX', 60)
  return -3
end

redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
redis.call('DEL', KEYS[3])
return 0
`.trim();

export type VerifyResult = 'OK' | 'NOT_FOUND' | 'TOO_MANY' | 'WRONG' | 'UNKNOWN';

export function parseVerifyResult(code: number): VerifyResult {
  switch (code) {
    case 0: return 'OK';
    case -1: return 'NOT_FOUND';
    case -2: return 'TOO_MANY';
    case -3: return 'WRONG';
    default: return 'UNKNOWN';
  }
}
