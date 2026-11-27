// 研究分析：LSA 公式、學習者分型、教材效能指標
const test = require('node:test');
const assert = require('node:assert/strict');
const { useTempDb, fakeClock } = require('./helpers');

useTempDb('ana');
process.env.DEDUPE_MS = '0';
const clock = fakeClock();
const fa = require('../src/frameAction');
const an = require('../src/analysis');

const SEC = 1000;
const call = (user, p) => fa.handleFrameAction({ frame: 'f', user, ...p }, 't');
const open = (user, name, type = 'images') => call(user, { event: 'material', asset_name: name, asset_type: type });

test('LSA：手算範例 OM→LK→OM→LK→OM→LK→OM 的調整後殘差', () => {
  // N=6；OM→LK、LK→OM 各 3 次；期望 1.5；Z = 1.5 / sqrt(1.5 × .5 × .5) = 2.449
  const r = an.lagSequential([['OM', 'LK', 'OM', 'LK', 'OM', 'LK', 'OM']]);
  assert.equal(r.N, 6);
  const cell = (a, b) => r.cells.find((c) => c.from === a && c.to === b);
  assert.equal(cell('OM', 'LK').freq, 3);
  assert.equal(cell('OM', 'LK').expected, 1.5);
  assert.equal(cell('OM', 'LK').z, 2.45);
  assert.equal(cell('OM', 'OM').z, -2.45);
  assert.deepEqual(r.significant.map((c) => c.from + c.to).sort(), ['LKOM', 'OMLK']);
  assert.equal(r.enough, false, 'N=6 < 30 應標示樣本太少');
});

test('LSA：沒有任何轉移時不會除以零', () => {
  const r = an.lagSequential([['EN']]);
  assert.equal(r.N, 0);
  assert.deepEqual(r.significant, []);
});

test('分型規則：廣度 × 深度 對中位數', () => {
  assert.equal(an.classify(80, 60, 50, 30), '深度探索型');
  assert.equal(an.classify(80, 10, 50, 30), '廣泛瀏覽型');
  assert.equal(an.classify(20, 60, 50, 30), '專注聚焦型');
  assert.equal(an.classify(20, 10, 50, 30), '淺嘗即止型');
  assert.equal(an.classify(0, null, 50, 30), '未開啟教材');
});

test('完整分析：參與度、教材效能、分型、首選教材、自動觀察', () => {
  // 4 份教材 A B C D
  // s1：看 A B C D，各 60 秒（廣、深）
  for (const m of ['A', 'B', 'C', 'D']) { open('s1', m); clock.advance(60 * SEC); }
  call('s1', { event: 'leave', asset_name: '出口' });
  // s2：看 A B C D，各 5 秒（廣、淺 → 都是瞥過）
  for (const m of ['A', 'B', 'C', 'D']) { open('s2', m); clock.advance(5 * SEC); }
  call('s2', { event: 'leave', asset_name: '出口' });
  // s3：只看 A，120 秒（窄、深）
  open('s3', 'A'); clock.advance(120 * SEC); call('s3', { event: 'leave', asset_name: '出口' });
  // s4：只看 B，5 秒（窄、淺），再看一次 B
  open('s4', 'B'); clock.advance(5 * SEC); open('s4', 'C'); clock.advance(3 * SEC); open('s4', 'B'); clock.advance(4 * SEC);
  call('s4', { event: 'leave', asset_name: '出口' });
  // s5：只點模型
  call('s5', { event: 'click', asset_name: 'Car 1', asset_type: 'models' });
  clock.advance(60 * 60 * SEC);
  fa.closeIdleSessions();

  const r = an.analyze({});
  assert.equal(r.summary.students, 5);
  assert.equal(r.summary.materials, 4);
  const st = Object.fromEntries(r.engagement.map((e) => [e.student_id.replace('user:', ''), e]));
  assert.equal(st.s1.breadth_pct, 100);
  assert.equal(st.s1.depth_s, 60);
  assert.equal(st.s2.glance_pct, 100);
  assert.equal(st.s4.revisits, 1);
  assert.equal(st.s5.profile, '未開啟教材');
  assert.equal(st.s1.profile, '深度探索型');
  assert.equal(st.s2.profile, '廣泛瀏覽型');
  assert.equal(st.s3.profile, '專注聚焦型');
  assert.equal(st.s4.profile, '淺嘗即止型');

  const mat = Object.fromEntries(r.materials.map((m) => [m.name, m]));
  assert.equal(mat.A.attraction_pct, 60);      // s1 s2 s3 / 5
  assert.equal(mat.B.revisit_pct, 33.3);       // s4 開兩次 / 3 人
  assert.equal(mat.A.first_picks, 3);          // s1 s2 s3 都從 A 開始
  assert.equal(r.summary.diligent_pct, 40);    // s1 s2 看超過一半 / 5

  assert.ok(r.lsa.N > 0);
  assert.ok(r.lsa.codes.some((c) => c.code === 'EX'));
  assert.ok(r.observations.some((o) => o.category === 'B'));
  assert.ok(r.observations.some((o) => o.text.includes('未開啟') || o.text.includes('只點了模型')));
});
