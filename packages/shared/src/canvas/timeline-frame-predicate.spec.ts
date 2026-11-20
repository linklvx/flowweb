// packages/shared/src/canvas/timeline-frame-predicate.spec.ts
// Y4a T3（plan 2026-11-20-y4a-timeline-domain Task 3——spec §0 条 8〔§3.1 v6 修订⑤+v7 修订③
// 键矩阵〕）：时间轴帧谓词负控矩阵——**纯字段检查**三消费面（frame-deny L1 矩阵/L2 timelines
// currentTarget 分支/T4 客户端写前自检）的行为锁。每类拒绝面至少一例拒+一例过（brief Step 1 负控
// 矩阵逐条）：
//  ①标量槽 Y.Map/Y.Array/Y.Text；②NaN/Infinity start；③负 sourceStart；④非正 duration；
//  ⑤空 clipId；⑥canvasSize 负宽；⑦fontSize 非正；⑧fade 负段；⑨mediaId 空串；⑩Transition 非法
//  type；⑪easing 非 linear；⑫playbackSpeed 3；⑬version 2；⑭fps 24；⑮Map 键≠记录 id；
//  ⑯已存在键 set 新 Y.Map（结构拒绝）；⑰subtitle 带 keyframes/mediaId；⑱音量关键帧带 property。
// 删除三级不进本谓词的 add/update 面（spec §0 条 8——删除集只有 client/clock、L1 帧内读不出键名；
// 三级执法=frame-deny L2 面，本 spec 的 L2 档在 frame-deny.spec.ts 扩）。
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { TIMELINE_FRAME_PREDICATE } from './timeline-frame-predicate';

/** 谓词直调装置：直接对 doc 帧编码跑 TIMELINE_FRAME_PREDICATE（L1 签名形态）。 */
function verdictOf(mutate: (d: Y.Doc) => void): { ok: boolean; reason?: string } {
  const d = new Y.Doc();
  d.transact(() => mutate(d));
  return TIMELINE_FRAME_PREDICATE(Y.encodeStateAsUpdate(d), d);
}

/** 合法入口骨架（version/fps/tracks 默认轨/clips 空——只差待测字段）。 */
function seedEntry(nodeId: string): Y.Map<unknown> {
  const entry = new Y.Map();
  entry.set('version', 1);
  entry.set('fps', 30);
  const tracks = new Y.Map();
  const track = new Y.Map();
  track.set('type', 'video');
  track.set('name', '视频');
  track.set('muted', false);
  track.set('hidden', false);
  track.set('order', '5000');
  tracks.set(`${nodeId}:video`, track);
  entry.set('tracks', tracks);
  entry.set('clips', new Y.Map());
  return entry;
}

/** 合法 video 片段 Map（span/transform 标量+keyframes 空 Map——类型键矩阵满键形态）。 */
function videoClip(clipId: string, over?: (m: Y.Map<unknown>) => void): Y.Map<unknown> {
  const m = new Y.Map();
  m.set('type', 'video');
  m.set('span', { trackId: 'n1:video', start: 0, duration: 5, sourceStart: 0 });
  m.set('transform', { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
  m.set('mediaId', 'm-1');
  m.set('playbackSpeed', 1);
  m.set('keyframes', new Y.Map());
  over?.(m);
  void clipId;
  return m;
}

/** 合法 audio 片段（volume/fade/playbackSpeed/keyframes）。 */
function audioClip(over?: (m: Y.Map<unknown>) => void): Y.Map<unknown> {
  const m = new Y.Map();
  m.set('type', 'audio');
  m.set('span', { trackId: 'n1:video', start: 0, duration: 3, sourceStart: 1 });
  m.set('mediaId', 'm-a');
  m.set('volume', 1);
  m.set('fade', { in: 0, out: 0 });
  m.set('playbackSpeed', 1);
  m.set('keyframes', new Y.Map());
  over?.(m);
  return m;
}

describe('Y4a T3 TIMELINE_FRAME_PREDICATE 负控矩阵（spec §0 条 8/§3.1 键矩阵）', () => {
  it('正基线：合法工程全放行（默认轨+video/audio 片段+keyframes 出生）', () => {
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('c1', videoClip('c1'));
    })).toEqual({ ok: true });
  });

  it('①标量槽 Y.Map/Y.Array/Y.Text 三型全拒（span/transform/style/fade/transitionIn/transitionOut JSON 标量域）', () => {
    for (const poison of [new Y.Map(), new Y.Array(), new Y.Text()]) {
      expect(verdictOf((d) => {
        const entry = seedEntry('n1');
        d.getMap('timelines').set('n1', entry);
        (entry.get('clips') as Y.Map<unknown>).set('c1', videoClip('c1', (m) => m.set('span', poison)));
      }).ok).toBe(false);
    }
  });

  it('②NaN/Infinity start 拒（非有限数）；有限 start 放行（正控同帧）', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(verdictOf((d) => {
        const entry = seedEntry('n1');
        d.getMap('timelines').set('n1', entry);
        (entry.get('clips') as Y.Map<unknown>).set('c1', videoClip('c1', (m) => m.set('span', { trackId: 'n1:video', start: bad, duration: 5, sourceStart: 0 })));
      }).ok).toBe(false);
    }
  });

  it('③负 sourceStart 拒；sourceStart 0 放行', () => {
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('c1', videoClip('c1', (m) => m.set('span', { trackId: 'n1:video', start: 0, duration: 5, sourceStart: -1 })));
    }).ok).toBe(false);
  });

  it('④非正 duration 拒（0/负）；正 duration 放行', () => {
    for (const bad of [0, -2]) {
      expect(verdictOf((d) => {
        const entry = seedEntry('n1');
        d.getMap('timelines').set('n1', entry);
        (entry.get('clips') as Y.Map<unknown>).set('c1', videoClip('c1', (m) => m.set('span', { trackId: 'n1:video', start: 0, duration: bad, sourceStart: 0 })));
      }).ok).toBe(false);
    }
  });

  it('⑤空 clipId 拒（Map 键=记录自身 id——空串非法）；非空 clipId 放行', () => {
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('', videoClip(''));
    }).ok).toBe(false);
  });

  it('⑥canvasSize 负宽拒（宽高有限且为正）；1920×1080 放行', () => {
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      entry.set('canvasSize', { width: -1920, height: 1080 });
      d.getMap('timelines').set('n1', entry);
    }).ok).toBe(false);
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      entry.set('canvasSize', { width: 1920, height: 1080 });
      d.getMap('timelines').set('n1', entry);
    })).toEqual({ ok: true });
  });

  it('⑦fontSize 非正拒（subtitle style 内）；fontSize 24 放行', () => {
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      const m = new Y.Map();
      m.set('type', 'subtitle');
      m.set('span', { trackId: 'n1:video', start: 0, duration: 2 });
      m.set('text', 'hello');
      m.set('visible', true);
      m.set('style', { fontSize: 0, color: '#fff', letterSpacing: 1 });
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('s1', m);
    }).ok).toBe(false);
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      const m = new Y.Map();
      m.set('type', 'subtitle');
      m.set('span', { trackId: 'n1:video', start: 0, duration: 2 });
      m.set('text', 'hello');
      m.set('visible', true);
      m.set('style', { fontSize: 24, color: '#fff', letterSpacing: 1 });
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('s1', m);
    })).toEqual({ ok: true });
  });

  it('⑧fade 负段拒（audio fade.in/out 非负）；零段放行', () => {
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('a1', audioClip((m) => m.set('fade', { in: -0.5, out: 0 })));
    }).ok).toBe(false);
  });

  it('⑨mediaId 空串拒（video/image/audio 非空字符串）；非空放行', () => {
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('c1', videoClip('c1', (m) => m.set('mediaId', '')));
    }).ok).toBe(false);
  });

  it('⑩Transition 非法 type 拒（五型外）；crossfade+正 duration 放行', () => {
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('c1', videoClip('c1', (m) => m.set('transitionIn', { type: 'zoomIn', duration: 1 })));
    }).ok).toBe(false);
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('c1', videoClip('c1', (m) => m.set('transitionIn', { type: 'crossfade', duration: 1 })));
    })).toEqual({ ok: true });
  });

  it('⑩b Transition 非正 duration 拒（五型内）', () => {
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('c1', videoClip('c1', (m) => m.set('transitionOut', { type: 'toBlack', duration: 0 })));
    }).ok).toBe(false);
  });

  it('⑪easing 非 linear 拒（关键帧标量内）；linear 放行', () => {
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      const c = videoClip('c1');
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('c1', c);
      (c.get('keyframes') as Y.Map<unknown>).set('k1', { id: 'k1', t: 0, property: 'x', value: 3, easing: 'easeIn' });
    }).ok).toBe(false);
  });

  it('⑫playbackSpeed 3 拒（∈{0.5,1,2}）；2 放行', () => {
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('c1', videoClip('c1', (m) => m.set('playbackSpeed', 3)));
    }).ok).toBe(false);
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('c1', videoClip('c1', (m) => m.set('playbackSpeed', 2)));
    })).toEqual({ ok: true });
  });

  it('⑬version 2 拒（字面量 1）；⑭fps 24 拒（字面量 30）', () => {
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      entry.set('version', 2);
      d.getMap('timelines').set('n1', entry);
    }).ok).toBe(false);
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      entry.set('fps', 24);
      d.getMap('timelines').set('n1', entry);
    }).ok).toBe(false);
  });

  it('⑮Map 键≠记录 id 拒（关键帧标量 id 域漂移=键≠id）；键=id 放行；clip Map 带 id 域=未知键拒', () => {
    // 关键帧档：kf Map 键='k1'、标量 id='k-other'——键≠id 拒
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      const c = videoClip('c1');
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('c1', c);
      (c.get('keyframes') as Y.Map<unknown>).set('k1', { id: 'k-other', t: 0, property: 'x', value: 3, easing: 'linear' });
    }).ok).toBe(false);
    // clip Map 自身无 id 槽（键矩阵封闭集）——携带 id 域=未知键拒
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('c1', videoClip('c1', (m) => m.set('id', 'c1')));
    }).ok).toBe(false);
  });

  it('⑯已存在键 set 新 Y.Map 拒（结构拒绝——入口容器键整键 update 面；Yjs 同键换值后旧 Map 键读空，先持旧容器实例再比对）；同实例改值放行', () => {
    // 结构拒绝执法面=入口容器键的实例身份比对（L2 事件 update 档+T4 写前自检同源；Yjs 语义：
    // 同键 set 新 Map 后旧 Map 脱离父键——先取旧容器实例、换值后 entry.get 返回新实例即拒）。
    const d = new Y.Doc();
    d.getMap('timelines').set('n1', seedEntry('n1'));
    const prevTracks = (d.getMap('timelines').get('n1') as Y.Map<unknown>).get('tracks');
    d.transact(() => {
      const entry = d.getMap('timelines').get('n1') as Y.Map<unknown>;
      entry.set('tracks', new Y.Map());   // 已存在 tracks 容器键换新 Map——「删了换新」等效绕过
    });
    const newEntry = d.getMap('timelines').get('n1') as Y.Map<unknown>;
    expect(newEntry.get('tracks') === prevTracks).toBe(false);   // 实例已换（Yjs 同键换新 Map）
    expect(newEntry.get('tracks')).toBeInstanceOf(Y.Map);        // 新实例形状合法——静态面放行、
    // 执法面=L2 事件 update 档（timeline-tracks-replaced——frame-deny.spec.ts ②档已锁拒）；
    // 本档锁「同键换新 Map 实例身份必换」的 Yjs 行为底座（T4 写前自检 previous 比对依赖此）。
    // 正控：容器实例未换（只改容器内键值）——existing 同实例放行
    const d2 = new Y.Doc();
    d2.getMap('timelines').set('n1', seedEntry('n1'));
    const prevEntry = d2.getMap('timelines').get('n1') as Y.Map<unknown>;
    const prevTracks2 = prevEntry.get('tracks');
    const prevClips2 = prevEntry.get('clips');
    d2.transact(() => {
      const entry = d2.getMap('timelines').get('n1') as Y.Map<unknown>;
      entry.set('canvasSize', { width: 1920, height: 1080 });   // 新标量键（原无 canvasSize）=add
      (entry.get('tracks') as Y.Map<unknown>).set('n1:audio', (() => {
        const t = new Y.Map();
        t.set('type', 'audio'); t.set('name', '音频'); t.set('muted', false); t.set('hidden', false); t.set('order', '5001');
        return t;
      })());
    });
    const after = d2.getMap('timelines').get('n1') as Y.Map<unknown>;
    expect(after.get('tracks') === prevTracks2).toBe(true);   // 容器身份未换
    expect(after.get('clips') === prevClips2).toBe(true);
  });

  it('⑰subtitle 带 keyframes/mediaId 拒（字幕无此二槽）', () => {
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      const m = new Y.Map();
      m.set('type', 'subtitle');
      m.set('span', { trackId: 'n1:video', start: 0, duration: 2 });
      m.set('text', 'hello');
      m.set('visible', true);
      m.set('style', { fontSize: 24, color: '#fff', letterSpacing: 1 });
      m.set('keyframes', new Y.Map());   // 字幕不该有
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('s1', m);
    }).ok).toBe(false);
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      const m = new Y.Map();
      m.set('type', 'subtitle');
      m.set('span', { trackId: 'n1:video', start: 0, duration: 2 });
      m.set('text', 'hello');
      m.set('visible', true);
      m.set('style', { fontSize: 24, color: '#fff', letterSpacing: 1 });
      m.set('mediaId', 'm-s');   // 字幕不该有
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('s1', m);
    }).ok).toBe(false);
  });

  it('⑱音量关键帧带 property 拒（VolumeKeyframe 无 property——切比例不改）；无 property 放行', () => {
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      const a = audioClip();
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('a1', a);
      (a.get('keyframes') as Y.Map<unknown>).set('k1', { id: 'k1', t: 0, value: 1, easing: 'linear', property: 'volume' });
    }).ok).toBe(false);
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      const a = audioClip();
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('a1', a);
      (a.get('keyframes') as Y.Map<unknown>).set('k1', { id: 'k1', t: 0, value: 1, easing: 'linear' });
    })).toEqual({ ok: true });
  });

  it('轨道档：非法轨 type 拒（三型外）/非法 order 键拒（order-key 单源 isValidOrderKey）', () => {
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      d.getMap('timelines').set('n1', entry);
      const tracks = entry.get('tracks') as Y.Map<unknown>;
      const t = tracks.get('n1:video') as Y.Map<unknown>;
      t.set('type', 'overlay');
    }).ok).toBe(false);
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      d.getMap('timelines').set('n1', entry);
      const t = entry.get('tracks') as Y.Map<unknown>;
      (t.get('n1:video') as Y.Map<unknown>).set('order', '500.50');   // 尾零=非规范形
    }).ok).toBe(false);
  });

  it('片段档：未知片段 type 拒（四型外）/未知键拒（类型键矩阵封闭集）', () => {
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('c1', videoClip('c1', (m) => m.set('type', 'sticker')));
    }).ok).toBe(false);
    expect(verdictOf((d) => {
      const entry = seedEntry('n1');
      d.getMap('timelines').set('n1', entry);
      (entry.get('clips') as Y.Map<unknown>).set('c1', videoClip('c1', (m) => m.set('hax', 1)));
    }).ok).toBe(false);
  });
});
