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
- `npm run build:preview` — 先构建再预览（模拟线上静态包，不包含 API 密钥）

## 公开部署与密钥安全

- 生产构建不会注入 `KIMI_API_KEY`、`MOONSHOT_API_KEY` 或 `ARK_API_KEY`，即使构建环境中设置了这些变量。
- GitHub Pages 构建不再读取这些 API 密钥。不要把新的提供商密钥放进前端代码、`VITE_*` 变量或公开静态文件。
- 公开静态站点的 AI 识别、搭配和生图暂时不可用；衣橱的本地存储等基础功能不受此保护措施影响。
- 本地 `npm run dev` 仍可读取未提交的 `.env`。仅在可信本机使用，不要将开发服务器暴露到公开网络。
- 如需恢复线上 AI 功能，应先实现服务端代理，由服务端保存密钥并进行访问控制；本项目尚未实现该代理。
- 从最新文件移除密钥不会撤销凭据，也不会清除旧提交、缓存或已经下载的副本。曾公开的密钥仍需要在对应服务控制台撤销或更换。

## 代码入口

- `services/aiService.ts` — 对外统一导出识图、搭配、生图  
- `services/kimiService.ts` — Kimi API  
- `services/volcengineSeedreamService.ts` — 火山 Seedream  
