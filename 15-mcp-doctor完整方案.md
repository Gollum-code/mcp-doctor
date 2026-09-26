# 15. mcp-doctor（MCP 服务器测试/健康检查）— 完整方案

> ⭐ AI 生态 | 风口最热 + 竞品几乎为零 + 演示直观 | 协议简单，适合快速出活

---

## 一、定位

一个像 **`curl` 之于 HTTP、`postman` 之于 API** 的 MCP 服务器验证工具：跑一遍自动检查一个 MCP server「能不能连、每个 tool 能不能正常返回、慢不慢、返回结构对不对」，输出健康报告。

## 二、为什么要做（机会证据）

1. **MCP（Model Context Protocol）生态正在爆发**，MCP server 五花八门、质量参差。
2. 目前**没有一个标准验证工具**——开发者接一个 MCP server，得自己写脚本手动连、手动调每个 tool。
3. 已有 postman/curl 之于 HTTP，MCP 更年轻，**测试/健康检查工具是真空**。
4. 协议简单（JSON-RPC over stdio/SSE），难度低、演示直观、上手快。

## 三、目标用户

- 做 MCP server 的开发者（自测 server 是否有 bug）
- 接第三方 MCP server 的客户端用户（确认能不能用）
- AI agent 平台/工具链厂商（质控 MCP server）

## 四、技术架构

```
mcp-doctor CLI (TypeScript)
  ├─ 连接器：
  │    ├─ stdio（启动子进程，JSON-RPC 2.0 over stdio）
  │    └─ HTTP/SSE（远程 MCP server）
  ├─ 测试执行器：
  │    ├─ 初始化握手（initialize → tools/list → prompts/list → resources/list）
  │    ├─ 逐个 tool 调用（空参数 + 示例参数）
  │    ├─ 超时/错误捕获
  │    └─ 返回结构校验（JSON Schema 校验 response）
  ├─ 分析器：
  │    ├─ 延迟统计（每次 tool 调用耗时）
  │    ├─ 失败聚类（哪些 tool 挂了/返回非标准结构）
  │    └─ 有害输出检测（超大响应、无效 JSON）
  └─ 报告：
       ├─ CLI 表格（pass/fail/warn + 耗时）
       └─ JSON/Markdown 导出
```

### 测试覆盖
```
CONNECTIVITY ✅ (stdio spawn / SSE 握手 200ms)
LIST TOOLS   ✅ 12 tools found
TOOL CALLS   ──────────
  tool_a        ✅ 200ms  → valid JSON
  tool_b        ⚠️ 1500ms (slow) → valid
  tool_c        ❌ error: "schema invalid arg"
  tool_d        ❌ timeout (10s)
RESPONSE     ✅ schema 校验 10/12 通过
```

## 五、MVP 功能清单

| 模块 | 工具 |
|---|---|
| 连接 | 支持 stdio 和 HTTP/SSE 两种传输 |
| 发现 | 列出 tools/prompts/resources，校验 protocol 实现是否正确 |
| 冒烟 | 逐个 tool 空参调用 + 可传示例参数 |
| 校验 | 返回 JSON 合法性 + 是否符合 tool 声明的 schema |
| 健康 | 延迟统计、超时检测、失败聚类 |
| 报告 | CLI 彩色表格 + `--json` / `--ci`（CI 退出码）导出 |
| 批量 | 一次测试多个 MCP server 配置文件 |

## 六、Roadmap

| 阶段 | 时间 | 交付 |
|---|---|---|
| M1 | 1 周 | stdio 连接 + 握手 + tools 冒烟 + 报告表格 |
| M2 | 1 周 | schema 校验 + 耗时/超时 + `--json` 导出 |
| M3 | 1 周 | HTTP/SSE 支持 + 批量 server 测试 |
| M4 | 1 周 | README + GIF + 发布 npm/CLI |

## 七、关键难点与验证

| 难点 | 应对 |
|---|---|
| 各 MCP server 实现质量参差 | 容错优先，坏的 server 也要能"报出问题"而非崩溃 |
| 示例参数从哪里来 | 支持 `--args` 传入，或从 tool 的 inputSchema 自动生成 |
| 协议版本（MCP 2024-11/2025-03） | 连接时协商支持版本 |
| SSE/Streamable HTTP 细节 | 先 stdio 保底，HTTP 放 M2/M3 |

## 八、竞品分析

| 工具 | 现状 | 差异 |
|---|---|---|
| postman/curl | 通用 HTTP | 不懂 MCP 协议语义 |
| 各 server 自带测试脚本 | 零散 | 统一的健康检查标准 |
| @modelcontextprotocol/inspector | 官方交互式 inspector | mcp-doctor 是 CLI 化 + 自动化 + CI 化 |

> 官方的 MCP Inspector 是交互 GUI，不擅长**自动化回归/CI**。mcp-doctor 的差异化是"可直接进 CI 的命令行健康检查"。

## 九、拿星策略

- 标签：`mcp` `model-context-protocol` `testing` `ai` `cli`
- README：「curl 之于 HTTP，mcp-doctor 之于 MCP——一条命令测一个 MCP server」
- 演示 GIF：跑一遍 rec 出健康报告 + 进 GitHub Actions 的示例
- 蹭 `mcp` 热门搜索（风口流量大）
- 发布：npm + 可作为 GitHub Action 使用

## 十、项目目录结构（MVP）

```
mcp-doctor/
├─ src/
│  ├─ index.ts        # CLI 入口
│  ├─ transport/      # stdio / http transport
│  ├─ client.ts       # MCP client 封装（JSON-RPC）
│  ├─ test.ts         # 测试执行器
│  ├─ validate.ts     # schema 校验
│  └─ report.ts       # 报告渲染
├─ tests/
├─ README.md
└─ package.json
```

## 十一、风险
- MCP 协议还年轻、规范在演进（跟随 spec 更新）
- 示例参数自动生成的准确性有限（提供手动传参兜底）
- 竞品随时可能出现（风口项目爆发快），靠文档 + CI 差异化 + 首发占位