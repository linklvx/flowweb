/**
 * 微信支付配置导入脚本
 * 用法: node scripts/seed-wechat-pay.js
 *
 * 做两件事:
 * 1. 将所有 wechat_pay.* 配置写入 DB (SystemSetting 表)
 * 2. 输出需要追加到 .env 的环境变量行
 */
const { PrismaClient } = require('@prisma/client');

const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDRQJQ8QzJ7/Wg/
W7qN7U2Afch7iwZNsSyk+7A2UHEtt01F80FCJrvjMBboB1CcglhaeKKyevS7f/Na
qmwg/jHXW1nC5L1pIiRBgnQTDxbMB2hM++dbMOVsP3It+onwWSUXCqZwf0ND0wd3
Z5uCl+AcpVOaKr1fwde5QKfS3WIKAoSwQshjgjm7779ZRFuUoz/fMN7kx0sYpnEy
3FXPD17HA2z9Bc5Y0rBuXtPJWEmkez6PKBhNSXAjCjk3hfmSoOM+E4DfIVqcy9g0
/aaaCQAGzgSTHi36z/cC3ajW5a6Z9hBHjGwx2v/lEpLPYtxtFZ2DMWhBe4DYO6LO
8uE9cz1hAgMBAAECggEAC0pAtT+q6aWyijiYyC+Vjuk6d+/4VxjIH960kzmj4aOS
N8P4MWmFmaxuj/ZVExy1R6xamuanbbZpmuq3CtCsP8JeBXXyAkolSqOPP7gAsuFz
bzPoN7NbrYt+zZxG9QDaT3Pzpv420uH/9SFR8qnfHayN5jOIJDKBQS2L4ISxVXjU
Rpqp3hieLiWkA00b/Z7g1Oxd0X0XKF3mj96hle+9iPvtXg03KmnLWm96a/VGKwBX
DRmZin5qDDRX+5Kt1+YdIDV4uS6neGR3dqY7sAYfPwkGd+dysRObPXlj0xr1nLYA
HM0FHpCunf4kkV1/YHYQVnHzLe0GO9YnuZO0k6QXAQKBgQD4Kh/1BIZwEdXGhGte
JQCaRrEbLVWIqX+lR2agPGCo4ME4gHEUZ+eANTAhzJGnOEXpc+VyGx9bUgAlyKDw
YEp1x99Rm/klYXcNhkDXhDBCQ1Ub9Mewxf7TtU+qAd3i5aA39E4bcDw/Vyl7rfQX
nYn2x8MfTGeP3Wvx8XhuT/YeVQKBgQDX2+6qMaCLx/FFy3/Yv+82Heoi27jz2VsA
NTg10kv/Z0+lSNixR7oeiqR/WXe2GFWeROoh2GTUVl5Vd2PGZ1YQVZTXUtcTIPub
iv6quQvDLpoaXHYoBy87jO4L0/XJ/aFefk+NT64D1fbOMFeMMsWDE00nX6IerE2y
CvxR9iDW3QKBgQDUI3Z0Bi1CKgzbiaEatnjgaOPG/qbqjzJ9wB6bhWF/m7mwqiOA
NR4xe8YsbmpoTvN8kEUomMTiVKOpqOri8P1V18kwQyvk539VAVn2oZp7WoGrx0DY
/ThME+cIxlW+O1sN2frW+8eUwdbFUjuh4FrqqXNEExVIZxh6l1fCvPoAjQKBgQCJ
z8c6734xX9CBH+AakMd3RHgEE0WsoVtA8blWW1Hb2Kh3vN9jp4iDET7ec09DeZvH
9PWJ8C7HhfCqHhQcSkMfIJRrOF9JvigE8SOP+Z4x2aHXLKre+V9FZL9h28wzTnNk
8b12WaWem0776s8qGgwRmBQNDDhj3tunzO20oi/rHQKBgQC5Yqdy9sWmjx6A8k7M
UqIhbyXKXxwG/V3JJhM/gij8cl2kGAF7wbMtQUED3bNQa5FcxKiBvcJoaCNtxSYP
94lRFewxPBuLP+cQQD1VRhKnsSsOCS77cktVi97hMndOA79ScHsrPYV1fWvOrdRF
uzH+4zzC+XJETmOwAd2NFYGy/g==
-----END PRIVATE KEY-----`;

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5zWZxp4HmsDh/7CQfgaw
qMF7NylBFnVuyAgKOMxM0FgGmY9bw6wrBUxDmMFk9rNuaGxh+8ve4lamCh7S+WR4
bHK6pBUmF+edPxlIP+hwYzQcVoa6D64t0w64akv/AG5bTPkX3c+LORNUIT2f3FYG
XmqGMc4ixd9pqGc4ZkdyRCA155ikUYVgZ29d5/putU1q7enZfX0bK4Ec9gFh3x79
W3p3924pKDexKIzKkB/8vASCrEW9Q16kFthlXyZscFk46UvQQ6f8cEHXpftljkXE
3TKlJTosPOSrsKjqxJ/BOWiGRVVVU+VFTzv+68Rlr5O+ChnuX2C9h7rqOrlCHHBZ
8wIDAQAB
-----END PUBLIC KEY-----`;

const MERCHANT_CERT = `-----BEGIN CERTIFICATE-----
MIIEKzCCAxOgAwIBAgIUd9XYW0+NkZwS3gvOi2FOZJDtxxswDQYJKoZIhvcNAQEL
BQAwXjELMAkGA1UEBhMCQ04xEzARBgNVBAoTClRlbnBheS5jb20xHTAbBgNVBAsT
FFRlbnBheS5jb20gQ0EgQ2VudGVyMRswGQYDVQQDExJUZW5wYXkuY29tIFJvb3Qg
Q0EwHhcNMjYwNzI2MTM1MjM2WhcNMzEwNzI1MTM1MjM2WjCBhDETMBEGA1UEAwwK
MTc0NjY5MTk2NzEbMBkGA1UECgwS5b6u5L+h5ZWG5oi357O757ufMTAwLgYDVQQL
DCfoj4/ms73mgZLlt6jpkavnlLXlrZDllYbliqHmnInpmZDlhazlj7gxCzAJBgNV
BAYTAkNOMREwDwYDVQQHDAhTaGVuWmhlbjCCASIwDQYJKoZIhvcNAQEBBQADggEP
ADCCAQoCggEBANFAlDxDMnv9aD9buo3tTYB9yHuLBk2xLKT7sDZQcS23TUXzQUIm
u+MwFugHUJyCWFp4orJ69Lt/81qqbCD+MddbWcLkvWkiJEGCdBMPFswHaEz751sw
5Ww/ci36ifBZJRcKpnB/Q0PTB3dnm4KX4BylU5oqvV/B17lAp9LdYgoChLBCyGOC
Obvvv1lEW5SjP98w3uTHSximcTLcVc8PXscDbP0FzljSsG5e08lYSaR7Po8oGE1J
cCMKOTeF+ZKg4z4TgN8hWpzL2DT9ppoJAAbOBJMeLfrP9wLdqNblrpn2EEeMbDHa
/+USks9i3G0VnYMxaEF7gNg7os7y4T1zPWECAwEAAaOBuTCBtjAJBgNVHRMEAjAA
MAsGA1UdDwQEAwID+DCBmwYDVR0fBIGTMIGQMIGNoIGKoIGHhoGEaHR0cDovL2V2
Y2EuaXRydXMuY29tLmNuL3B1YmxpYy9pdHJ1c2NybD9DQT0xQkQ0MjIwRTUwREJD
MDRCMDZBRDM5NzU0OTg0NkMwMUMzRThFQkQyJnNnPUhBQ0M0NzFCNjU0MjJFMTJC
MjdBOUQzM0E4N0FEMUNERjU5MjZFMTQwMzcxMA0GCSqGSIb3DQEBCwUAA4IBAQB2
cyro6ulTTYkMJksfnfJqFZyIfPTIgLmG96WlfH3PlrOfFc+wOQmtqsYzlS44bgHn
BUOmWxUHnRlmtBwJ6USHgQUX7siZjIzC4ycXZ7G7+27FwRr2ZSJ3EdJNrjQRAA+S
L6muzMyPWauAHRpXI4NgMlhR5+dXmOmRJc/akPxvVKczNGHChLOJDqBRBv17FI2a
4gaDFNCWIZqi/Ktr1ALDrXwJC+qbjt5Mm4JMZRNXhW2sZK0b3xRZErZ0qjEDcwB+
t3ZuFGPP7WmiJWRPmBl2NF2cefctH/S4GagBcnhUVWr0YpQKhbPfTbjXWvJAc0Hc
zP9RVqyUEyRb/e67ZDBt
-----END CERTIFICATE-----`;

const SETTINGS = [
  { key: 'wechat_pay.app_id',             value: 'wx4e6f1a5b3b3d3d2c' },
  { key: 'wechat_pay.mch_id',             value: '1746691967' },
  { key: 'wechat_pay.api_v3_key',         value: '5fc67c183c3a575130c66517a707cf0a' },
  { key: 'wechat_pay.merchant_serial_no', value: '77D5D85B4F8D919C12DE0BCE8B614E6490EDC71B' },
  { key: 'wechat_pay.private_key',        value: PRIVATE_KEY },
  { key: 'wechat_pay.merchant_cert',      value: MERCHANT_CERT },
  { key: 'wechat_pay.public_key_id',      value: 'PUB_KEY_ID_0117466919672026072600181691003802' },
  { key: 'wechat_pay.public_key',         value: PUBLIC_KEY },
  { key: 'wechat_pay.notify_url',         value: 'https://www.flow123.com/api/recharge/notify' },
];

async function main() {
  const prisma = new PrismaClient();

  console.log('=== 写入 SystemSetting 表 ===');
  for (const s of SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      create: { key: s.key, value: s.value },
      update: { value: s.value },
    });
    const preview = s.value.length > 60 ? s.value.slice(0, 57) + '...' : s.value;
    console.log(`  [OK] ${s.key} = ${preview}`);
  }
  console.log(`\n共写入 ${SETTINGS.length} 条配置\n`);

  // 输出 .env 格式 (PEM 用 \n 替换真实换行)
  console.log('=== 追加到 .env 的内容 ===');
  const toEnvValue = (v) => v.replace(/\n/g, '\\n');
  for (const s of SETTINGS) {
    const envKey = s.key.replace(/^wechat_pay\./, 'WECHAT_PAY_').toUpperCase();
    console.log(`${envKey}=${toEnvValue(s.value)}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
