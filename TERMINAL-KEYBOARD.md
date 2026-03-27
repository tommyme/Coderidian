# Terminal 键盘事件拦截架构

## 问题背景

终端嵌入 Obsidian 时面临三个冲突：

1. **Obsidian 抢键**：`Mod+W` 关闭 leaf，`Mod+P`/`Mod+O` 打开面板 —— 这些键在终端有焦点时不应触发 Obsidian 命令（或需要选择性穿透）
2. **ghost-web 抢键**：ghostty-web canvas 会消费所有 keydown，Obsidian 的 bubble 阶段 handler 收不到
3. **模态覆盖**：command palette 等覆盖层弹出后，`_scope` 不应继续拦截该覆盖层的键盘事件（如 Esc）

---

## 三层架构

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Obsidian Scope  (_scope 压入 keymap 栈)            │
│  时机：termEl focusin → pushScope；focusout → popScope       │
│  作用：在 Obsidian command dispatcher 之前消费指定键          │
│  注册键：Mod+W（硬编码）+ blockFromObsidian（用户配置）       │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: termEl keydown capture                            │
│  时机：所有到达 termEl 的 keydown，capture 阶段最先触发       │
│  作用 A：passToObsidian — 拦截后 re-dispatch 给 Obsidian     │
│  作用 B：Ghostty keybinds — copy/paste/text 注入             │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: ghostty-web 内部（PTY 输入）                       │
│  时机：Layer 2 未拦截的键                                     │
│  作用：字符编码后写入 PTY                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Layer 1：Obsidian Scope

### 为什么用 Scope 而不是 document.addEventListener capture

`document.addEventListener('keydown', handler, { capture: true })` 的注册顺序决定触发顺序。Obsidian 在插件加载前就注册了自己的 capture listener，所以插件的 capture listener **总是在 Obsidian 之后**触发 —— 此时 Obsidian 已经处理了 `Mod+W` 并关闭了 leaf，插件的拦截毫无意义。

`Scope` 是 Obsidian 暴露的 keymap 栈机制，插入点在 Obsidian 的 **command dispatcher 之前**：

```
DOM capture → Obsidian capture listener → [keymap 栈顶 Scope] → command dispatcher → bubble
                                              ↑ 我们在这里
```

### 语义

- `scope.register(mods, key, handler)` 注册一个组合键
- handler 返回 `false` → 未消费，继续传递；返回其他值（包括 `undefined`）→ 已消费，command dispatcher 不再处理
- **重要**：当某个 Scope 在栈顶时，**未注册**的键也不会 fall through 到 command dispatcher（Obsidian 的设计：active scope 完全接管 command dispatch）

### 当前注册的键

| 键 | 来源 | 行为 |
|----|------|------|
| `Mod+W` | 硬编码 | 消费（leaf 不关闭） |
| `blockFromObsidian` 列表 | 用户配置 | 消费 |

### Scope 生命周期

```typescript
// termEl 得到焦点 → scope 上栈
termEl.addEventListener('focusin', () => app.keymap.pushScope(_scope), { capture: true });

// termEl 失去焦点 → scope 下栈
termEl.addEventListener('focusout', () => app.keymap.popScope(_scope));

// view 关闭时兜底
onClose() { app.keymap.popScope(_scope); }
```

---

## Layer 2：passToObsidian（穿透到 Obsidian）

### 问题

默认情况下，`Mod+P` 等键在 termEl 有焦点时：
- Layer 1 的 Scope 未注册 `Mod+P` → Scope 消费（因为 active scope 接管了 command dispatch）
- 结果：command palette 打不开

### 解法：临时 popScope + 同步 dispatchEvent

```typescript
// termEl keydown capture handler（优先级最高）
if (isPassToObsidian(e, settings.passToObsidian)) {
    e.stopImmediatePropagation();  // 阻止 ghostty-web canvas 收到此事件
    e.preventDefault();

    app.keymap.popScope(_scope);   // 临时移除 scope，让 command dispatcher 生效
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: e.key, code: e.code,
        metaKey: e.metaKey, ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey, altKey: e.altKey,
        bubbles: true, cancelable: true,
    }));
    // dispatchEvent 是同步的：上面的 dispatchEvent 返回时，Obsidian 命令已执行完毕
    // 如果命令打开了 modal（如 command palette），focus 已经移走，focusout 已经触发

    // 只在 termEl 依然持有焦点时才重新 push（modal 可能已经 steal focus）
    if (termEl?.contains(document.activeElement)) {
        app.keymap.pushScope(_scope);
    }
    return;
}
```

### 为什么不 re-push 就够了

`dispatchEvent` 同步执行期间，如果 Obsidian 打开了 command palette：
1. command palette 调用 `inputEl.focus()` —— 浏览器同步触发 termEl 的 `focusout`
2. `focusout` handler 调用 `popScope(_scope)` —— 此时 scope 已经被手动 pop 过，是 no-op
3. `dispatchEvent` 返回
4. 如果无条件 `pushScope` → scope 重新上栈，command palette 的 Esc 等键被拦截 ← **这是 bug**
5. 加上 `contains(activeElement)` 检查 → scope 不会被重新 push，command palette 正常响应 Esc

---

## Layer 2：blockFromObsidian（完全吞掉）

通过 Layer 1 Scope 注册实现，而不是 document capture。Scope 处理器返回非 `false` 即消费，PTY 和 Obsidian 都收不到。

hardcoded `Mod+W` 和用户配置的 `blockFromObsidian` 均注册到同一个 `_scope`。

---

## 数据流总结

```
用户按键
  │
  ├─► Obsidian capture listener（先于插件）
  │
  ├─► [keymap 栈] _scope.register 处理器
  │     Mod+W / blockFromObsidian → 消费，命令不触发
  │     passToObsidian 键 → 未注册，但 active scope 阻止 command dispatch
  │
  ├─► termEl keydown capture（Layer 2）
  │     passToObsidian → popScope + dispatchEvent(同步) + 条件 pushScope
  │     Ghostty keybinds → copy/paste/text 注入
  │
  └─► ghostty-web 内部（Layer 3）
        → PTY write
```

---

## 已知限制

- **Scope 阻断所有未注册的 command**：当 `_scope` 在栈顶时，只有 `passToObsidian` 列表中的键才会穿透到 Obsidian 命令。需要穿透的命令必须显式加入列表。
- **ghostty-web DPR/zoom bug**：Obsidian zoom 非 100% 时，canvas 字符间出现黑色横纹（如 zoom=90% → DPR=1.8，非整数导致亚像素对齐）。这是 ghostty-web 上游 bug，workaround：`Cmd+0` 恢复 zoom 到 100%。
