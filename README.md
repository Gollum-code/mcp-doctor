# mcp-doctor 🩺

> **`curl` 之于 HTTP，`mcp-doctor` 之于 MCP** — 一条命令测一个 MCP server。
>
> The `curl` of MCP: a CLI health check / smoke test / conformance report for
> Model Context Protocol servers.

[![npm version](https://img.shields.io/npm/v/mcp-doctor.svg)](https://www.npmjs.com/package/mcp-doctor)
[![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/your-org/mcp-doctor/ci.yml?branch=main)](https://github.com/your-org/mcp-doctor/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

---

## 为什么需要它

MCP（Model Context Protocol）生态正在爆发，但 server 质量参差：有的连不上、
有的 tool 一直报错、有的返回非标准结构、有的慢如蜗牛。接入一个 MCP server
之前，你需要知道：

- 能不能连？（stdio spawn / HTTP+SSE 握手）
- 声明了哪些 tools / prompts / resources？协议实现对不对？
- 每个 tool 空参数 / 示例参数调用能不能正常返回？
- 慢不慢？超时没有？返回结构合不合法？
- 失败长什么样？（失败聚类，好让 server 作者一眼定位）

**mcp-doctor 把这些全部自动化成一份健康报告**，还能直接跑进 CI。

## 安装

```bash
npm install -g mcp-doctor        # CLI 全局安装
# 或
npx mcp-doctor --version         # 免安装直接跑
```

## 快速开始

```bash
# stdio server（最常见）
mcp-doctor --command "npx @modelcontextprotocol/server-everything"

# 远程 HTTP/SSE server
mcp-doctor --url https://mcp.example.com/mcp

# 一次测多个 server（批量）
mcp-doctor servers.json
```

样例输出：

```
  mcp-doctor v0.1.0  — MCP server health check

  fixture   (stdio)
    CONNECTIVITY   ✅ protocol 2025-06-18 · server=mcp-doctor-fixture (0.1.0)
    TOOLS/LIST     ✅ 4 tools found
    PROMPTS/LIST   ✅ 1 prompts found
    RESOURCES/LIST ✅ 1 resources found
    TOOL CALLS ────────────────────────────────────────
      echo                   ✅ 1ms      valid JSON
      slow_echo              ⚠️ 1505ms   slow
      fail                   ⚠️ 1ms      → this tool always fails
      structured             ✅ 1ms      valid JSON
    RESPONSE       4/4 valid JSON  ·  schema 1/1 ok
    HEALTH         avg 377ms · max 1505ms

  1/1 servers healthy · 4 tools tested · 0 problem(s)
  ALL SERVERS HEALTHY
```

## 工作原理

```
mcp-doctor CLI (TypeScript)
  ├─ 连接器：
  │    ├─ stdio（spawn 子进程，JSON-RPC 2.0 over stdio）
  │    └─ HTTP/SSE（Streamable HTTP + legacy SSE，走官方 SDK）
  ├─ 测试执行器：
  │    ├─ 初始化握手（initialize → tools/list → prompts/list → resources/list）
  │    ├─ 逐个 tool 调用（空参数 + 示例参数）
  │    ├─ 超时 / 错误捕获（hang 住也能报出来）
  │    └─ 返回结构校验（JSON 合法性 + JSON Schema 校验）
  ├─ 分析器：
  │    ├─ 延迟统计（每次 tool 调用耗时：min/median/avg/max）
  │    ├─ 失败聚类（哪些 tool 挂了 / 为什么）
  │    └─ 有害输出检测（超大响应 / 无效 JSON）
  └─ 报告：
       ├─ CLI 彩色表格（pass/warn/fail + 耗时）
       └─ JSON / Markdown 导出 + CI 退出码
```

## 用法

### 命令行参数

| 参数 | 说明 |
|---|---|
| `<configFile...>` | JSON 配置文件（单个或多个 server） |
| `-c, --config <file>` | 同上 |
| `-x, --command <cmd>` | stdio server 启动命令，如 `"npx @modelcontextprotocol/server-everything"` |
| `-u, --url <url>` | HTTP/SSE server 地址 |
| `-a, --args <json>` | 传给每个 tool 的示例参数；也支持 `{toolName: {...}}` 按工具给参 |
| `--args-file <file>` | 从 JSON 文件读示例参数 |
| `--env <json>` | stdio 子进程额外环境变量 |
| `--headers <json>` | HTTP 请求额外头 |
| `-n, --name <name>` | server 显示名 |
| `--fuzz` | 生成示例参数时也填可选属性 |
| `-t, --timeout <ms>` | 每次 tool 调用超时（默认 10000） |
| `--max-tools <n>` | 每个 server 最多冒烟多少个 tool |
| `--no-schema` | 跳过输出 schema 校验 |
| `-j, --json` | stdout 输出 JSON 报告 |
| `-m, --markdown [file]` | 输出（或写入文件）Markdown 报告 |
| `--ci` | CI 模式：纯文本（无 ANSI/emoji）+ 严格退出码 |
| `-v, --verbose` | 详细 stderr 日志 |
| `-V, --version` | 版本号 |

### 配置文件

单个 server：

```json
{
  "id": "everything",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-everything"]
}
```

批量（一次测多个）：

```json
{
  "servers": [
    {
      "id": "everything",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"]
    },
    {
      "id": "remote-fs",
      "transport": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" },
      "timeoutMs": 20000
    }
  ]
}
```

## CI 集成

`--ci` 模式输出无 ANSI 码、无 emoji 的纯文本报告，并按状态返回退出码：

- `0` — 全部 server 健康
- `1` — 至少一个 server 不健康（连接失败 / tool 错误 / 超时 / schema 校验失败）
- `2` — 用法 / 配置错误

GitHub Actions 示例：

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  mcp-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - name: Smoke test local MCP servers
        run: npx mcp-doctor servers.json --ci --markdown report.md
        continue-on-error: true
      - name: Upload report
        uses: actions/upload-artifact@v4
        with:
          name: mcp-doctor-report
          path: report.md
```

## Roadmap

| 阶段 | 状态 | 交付 |
|---|---|---|
| M1 | ✅ | stdio 连接 + 握手 + tools 冒烟 + 报告表格 |
| M2 | ✅ | schema 校验 + 耗时/超时 + `--json` / `--markdown` 导出 |
| M3 | ✅ | HTTP/SSE 支持 + 批量 server 测试 |
| M4 | 🚧 | README + GIF + 发布 npm |

## 开发

```bash
npm install
npm run build        # 编译到 dist/
npm run typecheck    # TS 类型检查
npm test             # vitest 单元 + E2E（含内置 fixture server）
npm run doctor       # 对本项目 fixture server 跑一次自检
```

## 与 MCP Inspector 的区别

| | MCP Inspector | mcp-doctor |
|---|---|---|
| 形态 | 交互式 GUI（浏览器） | 命令行 CLI |
| 自动化 | 不适合脚本化 | 一行命令 / CI 友好 |
| 回归测试 | 手动点 | `--json` + 退出码可断言 |
| 定位 | 手工调试 | 健康检查 + 批量巡检 |

## License

[MIT](LICENSE)
