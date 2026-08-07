# Nolia Lite

Nolia Lite 是一款极简、本地优先的所见即所得 Markdown 桌面编辑器。每个窗口只处理一份文档，同时支持打开多个独立窗口；Markdown 文本始终是磁盘上的唯一事实来源。

## 特性

- 所见即所得 Markdown 编辑
- 多原生窗口，每个窗口独立保存和监听文件变化
- 表格、任务列表、代码高亮、Mermaid、KaTeX、脚注和安全 HTML
- Markdown 源码保真、外部修改冲突保护与异常草稿恢复
- 独立 HTML 和 PDF 导出
- 本地运行，不需要账号、数据库或网络服务

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

运行完整验证：

```bash
npm run verify
```

构建桌面安装包：

```bash
npm run tauri:build
```

产品需求、技术方案和测试说明位于 [`docs/`](./docs/)。
