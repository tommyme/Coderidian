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
