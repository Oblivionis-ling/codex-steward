# 来源与修改

本目录复用 [chuspeeism/dashi-taskboard](https://github.com/chuspeeism/dashi-taskboard) 的本地 SQLite 卡片、评论与可选关系实现。

- 上游版本：1.1.26
- 固定提交：`6a79ef522238ff11681cb85a9d803d19442a3d00`
- 许可证：Apache-2.0，完整文本见 `LICENSE`。
- 纳入文件：`server/database.mjs` 与 `shared/{api-fields,domain,task-records,task-relations}.mjs`。
- 这些文件保留上游内容；Ling 的五阶段、构思/实施隔离、旧数据迁移、原生聊天入口和界面在 `src/` 实现。

没有引入上游云同步、Jira、定时认领、Tauri 或 CDP 注入器。0.3.0 使用已有 Codex 插件全局入口和原生聊天链接；相关宿主兼容性单独验证。
