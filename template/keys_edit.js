// keys_edit.js — 关键帧编辑操作层（控制台 UI 与自动化测试共用）【Skill 模板】。
// 原则：只动 window.PP.keys（渲染器 PK 每帧实时读取，改完下一帧即生效）；
// 铁律不变：不碰代码默认值，改动经 keysPatch() 导出最小补丁走 --params / ?p=。
// 每个操作返回 { ok, conflicts }：conflicts = 触达的原则冲突（居中/连贯/完整），UI 显式列出。
//
// ══ 接入你的项目时唯一要改的地方：PV_RULES 规则表 ══
// 下面这份是《灵锚》示例项目的规则，声明「改了什么部位 → 哪颗球亮 → 提示什么」。
// 换成你项目自己的耦合规则即可，其余代码一律不动。
window.PV_RULES = [
  { test: id => /^camZ/.test(id),            p: '连贯', msg: '相机轨被改：相邻镜头的缩放衔接可能跳变' },
  { test: id => /^iris|^stormSw$/.test(id),  p: '连贯', msg: '转场/风暴耦合：转场时序锚在镜头边界上' },
  { test: id => /^glow|^arc|^calm/.test(id), p: '居中', msg: '光效时序改了：与情绪拍点的对位可能脱拍' },
  { test: id => /^beat:/.test(id),           p: '居中', msg: '情绪拍点改了：角色视线/动作与光效的对位可能脱拍' },
  { test: id => /^shot:/.test(id),           p: '连贯', msg: '切点改了：转场与情绪拍点都锚在旧切点上，需跟着对' },
];

window.PV_KEYS = (() => {
  const DUR = () => PROJECT.duration;
  const tr = id => window.PP.keys.tracks[id];

  // ---------- 原则检查器（居中 / 连贯 / 完整）----------
  // 改动触达哪些部位，就把对应的冲突亮出来——不阻止编辑，但要显式裁决。
  function conflictsOf(parts) {
    const out = [], seen = new Set();
    const add = (p, msg) => { if (!seen.has(msg)) { seen.add(msg); out.push({ p, msg }); } };
    for (const id of parts)
      for (const r of window.PV_RULES || [])
        if (r.test(id)) add(r.p, r.msg);
    return out;
  }

  // ---------- 键级操作 ----------
  function setKey(id, idx, t, v) {
    const k = tr(id) && tr(id).k; if (!k || !k[idx]) return { ok: false };
    t = Math.max(0, Math.min(DUR(), +t));
    const lo = idx > 0 ? k[idx - 1][0] + 1e-4 : 0;
    const hi = idx < k.length - 1 ? k[idx + 1][0] - 1e-4 : DUR();
    k[idx][0] = Math.min(hi, Math.max(lo, t));
    if (v != null && !isNaN(+v)) k[idx][1] = +v;
    return { ok: true, conflicts: conflictsOf([id]) };
  }
  function addKey(id, t) {
    const k = tr(id) && tr(id).k; if (!k) return { ok: false };
    t = Math.max(0, Math.min(DUR(), +t));
    const v = window.PK(id, t);                      // 新键取当前时刻的值（不打断曲线）
    let i = 0; while (i < k.length && k[i][0] < t) i++;
    k.splice(i, 0, [t, v]);
    return { ok: true, idx: i, conflicts: conflictsOf([id]) };
  }
  function delKey(id, idx) {
    const k = tr(id) && tr(id).k; if (!k || k.length <= 1 || !k[idx]) return { ok: false };
    k.splice(idx, 1);
    return { ok: true, conflicts: conflictsOf([id]) };
  }
  function revertTrack(id) {                          // 单轨还原出厂默认
    const d = window.PV_DEFAULTS.keys.tracks[id]; if (!d) return { ok: false };
    window.PP.keys.tracks[id] = JSON.parse(JSON.stringify(d));
    return { ok: true };
  }

  // ---------- 拍点 / 切点 ----------
  function setBeat(shot, idx, absT) {                 // 拍点拖动：绝对时间 → 镜头内 lt（不出镜头）
    const S = window.PP.keys.shots, si = S.findIndex(s => s.id === shot);
    const b = window.PP.keys.beats[shot] && window.PP.keys.beats[shot][idx];
    if (si < 0 || !b) return { ok: false };
    const end = si + 1 < S.length ? S[si + 1].t : DUR();
    b[0] = Math.max(0, Math.min(end - S[si].t - 1e-4, absT - S[si].t));
    return { ok: true, conflicts: conflictsOf(['beat:' + shot]) };
  }
  function setShot(idx, t) {                          // 拖切点 = 改第 idx 个镜头（1..n-1）的开始时间
    const S = window.PP.keys.shots;
    if (idx <= 0 || idx >= S.length) return { ok: false };
    const lo = S[idx - 1].t + .1, hi = (idx + 1 < S.length ? S[idx + 1].t : DUR()) - .1;
    S[idx].t = Math.min(hi, Math.max(lo, +t));
    if (window.PV_registerShots) window.PV_registerShots();
    return { ok: true, conflicts: conflictsOf(['shot:' + S[idx].id]) };
  }

  // ---------- 区间 retime ----------
  // 严格在 (t0,t1) 开区间内的键（全部轨 + 情绪拍点）等比映射到 t0..t1new，边界键不动。
  // 后面的键不跟着位移：区间外的一切保持稳定，这是「这段快一点」最可控的语义。
  function retime(t0, t1, t1new) {
    const s = (t1new - t0) / (t1 - t0);
    if (!isFinite(s) || s <= 0 || t1new <= t0) return { ok: false };
    const touched = [];
    for (const id in window.PP.keys.tracks) {
      let ch = false;
      for (const kk of window.PP.keys.tracks[id].k) {
        const x = kk[0];
        if (x > t0 + 1e-4 && x < t1 - 1e-4) { kk[0] = t0 + (x - t0) * s; ch = true; }
      }
      if (ch) touched.push(id);
    }
    for (const shot in window.PP.keys.beats) {
      const S = window.PP.keys.shots, sh = S.find(x => x.id === shot); if (!sh) continue;
      for (const b of window.PP.keys.beats[shot]) {
        const abs = sh.t + b[0];
        if (abs > t0 + 1e-4 && abs < t1 - 1e-4) { b[0] = (t0 + (abs - t0) * s) - sh.t; touched.push('beat:' + shot); }
      }
    }
    return { ok: true, n: touched.length, conflicts: conflictsOf(touched) };
  }

  // ---------- 补丁 ----------
  // 当前 keys 相对出厂默认的**最小补丁**（轨级/镜级/拍点组级）。
  // 注意 shots 必须整组给出——PV_mergeKeys 对 shots 是整体替换，半组会丢镜头。
  function keysPatch() {
    const d = window.PV_DEFAULTS.keys, p = {};
    for (const id in window.PP.keys.tracks)
      if (JSON.stringify(window.PP.keys.tracks[id]) !== JSON.stringify(d.tracks[id]))
        (p.tracks = p.tracks || {})[id] = JSON.parse(JSON.stringify(window.PP.keys.tracks[id]));
    let shotDirty = false;
    for (const s of window.PP.keys.shots) {
      const ds = d.shots.find(x => x.id === s.id);
      if (!ds || ds.t !== s.t || ds.name !== s.name) shotDirty = true;
    }
    if (shotDirty) p.shots = JSON.parse(JSON.stringify(window.PP.keys.shots));
    for (const sid in window.PP.keys.beats)
      if (JSON.stringify(window.PP.keys.beats[sid]) !== JSON.stringify(d.beats[sid]))
        (p.beats = p.beats || {})[sid] = JSON.parse(JSON.stringify(window.PP.keys.beats[sid]));
    return Object.keys(p).length ? p : null;
  }

  // AI 补丁应用：返回快照供「还原」；AI 触达的轨/拍点记入标记（UI 琥珀描边）。
  const AI = { tracks: new Set(), beats: new Set(), shots: false };
  function applyPatch(patch) {
    if (!patch || typeof patch !== 'object') return { ok: false };
    const snapshot = JSON.stringify(window.PP.keys);
    window.PV_setOverrides({ keys: JSON.parse(JSON.stringify(patch)) });
    AI.tracks.clear(); AI.beats.clear(); AI.shots = false;
    for (const id in (patch.tracks || {})) AI.tracks.add(id);
    for (const sid in (patch.beats || {})) AI.beats.add(sid);
    if (patch.shots) AI.shots = true;
    const parts = [...AI.tracks, ...[...AI.beats].map(s => 'beat:' + s)];
    if (AI.shots) parts.push('shot:*');
    return { ok: true, snapshot, conflicts: conflictsOf(parts) };
  }
  function acceptAI() { AI.tracks.clear(); AI.beats.clear(); AI.shots = false; }
  function restoreKeys(snapshot) {
    window.PP.keys = JSON.parse(snapshot);
    if (window.PV_registerShots) window.PV_registerShots();
    acceptAI();
  }
  return { setKey, addKey, delKey, revertTrack, setBeat, setShot, retime, keysPatch, applyPatch, acceptAI, restoreKeys, aiMarks: () => AI, conflictsOf };
})();
