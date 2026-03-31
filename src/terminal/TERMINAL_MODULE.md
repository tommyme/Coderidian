# Terminal 模块文档

内嵌终端，基于 ghostty-web（WASM 渲染引擎）+ Python PTY 代理实现，支持在 Obsidian 内运行真实 shell。

---

## 文件结构

```
src/terminal/
├── types.ts              # 类型定义：TerminalSettings、TerminalSessionState、TerminalOpenPosition
├── index.ts              # 对外导出入口
├── terminal-service.ts   # 服务层：WASM 初始化、开关终端、sendText 公开 API
├── terminal-view.ts      # 视图层（核心）：ItemView 子类，管理渲染、键盘、PTY 生命周期
├── ghostty-config.ts     # 解析 Ghostty 配置文件（~/.config/ghostty/config）
├── keybinds.ts           # 键绑定逻辑：解析/匹配/传递/拦截
├── pty-manager.ts        # PTY 进程管理：spawn/write/resize/kill
└── pty_helper.py         # Python PTY 代理脚本（运行时写入插件目录）
```

---

## 整体架构

```
Obsidian Plugin (main.ts)
    └─ TerminalService          ← 初始化 WASM、注册 View、对外暴露 API
           └─ TerminalView      ← ItemView，DOM 渲染 + 键盘处理
                  ├─ ghostty-web (Terminal / FitAddon)   ← WASM 终端渲染
                  └─ PtyManager                          ← Node.js ChildProcess
                         └─ pty_helper.py               ← Python PTY 代理
                                └─ shell (zsh/bash...)
```

**数据流：**

- 用户按键 → DOM keydown（capture） → PtyManager.write() → pty_helper.py stdin → PTY → shell
- shell 输出 → pty_helper.py stdout → PtyManager onData → Terminal.write() → WASM 渲染

---

## 各文件职责

### `terminal-service.ts` — 服务层

- `initialize()`：解析 Ghostty 配置 → 初始化 WASM（`initGhosttyWasm()`）→ 注册视图类型
- `openTerminal(position?, forceNew?)`：打开或复用已有终端
- `openTerminalAt(vaultRelativePath)`：从文件右键菜单以特定 cwd 打开终端
- `sendText(text, newline?)`：向活跃终端（或第一个可用终端）发送文本；返回 bool
- `reloadGhosttyConfig()`：用户在设置页修改配置路径后调用

### `terminal-view.ts` — 视图层（核心）

- `navigation = false`：阻止视图被 Obsidian 后退/前进历史记录
- `onOpen()`：初始化 DOM → 测量字符尺寸 → 创建 Terminal → 设置 Cmd+W 保护 → spawn PTY
- `setupCloseProtection()`：通过 `Scope.register(['Mod'], 'w', ...)` 在 Obsidian 键盘调度层拦截 Cmd+W
  - Scope 在 `focusin` 时 push，`focusout` 时 pop
- `initTerminal()`：创建 ghostty-web Terminal 实例，注册 keydown 监听（capture 阶段）
  - Tab / Shift+Tab：手动 preventDefault 防止浏览器焦点跳出；Shift+Tab 写 `\x1b[Z`
  - passToObsidian：拦截后 pop scope → 重新 dispatch 到 document.body → 恢复 scope
  - Ghostty keybinds：copy/paste/text action
- `spawnPty()`：解析 cwd → 配置 onData/onExit/onError → 启动 PtyManager
- `sendText(text)`：公开方法，供 TerminalService.sendText() 调用
- `handleResize()`：FitAddon.fit() → PtyManager.resize(cols, rows)

### `ghostty-config.ts` — 配置解析

- 配置文件查找顺序：
  1. 用户设置中的自定义路径
  2. `$XDG_CONFIG_HOME/ghostty/config`（默认 `~/.config/ghostty/config`）
  3. macOS：`~/Library/Application Support/com.mitchellh.ghostty/config`
- 解析的字段：字体、颜色（palette 0-15）、cursor、scrollback、keybinds
- 颜色格式自动补 `#`（Ghostty 配置用 6 位 hex 不带 `#`）

### `keybinds.ts` — 键绑定

- `buildEffectiveKeybinds()`：合并内置默认（Cmd+C/V、Shift+Enter）与用户自定义
- `isPassToObsidian(e, passList)`：判断是否要透传给 Obsidian（如 Cmd+P 打开命令面板）
- `findKeybind(e, keybinds)`：DOM KeyboardEvent → 匹配 Ghostty keybind
- `parseComboString(combo)`：`"mod+shift+k"` → `{ metaKey, ctrlKey, shiftKey, altKey, key }`
  - `mod` 在 macOS = metaKey，其他平台 = ctrlKey
- `domKeyToGhostty(domKey)`：DOM `e.key` → Ghostty 键名（如 `ArrowUp` → `up`）

### `pty-manager.ts` — PTY 进程管理

- `spawn(opts)`：调用 `python3 pty_helper.py <shell> [args]`
  - stdio: `['pipe', 'pipe', 'pipe', 'pipe']`，fd3 为 resize 控制管道
  - 环境变量注入：`TERM=xterm-256color`、`COLORTERM=truecolor`
- `write(data)`：发送字节到 shell stdin
- `resize(cols, rows)`：向 fd3 写 4 字节大端帧（rows uint16 + cols uint16）
- `kill()`：SIGTERM → 500ms 后 SIGKILL

### `pty_helper.py` — Python PTY 代理

- 运行时由 `PtyManager.ensureHelper()` 写入插件目录（每次校验内容是否最新）
- 功能：`pty.fork()` → 子进程 exec shell（login shell 模式，argv[0] 加 `-` 前缀）
- 父进程用 `select` 多路复用三路：
  - `stdin` → PTY（用户输入）
  - `PTY` → `stdout`（shell 输出）
  - `fd3` → `ioctl TIOCSWINSZ`（resize）
- Watchdog 线程：每 2 秒检测父进程（Obsidian）是否还活着，挂了就 kill shell
- 检测方式：ppid 变化 / stdin hangup / fd3 关闭

---

## 配置项（TerminalSettings）

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `defaultPosition` | `'bottom'` | 打开位置：bottom/right/tab/window |
| `shellPath` | `''` | 空 → `$SHELL` → `/bin/zsh` |
| `shellArgs` | `[]` | 传给 shell 的额外参数 |
| `ghosttyConfigPath` | `''` | 空 → 自动查找 |
| `fontFamilyOverride` | `''` | 空 → 读 Ghostty 配置 |
| `fontSizeOverride` | `0` | 0 → 读 Ghostty 配置 |
| `scrollbackLines` | `10000` | 回滚行数 |
| `passToObsidian` | `['mod+p', 'mod+o']` | 这些组合键透传给 Obsidian |
| `blockFromObsidian` | `[]` | 这些组合键完全吞掉（不给 Obsidian 也不给 PTY） |

---

## 公开 API（供其他插件 / Obsidian CLI 调用）

在 `main.ts` 的插件实例上：

```typescript
// 向终端发送文本
plugin.sendTextToTerminal(text: string, newline?: boolean): boolean
// newline=true 时追加 \n（相当于执行命令）
// 无可用终端时返回 false
```

内部调用链：`plugin.sendTextToTerminal` → `TerminalService.sendText` → `TerminalView.sendText` → `PtyManager.write`

---

## 键盘事件处理流程

```
keydown (capture, termEl)
    │
    ├─ key === 'Tab' ?
    │       └─ preventDefault() + stopImmediatePropagation()
    │          Shift+Tab → write('\x1b[Z') 到 PTY
    │          普通 Tab → ghostty-web 内部处理
    │
    ├─ isPassToObsidian(e) ?
    │       └─ popScope → dispatch 到 document.body → 条件 pushScope
    │
    └─ findKeybind(e, effectiveKeybinds) ?
            ├─ copy_to_clipboard
            ├─ paste_from_clipboard
            ├─ text:<seq> → write 到 PTY
            └─ 未知 action → stopPropagation（防 Obsidian 拦截），交给 ghostty-web
```

**Cmd+W 保护机制：**

- `Scope.register(['Mod'], 'w', handler)` 注册在 Obsidian 键盘调度层
- Scope 随焦点 push/pop（focusin/focusout）
- 效果：终端有焦点时 Cmd+W 被消费，不触发 `workspace:close`

---

## 常见改动场景

### 新增快捷键行为

1. 在 `keybinds.ts` 的 `GHOSTTY_BUILTIN_KEYBINDS` 添加默认项，或让用户在 Ghostty 配置中声明 `keybind`
2. 在 `terminal-view.ts` `initTerminal()` 的 keybind 处理分支里添加对应 `action` 的处理

### 新增特殊键处理（如 Shift+Tab 这类浏览器会抢占的键）

- 在 `initTerminal()` keydown 监听的最顶部（Step 0）添加检测
- 必须 `e.preventDefault()` 阻止浏览器默认行为
- 手动构造 ANSI 转义序列写入 `PtyManager.write()`

### 修改 PTY 通信协议

- TypeScript 侧：`pty-manager.ts` 的 `spawn()` / `resize()`
- Python 侧：`pty_helper.py` 的 `_main_unix()`
- 改完 Python 后，Obsidian 重载时 `ensureHelper()` 会自动更新插件目录里的脚本

### 修改终端打开位置逻辑

- `terminal-service.ts` `getLeafForPosition()`
- 注意：`'bottom'` 用的是 `getLeaf('split', 'horizontal')`（未公开 API，类型需强转）

### 读取 / 扩展 Ghostty 配置字段

- `ghostty-config.ts` `applyConfigKey()` 添加新的 `case`
- `GhosttyConfig` interface 添加对应字段
- `terminal-view.ts` `initTerminal()` 中使用新字段

---

## 调试定位

### 编译 & 部署

```bash
pnpm compile && pnpm test
# compile: esbuild 一次性构建到 dist/main.js
# test: cp dist/* styles.css ~/repos/content/.obsidian/plugins/coderidian/ && obsidian reload
```

### 日志前缀

所有终端模块日志前缀：`[Coderidian/Terminal]`

```
[Coderidian/Terminal] WASM initialized          ← TerminalService WASM 初始化成功
[Coderidian/Terminal] WASM init failed: ...     ← WASM 失败，终端不可用
[Coderidian/Terminal] Loaded Ghostty config from: /path  ← 配置文件找到
[Coderidian/Terminal] No Ghostty config found   ← 使用默认值
[Coderidian/Terminal PTY] <stderr 内容>         ← PTY Python 脚本的 stderr
```

### 常见问题定位

| 现象 | 排查方向 |
|------|----------|
| 终端打开后空白 / 无输出 | Console 看 WASM 是否初始化成功；看 PTY stderr |
| 某个快捷键没有效果 | keydown 监听是否 capture；是否被 passToObsidian / blockFromObsidian 拦截 |
| 某个快捷键触发了 Obsidian 的功能 | 加入 `blockFromObsidian`，或在 keydown Step 0 手动 stopPropagation |
| Tab / Shift+Tab 焦点跑掉 | terminal-view.ts Step 0 的 Tab 处理；确认 preventDefault 在 capture 阶段 |
| Cmd+W 关掉了终端 | `setupCloseProtection()` 的 Scope 是否正确 push（看 focusin 事件） |
| shell 退出后 PTY 残留 / 僵尸 | `pty_helper.py` watchdog 线程；`PtyManager.kill()` 的 SIGKILL 兜底 |
| 字符尺寸不对 / 列数计算错 | `measureCharDimensions()` 的 canvas 测量；DPR/zoom 问题（已知 ghostty-web 上游 bug） |
| Ghostty 配置颜色不生效 | `ghostty-config.ts` 颜色解析；hex 6位不带 `#` 需要 `normalizeColor()` 补齐 |

### PTY 进程调试

```bash
# 查看 pty_helper.py 是否在运行
ps aux | grep pty_helper

# 手动测试 PTY 代理（在终端里）
python3 ~/.obsidian/plugins/coderidian/pty_helper.py /bin/zsh
```
