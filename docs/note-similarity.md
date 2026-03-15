# Note Similarity 功能架构说明

> 面向初级工程师，解释「相关笔记推荐」功能的整体思路、模块划分和扩展方式。

---

## 一、这个功能是干什么的？

用户打开一篇笔记时，侧边栏会自动显示 Vault 中与当前笔记最相关的笔记列表。

核心原理：
1. 把每篇笔记的文字内容转换成一个「向量」（一组浮点数，代表文章语义）
2. 存起来，下次不用重算
3. 用户打开笔记时，计算它的向量和其他所有向量之间的「夹角距离」（余弦相似度）
4. 夹角越小 → 越相似 → 排得越靠前

---

## 二、模块文件总览

```
src/
├── services/note-similarity/       ← 核心逻辑（后端）
│   ├── types.ts                    ← 数据结构定义
│   ├── embed-provider.ts           ← 向量化接口 + 两种实现
│   ├── transformers-connector.ts   ← 本地模型的 iframe 桥接
│   ├── similarity-engine.ts        ← 余弦相似度计算
│   ├── storage.ts                  ← 向量数据读写磁盘
│   └── note-similarity-service.ts  ← 统筹调度（入口）
│
├── views/
│   └── similar-notes-view.ts       ← 侧边栏 UI（前端）
│
└── main.ts                         ← 插件主入口，负责初始化和生命周期
```

---

## 三、每个文件的职责

### 3.1 `types.ts` — 数据结构

定义了整个功能用到的所有数据类型。读这个文件可以快速理解数据长什么样。

```
EmbeddingConfigItem   用户在设置中配置的一条「Embedding 配置」
  ├── providerType     'local' | 'openai'  决定用哪种向量化方式
  ├── model            模型名称
  ├── baseUrl          API 地址（openai 模式专用）
  └── apiKey           API 密钥（openai 模式专用）

NoteEmbedding         一篇笔记的向量记录
  ├── vec              向量数组，例如 [0.12, -0.34, ...] 共 384 个数字
  ├── hash             笔记内容的 FNV-1a hash，用来判断内容是否变化
  └── updatedAt        上次计算时间（Unix 毫秒）

EmbeddingStore        整个 Vault 的向量数据库
  ├── modelId          当前使用的模型名（模型换了就清空重建）
  └── notes            { [笔记路径]: NoteEmbedding }

SimilarNote           查询结果中的一条
  ├── path             笔记路径
  └── score            相似度 0~1，越大越相似
```

---

### 3.2 `embed-provider.ts` — 向量化接口

**核心思想**：定义一个统一的接口 `EmbeddingProvider`，后面不管用什么模型，上层代码都不需要改。

```
EmbeddingProvider（接口）
  ├── modelId          模型标识
  ├── batchSize        每次批量处理多少条文本（本地模型 16，API 模型 5）
  ├── batchDelayMs     批次之间等待多少毫秒（API 模式防限流，本地为 0）
  ├── embed()          单条文本 → 向量
  └── embedBatch()     多条文本 → 多个向量（性能关键，GPU 可并行）
```

目前有两个实现：

| 实现类 | 说明 |
|--------|------|
| `LocalEmbeddingProvider` | 在隐藏 iframe 里跑 transformers.js，模型从 HuggingFace CDN 下载，缓存在 IndexedDB，无需 API Key |
| `OpenAICompatibleEmbeddingProvider` | 调用 `/v1/embeddings` HTTP 接口，兼容 OpenAI / SiliconFlow / 豆包等 |

工厂函数 `createEmbeddingProvider(config)` 根据 `providerType` 字段自动选择用哪个实现。

**如果要接入新的向量化服务**，只需：
1. 新建一个类实现 `EmbeddingProvider` 接口
2. 在 `createEmbeddingProvider` 的 if-else 里加一个分支

---

### 3.3 `transformers-connector.ts` — 本地模型桥接

这个文件只有一行：

```typescript
export { transformers_connector } from '../../../../jsbrains/...';
```

它把 jsbrains 库里预编译好的 iframe 代码字符串导出。`LocalEmbeddingProvider` 把这段字符串注入到一个隐藏的 `<iframe>` 里，然后通过 `postMessage` 和 iframe 通信，让 iframe 帮它跑模型推理。

为什么要用 iframe？因为 transformers.js 的 WASM 文件太大，不适合直接打包进插件。这个方案让模型在运行时从 CDN 下载，并缓存在浏览器的 IndexedDB 里。

**注意**：iframe 不能加 `sandbox` 属性，否则会阻断跨域 CDN 请求导致模型下载失败。

---

### 3.4 `similarity-engine.ts` — 相似度计算

两个纯函数，无副作用，最容易理解：

```typescript
cosSim(a, b)         // 计算两个向量的余弦相似度，返回 0~1
findTopK(store, queryVec, k, excludePath)  // 在整个 store 里找最相似的 k 篇笔记
```

余弦相似度的直觉理解：把两个向量当作空间中的箭头，夹角越小说明方向越接近，语义越相似。

---

### 3.5 `storage.ts` — 向量数据持久化

向量数据存在 `.obsidian/plugins/coderidian/embeddings.json`（不存在 `data.json` 里，方便 `.gitignore`）。

`DebouncedStorage` 类负责防抖写入：高频更新时（比如批量索引 100 篇笔记），不是每次都写磁盘，而是累积 500ms 后统一写一次，避免 I/O 瓶颈。插件卸载时调用 `flush()` 强制立即写入。

---

### 3.6 `note-similarity-service.ts` — 调度中枢（最重要）

这是整个功能的大脑，负责把其他模块串起来。主要做三件事：

#### ① 初始化（`initialize`）

```
插件启动
  → 创建 EmbeddingProvider（根据用户配置决定 local 还是 openai）
  → 加载磁盘上的向量数据
  → 注册 Vault 事件监听（modify / create / delete / rename）
  → 在后台开始增量索引
```

#### ② 增量索引（`buildIndexInBackground`）

```
扫描所有 .md 文件
  → 对每个文件读 stat（mtime），判断是否比存储的 updatedAt 更新
  → 把需要更新的文件分批（每批 16 个），调用 embedFileBatch()
  → 更新进度条 Notice
  → 索引完成后标记 isReady = true
```

`embedFileBatch()` 内部会再做一次 hash 检查：即使 mtime 变了，如果内容 hash 没变（比如只是元数据变化），也不会浪费 API 调用。

#### ③ 实时更新（`enqueue`）

用户编辑笔记时，`modify` 事件会触发 `enqueue(file)`。这里有一个 **2 秒 debounce**：只有停止编辑 2 秒后才真正触发向量更新，避免每按一个键都重算。

---

### 3.7 `similar-notes-view.ts` — 侧边栏 UI

继承 Obsidian 的 `ItemView`，是一个标准的 Obsidian 侧边栏面板。

关键设计点：

**防止面板点击丢失上下文**
- 维护 `lastFile: TFile | null` 字段，记录最后激活的 Markdown 文件
- `active-leaf-change` 事件触发时，只有当新激活的是 `MarkdownView` 时才更新 `lastFile`
- 用户点击侧边栏本身时，`lastFile` 保持不变，结果不会消失

**与 Service 的通信**
- 通过两个回调函数接收异步通知：
  - `onProgressChange(current, total)` — 索引进度更新
  - `onReadyChange(ready)` — 索引完成
- 设置变更时 `main.ts` 会调用 `updateService()` 注入新的 service 实例

---

## 四、数据流全景图

```
用户打开笔记
     │
     ▼
SimilarNotesView.refresh()
     │
     ├── 取 this.lastFile（当前笔记）
     │
     ▼
NoteSimilarityService.findSimilar(file, limit)
     │
     ├── 检查 isReady（索引未完成则返回空）
     ├── 从 storage 读该笔记的向量 vec
     │     └── 如果没有 → 现场 embed 一次
     │
     ▼
similarity-engine.findTopK(store, vec, k, excludePath)
     │
     ├── 遍历 store.notes，每个调用 cosSim()
     ├── 排序，取前 k 个
     │
     ▼
SimilarNotesView.renderResults(results)
     └── 渲染笔记名 + 相似度进度条
```

---

## 五、如何扩展

### 添加新的向量化 Provider

1. 在 `embed-provider.ts` 新建类，实现 `EmbeddingProvider` 接口
2. 在 `createEmbeddingProvider()` 工厂函数加分支
3. 在 `types.ts` 的 `EmbeddingConfigItem.providerType` 联合类型加新值
4. 在 `settings.ts` 的设置 UI 加对应表单字段

### 修改相似度算法

只需改 `similarity-engine.ts` 的 `cosSim` 函数，其他代码不用动。

### 修改向量存储格式

只需改 `storage.ts` 和 `types.ts` 中的 `NoteEmbedding` / `EmbeddingStore`，记得同步处理旧数据迁移逻辑（参考 `initialize()` 里 modelId 不匹配时清空的方式）。

### 修改 UI 样式

样式全部在 `styles.css` 的 `/* Related Notes Panel */` 区块，CSS 变量使用 Obsidian 的 `--text-normal`、`--background-modifier-hover` 等，自动适配亮/暗主题。

---

## 六、配置在哪里管理？

用户的所有配置存在 `plugin.settings`（即 `data.json`），由 `settings.ts` 定义和渲染设置界面。Note Similarity 相关的配置字段：

| 字段 | 含义 |
|------|------|
| `embeddingEnabled` | 功能总开关 |
| `embeddingConfigs` | 向量化配置列表（可配多个，类似 API 配置管理） |
| `activeEmbeddingConfigId` | 当前激活的配置 |
| `similarNotesLimit` | 侧边栏最多显示几条结果 |
| `embeddingExcludeFolders` | 不参与索引的文件夹 |

设置变更后，`settings.ts` 会调用 `plugin.reinitNoteSimilarity()`，重新走一遍 `initialize()` 流程。
