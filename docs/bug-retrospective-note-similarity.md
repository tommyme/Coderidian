# Bug 回顾：Note Similarity 开发中的典型问题

> 记录于 2026-03-16，基于 Note Similarity 功能开发与 bug 修复阶段的实际经验。

---

## 一、生命周期边界（最高风险）

### 1. `initNoteSimilarity` 在 vault 就绪前启动

**症状**：索引以"共 0 篇笔记，已处理 N 篇"假成功结束，没有进度条弹出。

**根因**：`initNoteSimilarity()` 在 `onload()` 中直接调用，此时 Obsidian 的 vault 尚未完全就绪，`getMarkdownFiles()` 返回空列表。空列表导致 `toEmbed` 也为空，直接命中"索引已是最新"早退路径，跳过了整个构建循环。

**修复**：将 `initNoteSimilarity()` 移入 `onLayoutReady` 回调，确保 vault 完全加载后再启动。

**教训**：Obsidian 的 `onload` 和 vault 可用是两个不同的时间点。任何依赖 `getMarkdownFiles()` 的逻辑都必须在 `onLayoutReady` 之后执行。

---

### 2. 模型切换时 `destroy()` 与后台任务的析构竞争

**症状**：切换到模型 B 后，模型 A 仍持续打印 `saveStore` 日志，notes 数量还在增长。切回模型 A 时，之前已完成的部分索引数据丢失（仅有 60 条）。

**根因**：`destroy()` 调用 `flush()` 写盘，但此时批量 embed 的异步循环可能还有一个 batch 在飞行中。新 service 的 `loadStore()` 可能在旧 service 最后一次 `saveStore` 之前就已读取文件，读到旧数据。旧 service 的最后一次 batch 完成后再写盘，又覆盖了新 service 已读取的状态。

**修复**：`destroy()` 中设置 `aborted = true` 作为中止标志，所有批次循环在每次迭代开始时检查该标志；同时在 `destroy()` 里主动调用 `storage.setDirty()` 再 `flush()`，确保内存数据以最新状态落盘。

**教训**：拥有后台异步任务的 service 被替换时，析构过程需要：(1) 中止所有飞行中的异步操作，(2) 保存内存中已有数据，(3) 解绑所有事件监听。任何一步遗漏都会产生残留副作用。

---

### 3. vault 事件监听器泄漏

**症状**：从模型 B 切回模型 A 后，模型 B 的 service 实例还在持续处理文件变更事件、调用 embedFileBatch、写盘，且 notes 数量仍在增长。

**根因**：`_registerVaultEvents()` 使用 `this.plugin.registerEvent()`，其语义是"绑定到插件生命周期"，而非"绑定到当前 service 实例的生命周期"。调用 `destroy()` 不会解绑这些事件处理器，旧 service 在析构后仍然是活跃的 vault 事件监听者。

**修复**：改用 `this.plugin.app.vault.on()` 直接注册事件，将返回的 event ref 存入 `vaultEventRefs` 数组；`destroy()` 中遍历该数组，对每个 ref 调用 `vault.offref()` 显式解绑。

**教训**：`plugin.registerEvent()` ≠ "由 service 管理的事件"。需要随 service 销毁的事件监听，必须手动持有 ref 并在 `destroy()` 中解绑。这是 Obsidian 插件开发中极易忽视的陷阱。

---

## 二、隐式状态缺失（中等风险）

### 4. 无内容笔记从不写入 store，每次切模型都重复处理

**症状**：每次切换 embedding 模型，都会触发一次"索引完成，共处理 60 篇笔记"的 Notice，实际上这 60 篇每次都是同一批文章。

**根因**：`embedFileBatch` 对 `cleanText` 后为空或 `chunkText` 返回空数组的文件直接 `continue` 跳过，**从不写入 `store.notes`**。每次切模型时这 60 篇文件都命中 `no_record` → 加入 `toEmbed` → 走一遍无效的处理流程。

**修复**：对无有效内容的文件写入哨兵记录 `{ chunks: [], hash, updatedAt }`；`buildIndexInBackground` 中将旧格式检测从 `!existing.chunks?.length`（误将空数组也命中）改为 `!existing.chunks`（仅命中 undefined/null）。哨兵记录只在 mtime 变化时重新处理。

**教训**："处理后没有产出"也是一种需要被持久化的结论。静默跳过会导致每次都重新尝试，无法收敛。

---

### 5. `isIndexing` 标志在异常路径未重置

**症状**：索引任务因 API 错误中断后，侧边栏 UI 永久停留在"Indexing…"状态，无法恢复。

**根因**：`isIndexing = false` 只在 happy path（循环正常结束）时执行，abort 和 fail 路径的早退分支遗漏了重置。

**修复**：将 `isIndexing = false` 提前到 abort/fail 判断之前执行，确保任何退出路径都能正确重置标志。

**教训**：布尔状态标志需要在所有退出路径上重置，包括 early return、异常、abort。只在 happy path 重置是经典的状态机 bug。

---

## 三、数据模型演进带来的兼容性问题（低风险但难排查）

### 6. 旧格式检测条件过于宽泛，误伤哨兵记录

**症状**：修复无内容文件问题后，哨兵记录（`chunks: []`）仍被当作旧格式数据加入 `toEmbed`，60 篇文件依然每次重复处理。

**根因**：旧的检测条件 `!existing.chunks?.length` 在语义上命中两种情况：`chunks === undefined`（旧格式，需重新 embed）和 `chunks.length === 0`（哨兵，应跳过）。两者在表达式上等价，无法区分。

**修复**：将条件精确为 `!existing.chunks`，仅命中字段不存在的情况；空数组哨兵会跳过此检查，落到 mtime 判断。

**教训**：存储格式升级时，"旧格式检测"的判断条件必须精确到字段是否存在，而非字段的值是否为 falsy。升级前后的数据结构差异需要显式建模，不能依赖"空值等价"。

---

## 规律总结

| 类型 | 典型症状 | 难以发现的原因 |
|------|---------|--------------|
| 生命周期时机 | 数字为 0、数据读旧 | 正常流程下不出现，只在冷启动时触发 |
| 异步析构竞争 | 旧 service 持续写盘 | 表现滞后，日志混在新 service 输出里 |
| 事件监听泄漏 | 已销毁的 service 仍在响应事件 | 行为正确但来源错误，难以溯源 |
| 隐式状态缺失 | 每次都重跑某批文件 | 功能"正确"，只是多做了无用功 |
| 标志位管理 | UI 卡在某个状态 | 只在异常/abort 路径触发 |
| 格式检测歧义 | 特定数据反复被重新处理 | 逻辑看似正确，但语义边界有盲区 |

**最容易出问题的地方**：拥有后台异步任务的 service 在被替换时的完整析构过程。一个 service 的正确析构需要同时做到：中止所有飞行中的异步操作、解绑所有事件监听、保存内存中的数据、通知 UI 清空状态——任何一步遗漏都会造成残留副作用，且通常只在"切换"这个非主流程下才暴露，测试覆盖难度高。
