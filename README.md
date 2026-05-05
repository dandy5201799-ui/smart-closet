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
- `npm run preview` — 预览构建结果  

## 说明

- 密钥通过 Vite 写入前端，**仅适合本地或个人使用**；上线请用后端代理，勿把密钥打进公开静态资源。
- **火山接口**：开发模式下默认经 Vite 代理访问，减轻浏览器跨域问题；`preview`/线上若跨域失败，可将 `ARK_IMAGE_ENDPOINT` 设为你方网关地址。

## 代码入口

- `services/aiService.ts` — 对外统一导出识图、搭配、生图  
- `services/kimiService.ts` — Kimi API  
- `services/volcengineSeedreamService.ts` — 火山 Seedream  
