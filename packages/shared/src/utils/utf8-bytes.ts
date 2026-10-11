/** Y0b-4 T1：UTF-8 字节数单源（TextEncoder）——web/api 两端消费（配额执法/提示同尺）。
 * 量纲修正：配额按字节计，string.length 按 UTF-16 码元计（中文 1 字=3 字节）——禁各处自写
 * new TextEncoder().encode(x).length（漂移源）。 */
export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}
