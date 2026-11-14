# 二维正态分布 · 3D 交互实验室

> 属于 [概率论可视化](../index.html) 合集 · 返回入口页

一个自包含的交互式网页，用三维曲面可视化二维正态分布的联合概率密度函数：

$$
f(x,y)=\frac{1}{2\pi\sigma_1\sigma_2\sqrt{1-\rho^2}}
\exp\left[-\frac{1}{2(1-\rho^2)}
\left(\frac{(x-\mu_1)^2}{\sigma_1^2}
-\frac{2\rho(x-\mu_1)(y-\mu_2)}{\sigma_1\sigma_2}
+\frac{(y-\mu_2)^2}{\sigma_2^2}\right)\right]
$$

## 打开方式

直接双击 `index.html` 即可。页面把 Three.js 和全部样式都内联在一个 HTML 文件里，不需要联网、服务器或额外安装。

## 项目结构

```text
.
├─ index.html          # 最终成品，单文件，双击打开
├─ README.md           # 本说明
├─ preview/            # 预览截图（桌面、笔记本、手机、参数偏移）
├─ src/
│  ├─ index.html       # 页面结构 + CSS（模板）
│  └─ main.js          # Three.js 场景、曲面、坐标轴与交互逻辑
├─ dist/               # 本地构建产物（已忽略，不提交）
│  ├─ app.js           # esbuild 打包后的 JS
│  └─ index.html       # 成品副本
├─ build.mjs           # 将 dist/app.js 内联回 HTML 的构建脚本
├─ package.json        # 开发依赖与构建命令
├─ package-lock.json   # 依赖版本锁定
└─ .gitignore          # 忽略 node_modules 等本地文件
```

运行页面只需要 `index.html`；`src/`、`build.mjs`、`package.json` 等只在修改和重新构建时需要。首次构建前运行 `npm install`，生成的 `node_modules/` 不会提交。

## 功能

- **3D 曲面**：高度表示概率密度 $f(x,y)$，颜色由低到高采用 plasma 色带；曲面上的深色/浅色闭合曲线是等密度椭圆。
- **自由视角**：鼠标左键拖拽旋转，滚轮缩放，右键平移，双击画布或点击“重置视角”回到初始机位。
- **自动旋转**：默认开启；拖动视角时自动暂停，松开后继续。可在左侧面板关闭。
- **五参数实时调节**：
  - $\mu_1,\mu_2 \in [-2,2]$：峰值所在的 x、y 位置；
  - $\sigma_1,\sigma_2 \in [0.4,1.6]$：两个方向的扩散程度；
  - $\rho \in [-0.95,0.95]$：相关系数，决定等高线椭圆的倾斜与狭长程度。
- **快速预设**：标准正态、强正相关、强负相关、狭长山脊。
- **实时读数**：峰值密度 $f(\mu_1,\mu_2)$、协方差 $\rho\sigma_1\sigma_2$、相关系数状态和 z 轴实际刻度。
- **响应式布局**：桌面端左右分栏，窄屏时上下排列。

## 一个读图细节

为了让不同参数下的曲面都保持可观察的高度，曲面峰高采用 **自动归一化**（峰值统一映射到固定高度），但 z 轴刻度会同步更新为真实的概率密度数值。图例中的“高度自动缩放”提示了这一点。

## 开发与构建

源文件：

- `src/index.html`：页面结构和样式；
- `src/main.js`：Three.js 场景、曲面几何、坐标轴、交互和 UI 逻辑；
- `build.mjs`：把打包后的 JS 内联回 HTML 的脚本。

重新构建：

```powershell
npm install
npm run build
```

`npm run build` 会先用 esbuild 打包 `src/main.js`，再由 `build.mjs` 把 JS 内联回 HTML。成品输出为根目录的 `index.html`，同时在 `dist/index.html` 留有一份本地副本（`dist/` 已在 `.gitignore` 中忽略）。

## 第三方许可

3D 渲染基于 [three.js](https://threejs.org/)，遵循 MIT License，Copyright © 2010-2025 three.js authors。
