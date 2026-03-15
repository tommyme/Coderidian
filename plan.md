# 📋 AI 图片分析与摘要插件 - 执行计划

## 📊 项目现状分析

### 现有项目结构
```
Coderidian/
├── src/
│   ├── main.ts          # 插件主入口
│   ├── commands.ts      # 命令注册
│   ├── settings.ts      # 设置面板
│   └── utils.ts         # 工具函数
└── package.json
```

### 已有的功能模块
1. **Open in VSCode** - 通过命令或 URL 方式在 VSCode 中打开 vault
2. **Vault Jump** - 在不同 Obsidian vault 之间快速跳转
3. **HTML Wrapping** - 为选中内容添加 HTML 标签
4. **Zip Vault** - 压缩整个 vault
5. **Toggle Mode** - 切换加粗/侧边栏模式

---

## 🎯 新功能模块组织方案

### 新增文件结构
```
src/
├── ai-image-analysis/          # AI 图片分析功能模块
│   ├── index.ts               # 模块入口
│   ├── note-parser.ts         # 笔记解析器（提取文本和图片）
│   ├── image-hosting.ts       # 临时图床上传（ttl.sh）
│   ├── doubao-api.ts          # 豆包视觉大模型 API 调用
│   ├── markdown-renderer.ts   # Markdown 渲染器（含双链生成）
│   └── types.ts               # 类型定义
├── main.ts                     # (修改) 导入并注册新命令
├── commands.ts                 # (修改) 添加新命令
└── settings.ts                 # (修改) 添加 API Key 等配置
```

---

## 📝 Step-by-Step 执行计划

### 阶段一：MVP（最小可行产品）- 先跑通基础流程

#### [Step 1] 状态初始化 ✅
- **当前状态**: 已完成项目结构分析，已参考豆包 API 文档
- **输出**: 创建此 plan.md 文件
- **下一步**: 等待用户确认计划

#### [Step 2] 类型定义与设置扩展 ✅
- 创建 `src/ai-image-analysis/types.ts` 定义数据接口
- 修改 `src/settings.ts` 添加新配置项：
  - 豆包 ARK API Key
  - 豆包 API Endpoint（默认 `https://ark.cn-beijing.volces.com/api/v3/responses`）
  - 模型名称（默认 `doubao-seed-1-6-250815`）

#### [Step 3] 笔记解析模块 ✅
- 创建 `src/ai-image-analysis/note-parser.ts`
- 解析当前笔记内容，提取：
  - 正文文本（按顺序）
  - 图片（本地文件或外部 URL）
- 返回「文本-图片」交替的结构化数据

#### [Step 4] 临时图床上传模块 ✅
- 创建 `src/ai-image-analysis/image-hosting.ts`
- 实现图片下载（外部 URL）
- 实现 ttl.sh 上传（`curl -T` 方式）
- 自动清理临时文件
- 返回临时直链

#### [Step 5] 大模型通信模块（MVP 版）✅
- 创建 `src/ai-image-analysis/doubao-api.ts`
- 实现 `analyzeSingleImage()` - 单张图片 + 上下文解析
- 按照豆包 API 格式构建请求
- **MVP 暂不添加复杂提示词**

#### [Step 6] Markdown 渲染器（MVP 版）✅
- 创建 `src/ai-image-analysis/markdown-renderer.ts`
- 将 AI 解析结果以引用块形式插入对应图片下方
- 创建 `src/ai-image-analysis/index.ts` 模块入口
- **MVP 暂不实现双链和关联概念**

#### [Step 7] 模块入口与插件集成 ✅
- 创建 `src/ai-image-analysis/processor.ts` - 主流程串联
- 更新 `src/ai-image-analysis/index.ts` 导出公共 API
- 修改 `src/commands.ts` 添加新命令：
  - `analyze-note-with-ai` - AI 分析当前笔记

#### [Step 8] UI 接入与用户体验 ✅
- 显示处理进度 Notice
- 处理完成后更新当前笔记

---

### 阶段二：功能增强（MVP 跑通后再做）

#### [Step 9] 完善提示词
- 在豆包 API 请求中添加系统提示词
- 指导 AI 如何进行图片解析和全文摘要
- 参考笔记摘要设计文档

#### [Step 10] 智能双链与关联概念
- 实现双链转换（核心概念 → [[概念]]）
- 生成「关联概念」区域
- 在笔记开头或末尾添加 AI 生成的全文摘要

#### [Step 11] 更多配置选项
- 临时图床选择（ttl.sh / Litterbox）
- 提示词模板配置
- 输出格式自定义

---

## 🔑 关键设计决策

### 1. 数据流程
```
用户在当前笔记触发命令
  → 解析笔记内容
  → 提取 TextBlock | ImageBlock 数组
  → 图片上传至 ttl.sh（如需要）
  → 组装多模态 Prompt
  → 调用豆包 API
  → 渲染 Markdown（含 AI 分析）
  → 更新笔记
```

### 2. 核心类型定义（预想）
```typescript
// 内容块类型
type ContentBlock = TextBlock | ImageBlock;

interface TextBlock {
  type: 'text';
  content: string;
}

interface ImageBlock {
  type: 'image';
  originalPath: string;   // 原始路径（本地文件或 URL）
  tempUrl?: string;       // ttl.sh 临时 URL
  aiAnalysis?: string;    // AI 解析结果
}

// 解析结果
interface ParsedNote {
  blocks: ContentBlock[];
}
```

---

## 📚 参考文档

相关设计文档和参考资料：

1. **笔记摘要设计**: `C:\Users\ybw\repos\dg3\content\private\life\事业\kickstarter\projects\笔记摘要.md`
   - 豆包 API 调用示例
   - 整体方案说明

---

## 📌 当前状态

- **Step**: 8 (UI 接入与用户体验) ✅
- **阶段**: 一（MVP）
- **完成时间**: 2026-03-01
- **下一步**: 用户测试 MVP

---

## 📌 Note Similarity — Chunking & Embedding 策略

### 文件：`src/services/note-similarity/note-similarity-service.ts`

#### 1. 文本清理（`cleanText`）

在分块前去除以下内容：
- frontmatter（`---...---`）
- 代码块（` ``` ``` `）
- 行内代码（`` `...` ``）
- 图片嵌入（`![[...]]`）

清理后为空 → 跳过该文件（只有纯代码/纯图片笔记才会触发）。

#### 2. 分块策略（`chunkText`）

**参数**

| 参数 | 值 | 说明 |
|------|-----|------|
| `CHUNK_MAX` | 500 chars | 中文约 500 token，英文约 125 token，安全上限 |
| `CHUNK_OVERLAP` | 50 chars | 相邻 chunk 重叠，避免语义在边界断裂 |
| `CHUNK_MIN` | 80 chars | 过滤切分时产生的碎片（如孤立标题行） |

**三级降级策略**

```
Level 1：按 H1/H2/H3 标题行切 section（标题保留在 section 开头）
  → section ≤ CHUNK_MAX 且 ≥ CHUNK_MIN → 直接作为一个 chunk

Level 2：section > CHUNK_MAX → 按段落（双换行）贪心合并
  → 合并到快超 CHUNK_MAX 时 flush，下一个 chunk 开头保留 50 chars overlap

Level 3：单段落仍 > CHUNK_MAX → 按字符强切，保留 overlap

保底：上述三级均未产生 chunk（笔记很短）→ 直接取全文（不受 CHUNK_MIN 限制）
  → 短笔记（如原子笔记、医疗记录）同样会被索引，不过滤
```

#### 3. Embedding 输入构造（`embedFileBatch`）

每个 chunk 在送入 embedding 模型前，前缀拼接文件标题：

```
{文件名（不含扩展名）}\n\n{chunk 文本}
```

- 标题提供文档级语义上下文，改善同主题笔记的检索精度
- chunk body 按需截短：`maxBody = CHUNK_MAX - title.length - 2`，保证总长度 ≤ CHUNK_MAX
- `preview` 字段仅存原始 chunk 文字（不含标题），用于 UI 显示

#### 4. 写盘策略

- 批量索引（`buildIndexInBackground` / `reindexAll`）：**只在完成、abort、或 batch 报错时 `flush()` 一次**，不在每个 batch 后写盘
- 实时单文件更新（`embedFile`）：`markDirty()` 防抖写盘（500ms）

---

## 📌 2026-03-12 更新：HTTP 请求拦截器

### 新增功能：请求拦截器模块

#### 新增文件
- `src/interceptors/http-interceptor.ts` - HTTP 请求拦截器核心实现
- `src/interceptors/index.ts` - 模块导出

#### 功能特性
1. **请求拦截器** - 在请求发送前修改请求参数
2. **响应拦截器** - 在响应返回前处理响应
3. **错误拦截器** - 统一处理请求错误
4. **请求日志** - 记录所有 HTTP 请求（方法、URL、状态码、耗时等）
5. **请求缓存** - GET 请求结果缓存（默认 5 分钟 TTL）
6. **请求重试** - 自动重试失败的请求（默认 3 次）

#### 测试命令
- `coderidian:http-interceptor-add-logging` - 添加请求/响应日志拦截器
- `coderidian:http-interceptor-clear` - 清除所有拦截器
- `coderidian:http-interceptor-test` - 发送测试请求到 https://httpbin.org

#### 使用方式
```typescript
import { HttpInterceptor, createHttpInterceptor } from './interceptors';

// 初始化拦截器
createHttpInterceptor({
  enableLogging: true,
  enableCaching: true,
  cacheTtl: 5 * 60 * 1000,
  enableRetry: true,
  maxRetries: 3
});

// 添加认证头拦截器
interceptor.addRequestInterceptor(HttpInterceptor.createAuthInterceptor('your-api-key'));

// 获取请求日志
const logs = interceptor.getLogs();
```

#### 状态
- ✅ 已完成实现
- ✅ 已集成到插件
- ⏳ 待用户测试

#### 调试流程
1. `pnpm dev` - 启动 esbuild watch 模式
2. `cp main.js ~/repos/content/.obsidian/plugins/coderidian/main.js` - 复制到插件目录
3. `obsidian reload` - 使用 Obsidian CLI 重载插件
4. **等待 15 秒** - reload 后需要时间加载所有插件
5. 打开 DevTools (Ctrl+Shift+I)
6. 执行命令添加拦截器并测试
7. 查看 Console 日志

#### 2026-03-12 更新：拦截器执行日志
在拦截器执行循环中添加了日志输出：
- `[HttpInterceptor] Request Interceptor - request-logger, response-logger`
- `[HttpInterceptor] Response Interceptor - request-logger, response-logger`
- `[HttpInterceptor] Error Interceptor - xxx`
