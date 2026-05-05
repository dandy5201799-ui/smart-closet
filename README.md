# 智能衣橱 AI

本地运行的 React + Vite 衣橱：**Kimi** 负责识图与搭配，**火山方舟 Seedream** 负责模特上身图。

## 环境要求

- [Node.js](https://nodejs.org/)（建议 LTS）

## 快速开始

1. 安装依赖：

   ```bash
   npm install
   ```

2. 将 **`.env.example`** 复制为 **`.env`**，填写：

   | 变量 | 用途 |
   |------|------|
   | `KIMI_API_KEY` 或 `MOONSHOT_API_KEY` | 衣服识别、AI 搭配（必填其一） |
   | `ARK_API_KEY` | 模特上身图（Seedream） |
   | `KIMI_MODEL`（可选） | 默认 `kimi-k2.6` |
   | `ARK_IMAGE_MODEL`（可选） | 默认 `doubao-seedream-5-0-260128` |
   | `ARK_IMAGE_ENDPOINT`（可选） | 见下方说明 |

3. 启动：

   ```bash
   npm run dev
   ```

   修改 `.env` 后需重新执行上述命令。

## 其它命令

- `npm run build` — 生产构建  
- `npm run preview` — 预览**已有**的 `dist/`  
- `npm run build:preview` — 先构建再预览（模拟线上静态包；需已配置 `.env`，与 CI 注入方式一致）

## 本地正常、线上异常：原因与排查

| 对比 | 本地 `npm run dev` | GitHub Pages / Vercel 生产包 |
|------|-------------------|------------------------------|
| Kimi / 方舟请求 | 走 Vite **同源代理**（`vite.config.ts`），减轻浏览器跨域 | 浏览器 **直连** `api.moonshot.*` / `ark.*` |
| 密钥来源 | 根目录 **`.env`** | **构建时**注入：GitHub **Actions secrets**（见 `.github/workflows/deploy-github-pages.yml`）或 Vercel 环境变量；**不会**自动同步 `.env` |

**核对清单（与 `.env` 同名复制到 GitHub / Vercel）：**  
`KIMI_API_KEY` 或 `MOONSHOT_API_KEY`、`KIMI_MOONSHOT_HOST`（国内站 `cn`，国际站 `ai`）、`ARK_API_KEY`；可选 `KIMI_MODEL`、`KIMI_API_BASE`、`ARK_*`、`VITE_*`。详见 [`.env.example`](.env.example) 文末「线上构建」说明。

**改完线上密钥后：** 必须重新触发部署（例如 Actions 里 **Re-run** 或 `git push`），浏览器 **强制刷新**（Cmd+Shift+R），否则仍是旧 JS。

**浏览器 DevTools → Network：** 点一次识图；若状态为 **401**，多为密钥 / `KIMI_MOONSHOT_HOST` 与密钥来源不一致，或构建未带入 Secret；若出现 **CORS / failed**，为直连跨域策略，与本地代理路径不同，需自建 `KIMI_API_BASE` 等网关（见 `kimiService.ts`）。

## 说明

- 密钥通过 Vite 写入前端，**仅适合本地或个人使用**；上线请用后端代理，勿把密钥打进公开静态资源。
- **火山接口**：开发模式下默认经 Vite 代理访问，减轻浏览器跨域问题；`preview`/线上若跨域失败，可将 `ARK_IMAGE_ENDPOINT` 设为你方网关地址。

## 代码入口

- `services/aiService.ts` — 对外统一导出识图、搭配、生图  
- `services/kimiService.ts` — Kimi API  
- `services/volcengineSeedreamService.ts` — 火山 Seedream  
