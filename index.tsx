/// <reference types="vite/client" />
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

/** 开发预览：在地址栏加 ?mobile=1（或 true），根容器限制为手机宽度，便于在 Cursor 等窄窗口内模拟手机 */
if (import.meta.env.DEV) {
  const q = new URLSearchParams(window.location.search);
  if (q.get("mobile") === "1" || q.get("mobile") === "true") {
    document.documentElement.classList.add("dev-mobile-preview");
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);