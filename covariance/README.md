# 协方差实验室

> 属于 [概率论可视化](../index.html) 合集 · 返回入口页

一个纯前端、可交互的协方差可视化页面，用拖拽、散点和动态公式帮助理解：

> 方差：独自波动。协方差：结伴波动。

![页面预览](preview.png)

## 内容

- **先拆词**：从“co-（共同）+ variance（波动）”理解协方差的命名。
- **拖点实验室**：拖动散点，实时观察协方差、相关系数，以及每个点对协方差的“投票”。
- **相关旋钮**：调节 ρ、σX、σY，理解协方差与相关系数的区别。
- **公式解剖**：拆解 `Cov(X,Y) = E[(X−EX)(Y−EY)]` 的四步含义。
- **常见误区**：`Cov = 0` 不代表独立、数值大不代表关系强、相关不等于因果。
- **自测**：四道选择题，即时反馈与解释。

## 使用

直接双击打开 `index.html`，无需安装依赖，也没有外部 CDN 请求。页面适配桌面、平板和手机。

## 交互

- 拖动散点改变数据，观察协方差和相关系数的变化。
- 切换“正相关 / 负相关 / 几乎无关 / U 形陷阱”四组预设。
- 开启“逐点累加”，看协方差如何由每个点的贡献平均而来。
- 调节 ρ 和 σ 滑块，观察协方差跟着量纲变化，而相关系数保持稳定。
- 完成四道自测题，检查是否真正理解。

## 计算说明

页面使用总体形式 `1/n` 计算协方差，便于与 `E[·]` 对应。样本协方差通常使用 `1/(n−1)`，但它不改变符号和直观含义。

## 参考

- [Wikipedia · 协方差](https://zh.wikipedia.org/wiki/%E5%8D%8F%E6%96%B9%E5%B7%AE)
- [Khan Academy · Covariance and correlation](https://www.khanacademy.org/math/statistics-probability/describing-relationships-quantitative-data/more-on-correlation/a/covariance-and-correlation)
- [Cross Validated · 零协方差与独立](https://math.stackexchange.com/questions/4194711/confused-about-zero-covariance-and-independence)

## 技术

单文件 HTML + CSS + JavaScript，使用 Canvas 绘制图形，无框架、无运行时依赖。

源码拆分在 `src/`（`shell.html` + `style.css` + `app.js`），修改后运行：

```powershell
npm run build
```

即可重新生成内联的 `index.html`。