# Chrome Cookie Sync — 设计文档

## 功能概述

将 macOS Chrome 的登录 Cookie 导入 Obsidian，使内置 WebViewer 和 `requestUrl` API 请求均能复用 Chrome 的登录状态。

**当前状态**：约 95% 的 Cookie 可正确解析并注入；剩余 5%（极少数特殊格式）暂不支持，不影响常规使用。

---

## 整体流程

```
Keychain 取密码
    ↓
PBKDF2 派生 AES 密钥
    ↓
SQLite 读取 Chrome Cookies DB（含 WAL 拷贝）
    ↓
逐行解密（AES-128-CBC）
    ↓
写入内存 cookieJar  +  注入 Electron Session
```

---

## 模块说明

### `keychain.ts` — 从 Keychain 读取密码

Chrome 在 macOS Keychain 中以如下格式存储加密主密码：

| 字段 | 值 |
|------|----|
| Service | `Chrome Safe Storage` / `Google Chrome Safe Storage` 等 |
| Account | `Chrome` / `Google Chrome` 等 |

实现会按优先级逐一尝试多个变体，返回第一个非空密码。

### `db.ts` — 读取 Chrome SQLite 数据库

- 数据库路径：`~/Library/Application Support/Google/Chrome/Default/Cookies`
- Chrome 使用 WAL 模式，读取时将 `.db`、`-wal`、`-shm` 三个文件**全部拷贝到临时目录**再查询，避免锁冲突
- 查询字段：`name, host_key, path, hex(encrypted_value), value, expires_utc, is_secure, is_httponly, samesite`

**当前限制**：只读 Default Profile，不支持 Profile 1、Profile 2 等多 Profile 场景。

### `decrypt.ts` — AES-128-CBC 解密

**Chrome macOS 加密格式**（v10 / v11 均相同）：

```
[ prefix: 3 bytes ("v10" or "v11") ] [ AES-CBC ciphertext ]
```

> **关键**：IV 是硬编码常量（16 × `0x20`），**不存储在文件中**。v11 的 App-Bound Encryption 是 Windows 专属特性，macOS 上 v11 与 v10 算法完全相同。

**密钥派生**：PBKDF2-HMAC-SHA1，salt = `"saltysalt"`，iterations = 1003，key length = 16 bytes

**解密步骤**：
1. 检查前 3 字节是否为 `v10` / `v11`；若都不是则为明文 legacy 格式
2. 从 byte 3 开始取密文，使用硬编码 IV `0x20 × 16` 进行 AES-128-CBC 解密
3. 手动去除 PKCS7 padding（最后一字节为 pad 长度）
4. 先尝试直接 UTF-8 解码；若含乱码字符 `'`，则尝试跳过前 32 字节（SHA256(host) 摘要前缀）后再解码

**剩余 5% 失败原因**：极少数 cookie 的解密结果无法通过 PKCS7 check 或 UTF-8 解码（可能是特殊编码格式或已损坏），直接跳过，不影响常规登录 Cookie。

### `injector.ts` — 注入 Electron Session

**双轨写入**：

| 目标 | 用途 |
|------|------|
| 内存 `cookieJar`（`Map<host_key, Cookie[]>`） | 供 `getCookiesForUrl()` 使用，可在 HTTP 拦截器中注入 `Cookie` 请求头 |
| Electron Session | 供 WebViewer（`<webview>` 标签）和 `requestUrl` 直接使用 |

**Session 注入**：

Obsidian 内部代码直接使用 `electron.remote.session`（通过捆绑的 `@electron/remote` shim 恢复 `remote` API）。注入目标：

1. `session.defaultSession` — 覆盖 `requestUrl` 发出的请求
2. `session.fromPartition(app.getWebviewPartition())` — 即 `persist:vault-<appId>`，Obsidian 内置 WebViewer 专用分区

Partition 名称通过 `app.getWebviewPartition()` 获取（Obsidian 内部 API，在 TypeScript 类型定义中未公开，用 `as any` 访问）。

**Cookie 字段映射**：

| Chrome DB 字段 | Electron `cookies.set()` 字段 | 备注 |
|---|---|---|
| `host_key` | `domain` | 保留前导 `.`，保持 domain-wide 作用域 |
| `host_key`（去掉前导 `.`） | `url` | 构造 `https://host/path` |
| `is_secure` | `secure` | |
| `is_httponly` | `httpOnly` | |
| `samesite` | `sameSite` | `-1→unspecified, 0→no_restriction, 1→lax, 2→strict` |
| `expires_utc` | `expirationDate` | Chrome 时间戳（微秒，Windows epoch）→ Unix 秒：`floor(t/1e6) - 11644473600` |

**诊断日志**（DevTools Console）：

```
[coderidian] cookie injection targets: ['defaultSession', 'persist:vault-326eeac2fb283fa1']
[coderidian] cookie import — success domains: ['.bilibili.com', '.github.com', ...]
[coderidian] cookie import — failed domains: [...]   // 仅在有失败时出现
```

---

## 文件结构

```
src/services/chrome-cookie-sync/
├── index.ts      # 对外入口：importChromeCookies(app)，re-export getCookiesForUrl
├── keychain.ts   # macOS Keychain 读取
├── db.ts         # Chrome SQLite 读取（含 WAL 拷贝）
├── decrypt.ts    # AES-128-CBC 解密 + PBKDF2 密钥派生
└── injector.ts   # 内存 cookieJar + Electron session 注入
```

---

## 参考：cmux 的对应实现

cmux（macOS 原生 Terminal 应用）实现了同等功能，核心逻辑在 `Sources/Panels/BrowserPanel.swift`：

| 步骤 | cmux | Coderidian |
|------|------|------------|
| 密钥获取 | `SecItemCopyMatching` | `security find-generic-password` CLI |
| 密钥派生 | `CCKeyDerivationPBKDF` | Node.js `pbkdf2Sync` |
| 解密 | `CCCrypt` AES-128-CBC | Node.js `createDecipheriv` |
| 注入目标 | `WKHTTPCookieStore`（`WKWebsiteDataStore` per profile） | `electron.remote.session`（`defaultSession` + `persist:vault-*`） |
| 去重 | `name\|domain\|path`，保留最新 expires | 暂未实现（按导入顺序覆盖） |

---

## 待迭代事项

- [ ] **多 Profile 支持**：当前只读 `Default` Profile，不支持 `Profile 1`、`Profile 2` 等
- [ ] **Cookie 去重**：按 `name|domain|path` 去重，保留最新 `expires`（对齐 cmux 行为）
- [ ] **HTTP 拦截器集成**：在 `src/interceptors/` 中调用 `getCookiesForUrl(url)` 自动注入 `Cookie` 请求头
- [ ] **Firefox 支持**：`cookies.sqlite` 明文存储，无需解密，技术上简单
- [ ] **定时同步**：Cookie 过期后自动重新导入
