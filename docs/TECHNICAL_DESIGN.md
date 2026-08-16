# Nolia Lite 技术方案

> 版本：0.3
> 状态：当前技术基线
> 关联需求：[PRODUCT_REQUIREMENTS.md](./PRODUCT_REQUIREMENTS.md)
> 关联测试：[TESTING.md](./TESTING.md)
> 首期平台：macOS

## 1. 文档目的

本文定义 Nolia Lite MVP 的技术架构、核心数据模型、编辑器实现、文件安全策略、系统集成、安全边界、性能预算和测试方案。

本文是实现约束，不是功能愿望清单。任何实现选择都必须优先满足以下顺序：

1. 不丢失用户内容。
2. 不静默覆盖外部修改。
3. 不因打开或无修改关闭而改写文件。
4. 保持单窗口单文档、可独立多开、单一所见即所得模式。
5. 保持离线、轻量和快速。
6. 在以上约束成立后，再优化视觉和编辑便利性。

## 2. 方案摘要

Nolia Lite 使用 Tauri 2 构建 macOS 桌面应用：

- Rust 负责文件读写、文件指纹、原子替换、草稿、最近文件、文件监听和系统对话框。
- React + TypeScript 负责每个窗口内的单文档会话和交互状态。
- Tiptap 3 / ProseMirror 负责所见即所得编辑、选择、输入规则和撤销栈。
- `marked` 负责保留原始顶层单元边界，`@tiptap/markdown` 负责编辑树解析和受控序列化，不将 HTML 作为文档事实来源。
- 编辑器采用“原始源码块 + 可编辑节点”的保真模型：未修改块直接复用打开时的原始 Markdown，只有用户实际修改过的块才重新序列化。
- Frontmatter 和无法可靠往返的语法使用局部源码节点；HTML 只经过严格清洗后渲染，任何不安全内容仍走保护路径。
- 编辑器运行时与轻量历史应用壳分包；KaTeX 和常用语言高亮随编辑器加载，图表引擎按图类型动态加载。
- 应用不使用数据库、账号、网络请求、索引、工作区、插件运行时或窗口内多文档会话。

该方案复用 Nolia 已验证的设计思想，但不直接复用其工作站架构。尤其不能直接复制 Nolia 的 Electron 壳、工作区服务、SQL 数据层、全文索引、AI、插件、图谱、多标签页或多编辑模式。

## 3. 产品边界

### 3.1 必须进入 MVP

- 多个原生窗口，每个窗口只承载一份文档。
- 新建、打开、Finder 打开方式、拖放打开、保存、另存为。
- 已有路径文档停止输入约 800ms 后自动保存。
- 未保存草稿恢复。
- 文件外部修改、删除和不可写状态处理。
- 文档内查找、撤销、重做。
- 最多 5 个最近文件。
- 当前渲染文档的独立 HTML 导出，以及由系统 WebView 直接生成 PDF 文件。
- PRD 第 6.1 节列出的 Markdown 能力。
- UTF-8、BOM、LF/CRLF、Frontmatter、相对路径和未知语法保真。
- 浅色/深色、键盘操作和最小窗口可用性。

### 3.2 明确不进入 MVP

- 工作区、文件夹树和标签页。
- 分屏预览模式；全文源码模式是同一 Markdown 状态的另一编辑表面，不属于第二份文档模型。
- 跨文件搜索、替换、目录扫描、索引和数据库。
- Markdown 插件、用户脚本、命令面板。
- AI、账号、同步、协作和遥测。
- Wiki Link、反向链接和跨文档自动目录。
- Word、RTF、EPUB 等需要独立转换运行时的导入导出。
- 文档导入、批量导出、导出模板和复杂打印设置。
- 自动更新服务和任何运行时网络依赖。
- 主题市场、自定义 CSS 和复杂编辑器设置。

### 3.3 实现边界

- 编辑体验采用即时排版、局部语法显现、单列画布和低干扰交互。
- 参考 Nolia 的 Tiptap 编辑规则、文件哈希冲突、原子保存、草稿和测试用例。
- 单文档编辑能力以 Nolia 为行为基线；工作区和跨文档能力不随之迁移。
- PRD 是最终裁决依据；本文与 PRD 冲突时，以 PRD 为准并修订本文。

## 4. 架构决策

| 编号 | 决策 | 原因 |
|---|---|---|
| ADR-01 | 使用 Tauri 2，不使用 Electron | 复用系统 WebView，满足安装包和内存目标 |
| ADR-02 | 每份文档使用独立原生窗口 | 同时处理多文件，同时保持窗口内单会话与无标签页界面 |
| ADR-03 | Rust 独占磁盘写入 | 将冲突检查和原子替换放在同一可信边界内 |
| ADR-04 | Markdown 是持久化事实来源 | 不保存 HTML、ProseMirror JSON 或专有文档格式 |
| ADR-05 | Tiptap 只作为编辑运行时 | ProseMirror 文档不能取代 Markdown 源文件 |
| ADR-06 | 按顶层块保留原始 Markdown | 满足只规范化用户修改块的保真要求 |
| ADR-07 | 未知语法转为受保护源码节点 | 宁可局部显示源码，也不能静默删除内容 |
| ADR-08 | 不使用数据库 | 最近文件和草稿用小型 JSON 文件即可 |
| ADR-09 | 不引入全局状态库和路由 | 每个 WebView 的单文档会话只需本地 reducer，原生层仅维护窗口注册表 |
| ADR-10 | 不加载远程资源 | 保证默认无网络请求，避免文档触发外部内容 |
| ADR-11 | 常用语言使用本地语法高亮 | 与 Nolia 的代码块体验一致；只注册 Lowlight `common` 集合，未知语言回退纯文本 |
| ADR-12 | 外部富文本粘贴按纯文本处理 | 避免不可靠 HTML 转 Markdown 和脚本风险 |
| ADR-13 | 复杂 Markdown 行为与 Nolia 对齐 | Lite 精简应用壳，不制造第二套编辑手势 |
| ADR-14 | 应用壳与编辑器分包，Mermaid 动态加载 | 保持历史状态与普通文档的启动时间和内存边界 |
| ADR-15 | Mermaid 使用 strict security mode | 图表文本不能执行 HTML、脚本或外部嵌入 |
| ADR-16 | HTML 导出使用当前渲染快照，PDF 使用系统 WebView 原生文件输出 | 保留表格、公式、Mermaid 和本地图片展示，不显示打印面板，同时不引入 Chromium/Pandoc/Office 运行时 |

## 5. 总体架构

```text
macOS Finder / Menu / Drop
            |
            v
+---------------- Tauri Runtime ----------------+
| Single instance + native window registry      |
|                                                |
| Rust application core                         |
|  - DocumentFileService                        |
|  - AtomicSaveService                          |
|  - DraftService                               |
|  - RecentFileService                          |
|  - FileWatchService                           |
|  - NativeDialogService                        |
|            | typed Tauri commands/events      |
+------------|-----------------------------------+
             v
+---------------- WebView -----------------------+
| React application shell                       |
|  - AppController                              |
|  - DocumentSession reducer                    |
|  - EditorHost                                 |
|  - FindController                             |
|  - transient dialogs/banners                  |
|                                                |
| Markdown source model                         |
|  - parse source into source-preserving blocks |
|  - produce ProseMirror JSON                   |
|                                                |
| Tiptap / ProseMirror                          |
|  - WYSIWYG view                               |
|  - input rules / selection / history          |
|  - serialize only changed top-level blocks    |
+------------------------------------------------+
```

Rust 不理解 Markdown 语义，只处理字节、路径和文件一致性。Markdown 解析与编辑在前端完成；保存前产生的仍是 Markdown 文本。

## 6. 技术栈与依赖原则

### 6.1 应用层

- Tauri 2.x。
- Rust stable，提交 `rust-toolchain.toml` 固定工具链。
- React + TypeScript strict。
- Vite。
- CSS Modules 或少量分层全局 CSS；不引入大型 UI 框架。
- Lucide React 用于工具按钮图标。

### 6.2 编辑层

- `@tiptap/core`、`@tiptap/react`、`@tiptap/pm`。
- 只启用 MVP 需要的 ProseMirror schema 与扩展。
- `@tiptap/markdown` 负责 Markdown 与 ProseMirror JSON 的转换。
- `marked` 负责按词法 token 切分原始顶层单元，自建源码跟踪层负责复用未修改原文。

不使用整套 Markdown-to-HTML-to-Markdown 往返作为保存通道。HTML 可以用于测试渲染对照，但不能参与最终持久化。

### 6.3 Rust 层

- `serde` / `serde_json`：IPC 和本地小型 JSON。
- `sha2`：精确字节指纹。
- `notify`：监听当前文件所在目录。
- `tempfile` 或等价的同目录临时文件实现：安全替换。
- Tauri 官方 dialog / single-instance 能力，前提是不扩大文件系统权限。

每加入一个依赖必须回答：是否直接服务 MVP、是否引入网络、增加多少产物体积、是否可以用标准库完成。

## 7. 目录职责

```text
src/
  app/
    App.tsx
    documentSession.ts
  bridge/
    contracts.ts
    tauriClient.ts
  components/
    DocumentOutline.tsx
    HistorySidebar.tsx
    TitleBar.tsx
    FindBar.tsx
    StatusBanner.tsx
    DecisionDialog.tsx
  editor/
    MarkdownEditor.tsx
    sourceDocument.ts
    extensions.tsx
    MarkdownSyntaxEditor.ts
    headingOutline.ts
    MermaidBlock.tsx
    mermaidRenderer.ts
    mermaidMarkdown.ts
    ComplexBlocks.tsx
    TableToolbar.tsx
    SelectionToolbar.tsx
    exportDocument.ts
  styles/
    tokens.css
    app.css
    editor.css

src-tauri/
  src/
    main.rs
    lib.rs
    document.rs
    storage.rs
    pdf_export.rs
    error.rs
  capabilities/
    default.json
  tauri.conf.json
```

编辑器领域代码不得依赖窗口组件；Rust 文件服务不得依赖 Markdown 解析。

## 8. 单文档领域模型

### 8.1 DocumentSession

```ts
type DocumentSession = {
  sessionId: string;
  kind: "untitled" | "file";
  filePath?: string;
  displayName: string;
  markdown: string;
  savedMarkdown: string;
  format: DocumentFormat;
  baseFingerprint: FileFingerprint | { sha256: "new"; size: 0; mtimeMs: 0 };
  revision: number;
  saveState: "clean" | "dirty" | "saving" | "conflict" | "error" | "missing";
  access: "writable" | "readonly-encoding" | "readonly-permission";
  draftId: string;
  externalState?: "changed" | "missing";
};

type FileFingerprint = {
  sha256: string; // 包含 BOM 的精确文件字节哈希
  size: number;
  mtimeMs: number;
};
```

`sessionId` 用于丢弃切换文档后才返回的旧异步结果。`revision` 每次有效编辑递增；保存响应携带请求时的 revision。若保存过程中继续输入，保存成功只更新基线，当前会话仍保持 dirty。

### 8.2 状态不变量

1. 每个窗口同一时刻最多存在一个活动 `DocumentSession`，不同窗口会话互不共享。
2. `clean` 表示当前组合出的 Markdown 与上次成功保存内容相同。
3. `saving` 不阻止继续输入。
4. `conflict` 状态禁止自动保存，直到用户完成冲突决策。
5. 只读文档允许查找和复制，不允许产生编辑事务。
6. 切换、关闭和重新载入都会重建编辑器并清空当前撤销栈。
7. 无修改时不调用保存命令。

### 8.3 应用级状态

每个 WebView 应用实例只保留：

- 当前会话。
- 最近文件列表。
- 当前系统外观。
- 当前打开的临时 UI（查找条、菜单、对话框）。

不保存标签页数组、工作区、导航历史、搜索索引或跨文档缓存。Rust 窗口注册表只保存窗口标签、待打开路径、当前文件路径和独立监听器。

## 9. Markdown 保真架构

### 9.1 为什么不能整篇序列化

常见所见即所得方案会执行：

```text
Markdown -> HTML/编辑器树 -> Markdown
```

即使用户只修改一个字，这条链路也可能统一标题、列表、空行、围栏、链接转义、表格对齐和 Frontmatter 格式，违反 PRD 的保真要求。因此 Nolia Lite 必须保留打开时的原始 Markdown 切片。

### 9.2 顶层源码单元

```ts
type SourceUnit = {
  raw: string;
  kind:
    | "editable"
    | "mermaid"
    | "math"
    | "htmlPreview"
    | "footnote"
    | "frontmatter"
    | "html"
    | "unsupported";
  markdown?: string;
};
```

`marked` lexer 的 token 长度用于把原文切成顶层 `SourceUnit`。切分时建立 LF 位置到原始 CRLF 位置的映射，因此每个 `raw` 仍保留原始换行和块后分隔符。

转换为 ProseMirror JSON 后，每个已有顶层节点保存三个跟踪属性：

- `sourceRaw`：打开时对应的完整原始文本。
- `sourceCanonical`：移除跟踪属性后的节点 JSON 签名。
- `sourceIndex`：打开或重新建立基线时的顶层顺序。

### 9.3 支持分类

| Markdown 内容 | 编辑表示 | 保存方式 |
|---|---|---|
| 段落、标题、强调等已支持语法 | 正常 ProseMirror 节点 | 未改复用原文；已改重新序列化该顶层块 |
| Frontmatter | 顶部局部源码节点 | 未改逐字复用；编辑后按用户输入保存 |
| 安全 HTML | 清洗后的预览 + 局部源码节点 | 未改复用原文；编辑后保存局部源码 |
| 不安全 HTML | 受保护源码节点，不渲染 | 原样或按局部源码编辑结果保存 |
| Mermaid | 专用原子节点 + SVG 预览 + 查看器 | 未改复用完整围栏；已改保存局部 Markdown |
| 行内/块公式 | KaTeX 预览 + 局部源码节点 | 保留 `$...$` / `$$...$$` Markdown |
| 脚注 | 可导航引用 + 局部源码定义块 | 保留脚注标签和定义 Markdown |
| 未支持的块级语法 | 受保护源码节点 | 原样或按局部源码编辑结果保存 |
| 含未支持行内语法的块 | 整个顶层块降级为受保护源码节点 | 防止局部丢失 |
| 解析失败区域 | 受保护源码节点 + 诊断标记 | 禁止静默删除 |

“受保护”不等于不可见。节点以安全的等宽源码样式显示，可局部进入源码输入；它不是全局源码模式，也不会影响其他块的渲染状态。

### 9.4 解析流程

1. Rust 返回去除 BOM 后的 UTF-8 字符串，同时保留格式元数据和精确字节哈希。
2. 识别文档开头的 Frontmatter，并使用 `marked` lexer 切分剩余顶层 token。
3. 代码围栏占位文本不会按 HTML 处理；真正的 HTML token 再执行安全预览判断。
4. Mermaid、数学、脚注和安全 HTML 转为专用占位节点；不安全 HTML、Wiki Link 和未知指令进入保护节点。
5. `@tiptap/markdown` 将占位后的 Markdown 解析为 ProseMirror JSON。
6. 当节点数与源码单元数一致时，按顺序写入 `sourceRaw`、`sourceCanonical` 和 `sourceIndex`。
7. 使用 ProseMirror `fixTables` 修复加载后的表格结构，再重建源码跟踪基线，初始化修复不产生用户编辑。
8. 使用完成基线化的 JSON 创建 Tiptap 编辑器；解析过程不写磁盘或草稿。

预扫描采用“宁可多保护，不可误转换”的策略。没有被扩展解析器识别的普通字符仍按文本显示；只要转换器不能证明一个块可以无损表达，就不把它放入常规编辑 schema。

### 9.5 编辑与变更识别

- 编辑器更新时移除跟踪属性并计算当前顶层节点的 canonical JSON。
- canonical 签名和顶层顺序都未变化时，该节点仍可直接复用 `sourceRaw`。
- 内容、markup 或顺序发生变化的节点由 Markdown manager 单独序列化。
- 新节点没有跟踪属性，始终按当前会话的换行风格生成 Markdown。
- 仅选择变化、查找装饰、滚动和焦点变化不增加 revision。
- IME composition 期间不序列化、不触发自动保存；在 `compositionend` 后合并为一次有效编辑。
- Undo 恢复到保存基线时，会话 Markdown 与 `savedMarkdown` 相等并回到 clean。

### 9.6 保存组合算法

保存前按编辑器当前顶层节点顺序组合 Markdown：

1. 节点具有 `sourceRaw`，canonical 签名相同且 `sourceIndex` 等于当前顺序时，直接复用原始文本。
2. 其他节点移除跟踪属性后，由 `@tiptap/markdown` 单节点序列化。
3. 新生成内容统一为会话首选 LF/CRLF，并移除序列化器额外添加的尾部空白。
4. 原节点末尾已有两个及以上换行时复用该分隔符；否则在非末尾节点后生成两个首选换行。
5. 原末尾节点是否带换行保持不变；新增末尾节点不强制增加换行。
6. BOM 由 Rust 写入字节时恢复，不进入编辑器文本。

该算法保证：只打开和关闭时零写入；只修改一个段落时，其他块、Frontmatter 和未知语法保持原样。

### 9.7 支持的编辑器 schema

块节点：

- paragraph、heading 1-6。
- blockquote、bulletList、orderedList、taskList。
- listItem、taskItem。
- codeBlock、horizontalRule。
- table、tableRow、tableHeader、tableCell。
- frontmatterSource、protectedSource。

行内节点和 marks：

- text、hardBreak、image。
- bold、italic、strike、inlineCode、link。

软换行保存在段落文本中；是否输出显式换行由修改块 serializer 决定。未修改段落不会受影响。

### 9.8 Markdown 输入规则

必须覆盖：

- `# ` 至 `###### ` -> 标题。
- `> ` -> 引用。
- `- `、`* `、`+ ` -> 无序列表。
- `1. ` -> 有序列表并保留起始编号。
- `- [ ] `、`- [x] ` -> 任务列表。
- 三个反引号后按 Enter -> 代码块。
- 文档第一个空块输入 `---` 后按 Enter -> 创建包含起止定界符的 Frontmatter 局部源码区域，并把光标放入其中。
- 其他位置输入 `---`、`***` 或 `___` 后按 Enter -> 分隔线。
- 成对输入 `**`、`*`、`~~`、反引号后形成对应行内格式。

输入规则必须支持中文输入法，不得在 composition 中间抢占文本。

### 9.9 特殊元素

#### Frontmatter

- 仅识别文档开头的 `---` Frontmatter。
- 不解析或重写 YAML，不提供表单。
- 显示为局部等宽源码区域。
- 未编辑时逐字节复用；编辑后只替换该区域。

#### 代码块

- 使用 `lowlight` 对已知语言做本地语法高亮；未知语言回退为纯文本。
- 当前代码块显示紧凑语言选择器，语言变更只修改当前围栏信息。
- 保留语言标识；修改后选择足以包住内容的反引号围栏长度。
- 未修改时保留原围栏字符、长度和缩进。

#### 表格

- 支持插入、单元格文本编辑、Tab/Shift+Tab 导航、前后增加/删除行列、删除整表和表头切换。
- 支持当前单元格左/中/右对齐、10x10 尺寸选择器、右键菜单和整表 Markdown 源码编辑。
- 不支持合并单元格、复杂嵌套块和电子表格公式。
- 未修改表格保留原始对齐与空格；修改后规范化该表格。

#### Mermaid

- 识别 `mermaid` 及 Nolia 已支持的流程图、时序图等围栏别名，并转换为独立顶层原子节点。
- 普通点击进入完整围栏的局部源码编辑；`Command/Ctrl+Click` 在独立查看器打开当前 SVG。
- 查看器初始比例为 125%，按 25% 步长缩放，范围 50%-300%，支持重置、PNG 下载、Escape 关闭和 F2/E/修饰键 Enter 返回源码。
- `mermaid` 通过动态 `import()` 加载；渲染调用串行化，配置 `securityLevel: "strict"`、禁用 HTML label，不加载远程资源。
- 无效源码只在该块显示错误，不能替换 Markdown、污染撤销栈或阻止其他块编辑。
- 复制原子节点写入 Markdown 围栏，不复制生成的 SVG。

#### 公式、脚注与 HTML

- KaTeX 负责行内和块公式排版，源码输入始终保留 Markdown 定界符。
- 脚注引用可导航至定义；引用和定义均提供局部源码入口，标签重命名必须同步或明确报错。
- HTML 先经过 schema 白名单清洗；脚本、事件属性、iframe、object、远程媒体和危险 URL 永不执行。

#### 链接

- `href` 的 Markdown 原字符串属于文档内容；解析结果不得写回源码，也不得被自动 URL 规范化。
- 普通点击直接向应用发送 `{ href, newWindow: false }`；锚点在当前编辑器内跳转，本地 Markdown 路径经 Rust 校验后替换当前文档。
- `Command/Ctrl+Click` 发送 `{ href, newWindow: true }`；本地 Markdown 路径经 Rust 校验后创建独立原生窗口。
- 本地文档支持相对、父目录和绝对路径；无扩展名路径按 `.md`、`.markdown` 顺序解析。空路径、NUL、无效盘符、非 Markdown、缺失和非文件目标被拒绝。
- 外部协议由 opener 交给系统默认应用，WebView 不请求目标 URL。
- 新建或编辑链接统一使用 `Command/Ctrl+K` 的“文本 + 链接”两字段表单。

#### 图片

- Markdown 中始终保留用户输入的图片路径字符串。
- 前端请求 Rust 读取相对、父目录或绝对路径对应的本地图片，返回内存字节并生成短期 blob URL。
- 路径解析结果不写回 Markdown。
- 选择或拖入图片时，Rust 原子复制到文档同级 `assets/`，同名不同内容自动编号；相同内容复用既有文件。
- 粘贴图片时，前端把剪贴板字节交给 Rust 写入 `assets/`，再插入相对 Markdown 路径。
- `http:` / `https:` 图片不加载，只显示带 alt/path 的占位内容。
- 图片不存在、不是文件、超过大小上限或格式不支持时显示稳定占位，不影响保存。
- 原始 HTML、SVG 脚本和嵌入内容不执行。

### 9.10 撤销、重做与查找

- 使用 ProseMirror history；每次打开、重新载入或切换文档创建独立 history。
- `Command+Z` / `Command+Shift+Z` 由编辑器处理，文件操作不进入文本撤销栈。
- 查找使用 ProseMirror plugin decorations，不修改文档内容。
- 查找支持当前文档文本、上一项、下一项、结果计数和 Escape 关闭。
- MVP 不支持替换、正则、跨文件或模糊搜索。

## 10. 文件服务

### 10.1 打开

打开流程必须在 Rust 中完成：

1. 只接受 `.md` 和 `.markdown`，扩展名大小写不敏感。
2. 读取精确字节并计算 SHA-256。
3. 检测 UTF-8 BOM。
4. 对 BOM 后内容执行严格 UTF-8 解码。
5. 非 UTF-8 返回只读结果和编码错误，不猜测 GBK 等其他编码；可额外返回带 Unicode replacement character 的临时预览文本，仅供阅读、查找和复制，永远不能进入保存通道。
6. 根据内容检测首选换行；出现 CRLF 即记录其占比，使用占多数风格，平局优先首个换行。
7. 检查文件是否可写。
8. 返回内容、格式、指纹和访问状态。
9. 成功打开后才更新最近文件并启动监听。

打开不会写回原文件，也不会预先创建历史副本。

### 10.2 安全保存

普通保存请求包含 `filePath`、`baseSha256`、`revision`、`bom`、Markdown 内容和保存模式。

Rust 保存算法：

1. 重新读取目标文件精确字节并计算 SHA-256。
2. 文件不存在且不是新建/另存为时，返回 `missing`。
3. 当前哈希与 `baseSha256` 不同且模式不是用户明确确认的 `force` 时，返回 `conflict`，不写入。
4. 严格检查目标扩展名和可写状态。
5. 在目标文件同一目录创建唯一临时文件，禁止跟随临时路径符号链接。
6. 写入 BOM + 已组合的 Markdown 字节。
7. flush 并 `sync_all` 临时文件。
8. 目标已存在时复制合理的文件权限位。
9. 原子替换前再次读取目标指纹；若它与步骤 1 观察到的基线不同，删除临时文件并返回 `conflict`。
10. 在同一文件系统中原子 rename 替换目标。
11. 尽可能同步父目录，随后重新 stat 并计算新指纹。
12. 返回新指纹和请求 revision。

另存为由 Rust 在同一命令中显示系统保存对话框并执行写入。目标已存在时必须先经过系统覆盖确认；确认后观察到的目标指纹作为本次替换基线，并在 rename 前按上述步骤再次校验。普通保存、明确覆盖和另存为使用同一套临时文件与同步逻辑。

任何步骤失败都保留内存内容和恢复草稿。临时文件清理由错误路径和下次启动维护共同处理，不能删除非本应用命名的文件。

### 10.3 保存响应竞争

- 保存请求记录 `sessionId` 和 `revisionAtStart`。
- 响应只应用于相同 `sessionId`。
- 若成功保存的 revision 小于当前 revision，更新 `baseFingerprint`，但状态仍为 dirty，并重新安排自动保存。
- 若返回 conflict、missing、readonly 或 error，停止自动重试，等待用户操作。
- 同一会话最多一个磁盘保存请求在途；后续编辑只设置 `saveAgain` 标记。

### 10.4 自动保存

- 只对已有可写路径、dirty 且无冲突的会话启用。
- 最后一次有效编辑后 800ms 触发。
- `Command+S` 取消计时并立即保存。
- 新建未命名文档不自动弹出保存对话框。
- 自动保存失败后不循环重试；下一次用户明确编辑或手动保存可重新尝试非冲突错误。

### 10.5 恢复草稿

草稿存于应用数据目录 `Recovery/`，文件名为路径或 untitled UUID 的 SHA-256，不暴露原路径：

```ts
type RecoveryDraft = {
  schemaVersion: 1;
  draftId: string;
  filePath?: string;
  baseSha256: string | "new";
  revision: number;
  markdown: string;
  bom: boolean;
  preferredEol: "lf" | "crlf";
  updatedAt: number;
};
```

- 有效编辑后约 250ms 原子写草稿，与 800ms 磁盘自动保存分离。
- 成功保存对应 revision 后删除已覆盖的草稿。
- 应用异常退出后，打开同一文件时比较草稿 base 与当前磁盘哈希。
- 哈希一致时可恢复或使用磁盘版本；不一致时按冲突处理，可另存草稿。
- 未命名草稿在下次启动的历史面板中提供恢复入口。
- 用户明确“丢弃”后删除草稿；普通失败和崩溃不得删除。

### 10.6 最近文件

- 存于应用数据目录的版本化 JSON。
- 最多 5 条，记录规范化路径和最后打开时间。
- 只在用户成功打开或保存文件后更新。
- 不扫描父目录，不建立索引，不读取文档内容生成摘要。
- 路径不存在时保留为不可用项，用户点击后提示并允许从列表移除。
- 历史面板支持移除单条和清空全部最近记录；两种操作都不触碰磁盘文档或恢复草稿。

### 10.7 文件监听

- 监听当前文件所在父目录，而不是整个用户目录。
- 事件去抖约 150-250ms 后重新读取目标路径指纹。
- 指纹等于最近一次成功保存结果时视为自身保存事件。
- 外部变化只发 `{ kind, fingerprint }`，不自动覆盖编辑器。
- 文件删除或移动导致原路径不存在时进入 `missing`；内容继续留在内存与草稿中。
- 切换文档或退出时立即释放 watcher。

## 11. 文档生命周期

### 11.1 新建

1. 空窗口直接创建 untitled 会话；已有文档时先创建新的原生窗口。
2. 新窗口创建空的 untitled 会话，默认 UTF-8、无 BOM、LF。
3. 创建独立编辑器和撤销栈。
4. 首次编辑后写恢复草稿。
5. 用户手动保存或关闭时才打开保存对话框。

### 11.2 打开或拖放另一文件

1. 逐一校验 `.md` / `.markdown` 路径，无效项拒绝且不影响有效文件。
2. 当前窗口没有会话时，第一份文件复用该窗口；其余文件创建独立窗口。
3. 当前窗口已有会话时，不替换或打断当前内容，所有目标文件进入独立窗口。
4. 窗口注册表发现同一路径已打开时聚焦已有窗口，不创建重复编辑会话。
5. 每个新窗口独立读取文件、处理恢复草稿并创建会话；单个文件失败不清空其他窗口。

### 11.3 关闭与退出

- 单窗 clean：直接关闭，不调用保存。
- 单窗 dirty 且已有可写路径：立即保存；成功后关闭。
- dirty 且未命名：保存/丢弃/取消。
- conflict/error/missing：另存为/保留恢复草稿并退出/取消。
- 用户选择丢弃才删除草稿。
- 单个窗口关闭只执行该窗口的 guard；`Command+Q` 由原生层依次请求每个窗口确认，全部通过后退出。

关闭最后一个窗口即结束应用，避免隐藏进程继续持有文件监听和文档状态。

## 12. Tauri 与 macOS 集成

### 12.1 单实例和多窗口

- 应用启动创建一个主窗口，后续文档通过同配置的独立 WebView 窗口承载。
- 第二次启动或 Finder 打开文件时，把路径转发给已有实例。
- 空窗口复用自身；已有文档时为新路径创建窗口；已打开的路径直接聚焦原窗口。
- 菜单、待打开路径、文件监听、关闭事件和标题更新都按窗口标签路由。
- 禁止文档内容通过 `window.open` 任意创建 WebView；新窗口只能由受控 Rust 命令创建。

### 12.2 文件关联

- 注册 `.md` 和 `.markdown` 文件关联。
- macOS 在 Tauri runtime 创建前注册 `NSAppleEventManager` 的 `kAEOpenDocuments` handler，避免首次 Finder/LaunchServices Apple Event 早于默认窗口而丢失。
- AppHandle 尚未就绪时路径进入静态队列；AppHandle 就绪但主窗口尚未创建时进入 `main` 窗口队列；窗口创建后由前端 `take_pending_open_paths` 握手消费。
- 应用已运行时的 open-file 事件、单实例转发和前端打开路径均按窗口 label 路由；窗口事件使用定向 emit，不能广播到其他文档窗口。
- 路径在 Rust 侧规范化与校验，前端不能直接读任意路径。

### 12.3 拖放

- 使用 Tauri 原生文件 drop 事件。
- 接受一个或多个本地 Markdown 文件，每份文件进入独立窗口。
- 编辑器内部拖动选区与窗口文件拖放必须区分。
- 拖入图片复制到当前文档同级 `assets/` 并插入相对 Markdown 路径；未保存文档拒绝导入并提示先保存。

### 12.4 原生菜单

保留 macOS 标准应用菜单和以下命令：

- File：New、Open、Save、Save As、Export HTML、Export PDF、Close。
- Edit：Undo、Redo、Cut、Copy、Paste、Find、标题/段落、列表、引用、代码、行内格式、链接、图片、表格、Mermaid 和公式。
- View：Source Mode、Full Screen。
- Window：Minimize、Zoom。

导出仅作为 File 菜单中的紧凑子菜单出现；不增加工作区、视图模式、插件、导出中心或命令面板菜单。

HTML 先复制当前渲染快照、移除编辑控件，再通过 Rust 原子写入独立文件。PDF 直接打印当前已经完成渲染的 WebView 文档：前端先等待字体和图片稳定，Rust 在目标目录创建临时 `.pdf`，各平台静默输出后校验 `%PDF-` 文件头，再原子替换用户选择的路径。

- macOS：`WKWebView.printOperationWithPrintInfo` + `NSPrintSaveJob`。
- Windows：WebView2 `ICoreWebView2_7::PrintToPdf`。
- Linux：WebKitGTK `PrintOperation` + `Print to File` PDF 设置。

原生输出统一使用 A4、包含背景、不包含页眉页脚；60 秒未完成按失败处理。失败时临时文件自动清理，现有目标文件不得被半成品覆盖。PDF 仅复用系统已有 WebView，不打包 Chromium、Pandoc、Office 或网络转换服务。

### 12.5 跨平台窗口控件边界

MVP 仍只发布 macOS，但窗口配置不得把 macOS 的按钮布局硬编码到其他平台：

- macOS 使用 `Overlay` 原生标题栏，关闭、最小化、缩放 traffic lights 位于左侧；WebView 只预留左侧安全区，不绘制替代按钮。
- Windows 使用带 decorations 的原生标题栏，最小化、最大化、关闭按钮由系统放在右上角；文档工具栏位于原生标题栏下方，不覆盖 caption buttons。
- Linux 使用带 decorations 的原生窗口，由当前桌面环境和窗口管理器决定按钮位于左侧或右侧；应用不假设固定位置。
- 三个平台都禁止在 WebView 中重复绘制关闭、最小化、最大化控件，避免双标题栏按钮、错误命中区和无障碍语义冲突。

平台差异通过 `tauri.macos.conf.json`、`tauri.windows.conf.json` 和 `tauri.linux.conf.json` 隔离。Windows/Linux 配置不启用 macOS overlay、hidden title 或 traffic-light position。

## 13. IPC 契约

所有命令参数和返回值在 Rust 与 TypeScript 两侧定义并校验。前端只暴露面向用例的 API，不暴露通用文件系统能力。

```ts
type BackendApi = {
  pickMarkdownFile(): Promise<{ path?: string }>;
  pickMarkdownSavePath(defaultName: string): Promise<{ path?: string }>;
  pickExportSavePath(format: "html" | "pdf", defaultName: string): Promise<{ path?: string }>;
  readDocument(path: string): Promise<ReadDocumentResult>;
  saveDocument(request: SaveDocumentRequest): Promise<SaveDocumentResult>;
  writeExportDocument(request: { path: string; format: "html"; content: string }): Promise<string>;
  exportPdf(path: string): Promise<string>;
  writeDraft(request: WriteDraftRequest): Promise<void>;
  deleteDraft(draftId: string): Promise<void>;
  listRecoverableDrafts(): Promise<RecoveryDraftSummary[]>;
  listRecentFiles(): Promise<RecentFile[]>;
  removeRecentFile(path: string): Promise<void>;
  readRelativeImage(request: RelativeImageRequest): Promise<ImageBytesResult>;
};
```

保存返回值使用判别联合：

```ts
type SaveDocumentResult =
  | { status: "saved"; revision: number; fingerprint: FileFingerprint; filePath: string }
  | { status: "conflict"; revision: number; disk: FileFingerprint }
  | { status: "missing"; revision: number }
  | { status: "readonly"; revision: number; reason: string }
  | { status: "cancelled"; revision: number }
  | { status: "error"; revision: number; code: string; message: string };
```

错误不通过未分类字符串驱动业务分支。

## 14. 安全与隐私

### 14.1 Tauri 权限

- capability 只开放本应用窗口需要的具体命令。
- 不启用通用 shell、HTTP、上传、剪贴板读取或任意文件系统插件权限。
- 系统对话框选择的文件和当前文档关联资源由 Rust 用例命令访问。
- 路径扩展名、规范化结果、符号链接和文件类型在 Rust 侧重新校验。

### 14.2 内容安全策略

生产 CSP 至少满足：

```text
default-src 'self';
connect-src 'none';
script-src 'self';
style-src 'self';
img-src 'self' blob: data:;
font-src 'self';
object-src 'none';
frame-src 'none';
base-uri 'none';
```

- 不允许远程图片、iframe、object、embed、音视频或 WebSocket。
- 预扫描判定为静态安全的 HTML 经当前版本 DOMPurify 清洗后进入预览；危险标签或属性仍只显示 protected source。
- 外部链接只能由用户明确 Command+Click 后交给系统浏览器。
- 生产构建不注入远程脚本和在线字体。

### 14.3 隐私

- 不收集遥测和崩溃上报。
- 不持久化搜索词、剪贴板或文档内容日志。
- 生产环境错误日志不写入文档正文、绝对路径或内容片段。
- 草稿和最近文件只在本机应用数据目录。
- 应用正常运行期间零后台网络请求。

## 15. 性能设计

### 15.1 预算

| 指标 | 目标 | 工程预算 |
|---|---:|---:|
| 冷启动首次可交互 | <= 1.5s | WebView shell <= 700ms，编辑器按需加载 |
| 安装包 | <= 25MB | 不引入 Chromium、在线资源和大型高亮包 |
| 空闲内存 | <= 120MB | 单 WebView、单编辑器、无索引/数据库 |
| 自动保存等待 | 约 800ms | 组合 + IPC 不阻塞下一次输入 |
| 输入响应 | p95 <= 16ms | transaction 路径不做整篇解析/序列化 |
| 2MB/10,000 行打开 | 可编辑且滚动流畅 | 打开时一次解析，输入事务不重复解析原始 Markdown |

### 15.2 手段

- 历史状态不加载 Tiptap 和编辑器主包；第一次创建/打开文档时动态加载。
- 全量 Markdown 解析只发生在打开、重新载入或切换全文源码后。
- 输入 transaction 只标记受影响的顶层块，不重建 React tree。
- 自动保存只序列化 dirty blocks。
- 文档内容不复制进多个全局 store；会话与编辑器只持有各自所需状态。
- 图片按可见/请求加载，使用 blob URL，并在节点卸载或切换文档时 revoke。
- 编辑器整体在打开文档时加载；Mermaid 只在文档实际包含图表节点时动态加载，不能反向进入普通编辑器 chunk。
- 大文档优化以实测为准；若使用 `content-visibility`，必须先验证选择、查找和中文输入法，不以破坏编辑正确性换取指标。

### 15.3 测量

- 开发构建不能作为包体和启动验收依据。
- 使用 release 构建在约定参考设备上测量冷启动、RSS、2MB 文档打开、输入和滚动。
- 每个发布候选记录 Tauri bundle 大小和主要前端 chunk 大小。
- 安装包目标按实际分发产物测量；优先提供独立 arm64/x64 包，只有 universal 包仍不超过 25MB 时才合并架构。
- 性能基准固定文档语料并纳入版本库。

## 16. 错误处理

错误分为：

- 用户可决策：conflict、missing、readonly、unsupportedEncoding。
- 可重试：临时 I/O 错误、临时文件替换失败。
- 内容安全：parseFallback、unsupportedSyntax。
- 程序错误：unexpected。

处理原则：

- 任何错误不得清空编辑器。
- 自动保存错误不得反复弹窗或无限重试。
- 错误状态始终保留恢复草稿。
- 可操作错误通过状态条或模态决策界面呈现；普通成功不弹 toast。
- 技术细节可折叠显示，但不得包含文档内容。

## 17. 测试约束

自动化范围、原生验收清单、当前结果和发布门禁统一维护在 [测试与发布](./TESTING.md)，本文件不重复保存执行批次或历史报告。

技术实现必须保证：

1. `open -> compose` 与原文本逐字相等。
2. 未修改 Frontmatter、未知语法和未修改块逐字保留。
3. 修改一个块不会重写其他块。
4. 解析失败不能导致内容减少。
5. 原生行为必须由 release 应用验收，不能只依赖 WebView mock。

## 18. 需求追踪

| 需求 | 主要实现 | 核心测试 |
|---|---|---|
| F-01 新建 | DocumentSession untitled | 新建、首次保存、关闭 guard |
| F-02 打开 | 文件关联、multi-select dialog、drop、window registry、readDocument | 冷/热启动、多选、拖放、重复路径聚焦 |
| F-03 保存 | 800ms controller、atomic save | 立即保存、继续输入、失败 |
| F-04 另存为 | native save dialog、saveAs | 新路径、已存在目标、取消 |
| F-05 恢复草稿 | DraftService | 崩溃、冲突、未命名恢复 |
| F-06 撤销重做 | ProseMirror history | 当前文档隔离、回到 clean |
| F-07 查找 | find plugin | 计数、导航、Escape |
| F-08 最近文件 | versioned JSON, max 5 | 去重、不扫描、失效路径 |
| F-09 外部修改 | watcher + base hash | change/delete/save conflict |
| F-10 窗口状态 | per-window reducer + registry + sequential quit guard | 多窗口 dirty/error/conflict 关闭与退出 |
| F-11 Mermaid 图表 | MermaidBlock + diagram renderer + viewer | 渲染、源码、查看、缩放、复制和导出 |
| F-12 复杂块编辑 | ComplexBlocks + TableToolbar + code controls | 表格、代码、图片、公式、脚注和 HTML 交互 |
| F-13 Markdown 保真 | sourceDocument tracking attributes | 未修改节点、换行、BOM 与受保护语法往返 |
| F-14 文档导出 | rendered snapshot + atomic HTML write + native WebView PDF output | 独立 HTML、扩展名校验、PDF 文件头/原子替换、原生产物、源文件零写入 |
| F-15 文档大纲 | headingOutline + DocumentOutline | H1-H6 提取、缩进、跳转和零编辑事务 |

## 19. 主要风险与控制

| 风险 | 影响 | 控制措施 |
|---|---|---|
| 所见即所得往返改写整篇 Markdown | 数据保真失败 | 原始切片 + dirty block serializer + golden corpus |
| Tiptap schema 无法表达未知语法 | 内容丢失 | 顶层 protected source 降级，不做猜测 |
| 保存与继续输入发生竞态 | 错误显示 clean 或漏存 | sessionId + revision + 单在途保存 |
| 文件监听误判自身写入 | 无意义冲突 | 保存返回指纹去重，保存前哈希仍是最终门禁 |
| 原子替换改变权限或失败 | 文件不可用 | 同目录临时文件、权限复制、sync、失败保留草稿 |
| 大文档使 WebView 卡顿 | 不达性能目标 | 顶层源码复用、按需加载、固定基准与原生性能签收 |
| 复杂渲染器使启动和包体膨胀 | Lite 逐渐变重 | 动态 import、独立 vendor chunk、普通文档不加载 |
| Nolia 与 Lite 编辑手势分叉 | 用户预期和测试重复 | 以 Nolia 交互测试为契约，抽取/移植同一行为 |
| UI 逐渐引入工作站能力 | 产品边界失守 | 新功能必须通过 PRD 第 12 节门槛 |

## 20. 完成定义

技术实现只有同时满足以下条件才算完成：

1. PRD 的 MVP 功能和 15 条验收标准全部通过。
2. 打开并无修改关闭不会写文件。
3. 未修改块、Frontmatter 和未知语法有逐字保真测试。
4. 所有保存路径都执行基线哈希检查和安全替换。
5. 所有失败路径都保留内存内容或恢复草稿。
6. 运行期间默认零网络请求。
7. release 构建达到启动、包体、内存和大文档目标。
8. 文档模式只允许当前文档大纲，不存在文件树、属性侧栏、标签页、源码/预览分屏、AI、插件或工作区入口；无文档时只显示单层历史侧栏，多文档只通过独立原生窗口呈现。
