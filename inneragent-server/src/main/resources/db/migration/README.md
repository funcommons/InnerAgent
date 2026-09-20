# 迁移脚本约定(对齐技术方案 §5.1)

- 文件名:`V<序号>__<英文描述>.sql`,从 V1 起连续递增,snake_case 描述。
- 表前缀统一 `ia_`;所有业务表携带 `app_id`(单应用部署也强制携带,ADR-10 预留多应用)与 `tenant_id`。
- 表与列 `COMMENT` 使用中文(专名除外)。
- 已在任何共享/测试库执行过的迁移不可修改;未发布迁移需要改语句时优先重建本地库。
- 迁移后至少跑一次空库 `flyway migrate`(docker/dev-compose.yml 起库)+ 应用启动 validate。
