// 可覆写 matchMedia 桩（C1 themeStore 单测用，spec §4.1「matchMedia change 监听」可测性配套）：
// 默认恒假（OS 深——与 src/test-setup.ts 全局桩同口径，不改变既有用例语义）；
// set(matches) 即时改值并向已注册 change 监听派发事件——模拟 OS 主题同页翻转。
// 直接赋值 window.matchMedia（test-setup 以 writable:true 定义，可覆盖）。

type ChangeListener = (event: { matches: boolean }) => void;

export interface MatchMediaMock {
  /** 改媒体匹配值并派发 change（已注册监听者全量通知） */
  set: (matches: boolean) => void;
}

export function installMatchMediaMock(): MatchMediaMock {
  const listeners = new Set<ChangeListener>();
  const mql = {
    matches: false,
    media: '(prefers-color-scheme: light)',
    onchange: null,
    addEventListener: (_type: string, listener: ChangeListener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: ChangeListener) => {
      listeners.delete(listener);
    },
    addListener: (listener: ChangeListener) => {
      listeners.add(listener);
    },
    removeListener: (listener: ChangeListener) => {
      listeners.delete(listener);
    },
    dispatchEvent: () => false,
  };
  window.matchMedia = () => mql as unknown as MediaQueryList;
  return {
    set(matches: boolean) {
      mql.matches = matches;
      for (const listener of listeners) listener({ matches });
    },
  };
}
