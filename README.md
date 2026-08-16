# Nolia Lite

Nolia Lite 是一款轻量、本地优先的所见即所得 Markdown 桌面编辑器。每个窗口只处理一份文档，可同时打开多个独立窗口；磁盘上的 Markdown 文本始终是唯一事实来源。

## 文档索引

| 文档 | 内容 |
|---|---|
| [产品需求](./docs/PRODUCT_REQUIREMENTS.md) | 产品定位、功能范围、非目标与验收标准 |
| [UI/UX 规格](./docs/UI_UX_SPEC.md) | 页面布局、编辑交互、视觉、图标与可访问性 |
| [技术方案](./docs/TECHNICAL_DESIGN.md) | 架构、数据模型、文件安全、系统集成与性能约束 |
| [测试与发布](./docs/TESTING.md) | 自动化门禁、原生验收、当前结果与发布条件 |
| [Markdown 全元素验收](./docs/MARKDOWN_ELEMENT_SHOWCASE.md) | 编辑器页面级展示与交互语料 |

以上文件是项目文档的唯一入口。功能、交互或架构发生变化时，应直接更新对应基线文档，不新增临时方案、阶段总结或重复报告。

## 核心能力

- 连续所见即所得 Markdown 编辑与全文源码模式。
- 标题大纲、行内格式、链接、图片、表格、代码块、公式、脚注和安全 HTML。
- Mermaid、流程图和时序图的渲染、编辑、查看与导出。
- 多原生窗口，每个窗口独立保存、监听外部修改和执行关闭保护。
- Markdown 源码保真、异常草稿恢复及 HTML、PDF 导出。
- 完全本地运行，不需要账号、数据库或网络服务。

## 技术栈

- Tauri 2 + Rust
- React 19 + TypeScript
- Vite
- Tiptap 3 / ProseMirror
- Vitest + Testing Library

## 本地开发

环境要求：Node.js、npm、Rust，以及对应平台的 Tauri 系统依赖。

```bash
npm install
npm run tauri:dev
```

执行完整验证：

```bash
npm run verify
npm audit --omit=dev
npm run test:release
```

构建桌面安装包：

```bash
npm run tauri:build
```

构建产物位于 `src-tauri/target/release/bundle/`。
