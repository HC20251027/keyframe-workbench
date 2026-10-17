# 案例：pv_workspace《灵锚》—— 本 skill 的原型工程

15 秒、4 镜头（A 睡在石上 0-4 / B 风暴攥紧 4-8 / C 锚亮了 8-11.5 / D 拉远黎明 11.5-15）、24fps、360 帧，p5.js + p5.brush 生成式笔刷画面。工作台在这部成片之上逐步长出来，共 7 个里程碑。

## 工程结构（git 管理，每里程碑一 commit）

```
pv_workspace/
  STORYBOARD.md  ANIMATION_GUIDE.md  WORKFLOW.md   # 规格/指导/流程三层文档（先行于代码）
  frame.html        # 机器单帧渲染入口 ?t=&s=&p=
  studio.html       # 人工 scrub 预览
  workbench.html    # 专业控制台（= template/workbench.html 原型）
  src/
    config.js       # duration 15, bpm 92, offset 0.3
    core.js         # 引擎：camBegin/camEnd, inkLine, glow, iris, kf/seg/ease, window.ready
    clawd.js        # 角色（emotions 情绪拍点系统）
    timeline.js     # shots() 注册（幂等替换版）
    params.js       # PP 参数层 + PP.keys 关键帧数据层 + PK 求值器 + ?p= 补丁合并
    keys_edit.js    # 编辑操作层（UI 与测试共用）
    scenes/linganchor.js  # 四个镜头，全部读 PK
  build/render_pv.py        # sheet/strip/stills/frames/encode 五种模式 + --params
  build/test_keys_edit.html # 编辑操作层端到端测试（24 项断言）
  out/frames/linganchor/    # 360 帧 PNG（成片序列）
  out/preview/linganchor/   # 360 帧 JPEG 预览条（29MB）
  out/linganchor.mp4        # h264 成片
```

## PP.keys 实际形态（节选）

```js
keys: {
  shots: [ {id:'A',t:0,name:'睡在石上'}, {id:'B',t:4,name:'风暴攥紧'},
           {id:'C',t:8,name:'锚亮了'}, {id:'D',t:11.5,name:'拉远黎明'} ],
  tracks: {
    seaB:   { row:'海浪', k:[[4,.5],[6,.95],[8,1]] },
    fleckC: { row:'碎屑', k:[[8,1],[9.6,.65],[9.6,.45]] },   // 双键=成片怪癖台阶
    arc:    { row:'光弧', k:[[8.4,0],[10.4,1]], e:'ss' },
    camZC:  { row:'相机', k:[[8,1.05],[9.2,1.065]] },
    // ...共 17 条轨
  },
  beats: { C: [[0,'scared'],[.4,'determined'],[2.5,'relieved']], ... },
  markers: [ {t:8, label:'match cut'} ]
}
```

## 验证数据（真实数字，作为"该做到什么程度"的参照）

- 零漂移：17 帧参考对比全过（≤28px 差异、单通道 max≤15，两张 0 差异）。中途抓出两处重构错误（arc 插值模式 'ss' 标成 'ss2' → 光弧区 41k/148k px 差异；漏抄一行 rock 调用）。
- 管线确定性：同代码双渲染自差 12/3 px。
- 编辑层端到端：24 项 ALL PASS，噪声基线 diff=1。
- 控制台确定性：三连跑轨道条区域逐像素一致（预览碎屑区 ≤94px 引擎本底）。
- 补丁链路：改 camZD 末键 → t=13 帧差 178 万像素（端到端生效）。

## 成片怪癖的处置（零漂移铁律的示范）

镜头 C 原代码末键时间误写 `dur`(3.5) 而非绝对时间 11.5 → kf 扫描永不命中 → **成片里 9.6s 后海浪/碎屑烈度恒为 0.45，叙事上的回落 ramp 从未发生**。数据层按实际行为用 9.6 双关键帧固化；规则表里对 seaC/fleckC 的改动提示"放弃复刻、改叙事意图"。

## 里程碑轨迹（可对照方法论分期检查自己）

1. 工程复刻（引擎/文档层/QA 三道门）→ 2. 参数层 params.js（17 旋钮）→ 3. 原始版轨道条（只读，后判定不合格）→ 4. keys 数据层 + 可读轨道条 + 零漂移验证 → 5. 性能：帧序列预览 → 6. 真功能化：dope sheet/graph editor/编辑操作层/原则检查器 → 7. 流畅度：业内标准手法。
