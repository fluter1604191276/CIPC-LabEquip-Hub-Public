# 公开仓库前检查

核对日期：2026-09-16。

## 当前结论

内部历史仓库 `fluter1604191276/CIPC-LabEquip-Hub` 保持 Private。公开发布使用独立的干净历史仓库 `fluter1604191276/CIPC-LabEquip-Hub-Public`，避免暴露旧提交中的人员和域名信息。

旧 Git 历史中存在过真实账号、人员姓名和实际部署域名。当前工作区已脱敏，但直接把原仓库改成 Public 仍会公开这些历史对象。

## 推荐发布路径

### 路径 A：创建干净公开仓库（推荐）

1. 保留现有私有仓库作为内部历史和生产追溯仓库。
2. 在当前已脱敏工作区完成一次全量检查。
3. 新建空的公开 GitHub 仓库，不导入旧历史。
4. 以当前工作区创建首个公开提交。
5. 推送 `main`，再创建 `v1.3.0` 标签。
6. 老师使用 `v1.3.0` 标签部署，不使用未固定的开发分支。

### 路径 B：重写现有历史后公开

只有在明确需要保留 Git 历史时采用。必须用 `git filter-repo` 或等效工具移除所有历史中的真实账号、人员信息、域名、日志和敏感配置，然后强制更新远端引用，并通知所有协作者重新克隆。此操作具有破坏性，本项目未自动执行。

## 发布前命令

```bash
pnpm check
git diff --check
git grep -n -I -E '真实账号|真实姓名|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|api[_-]?key|access[_-]?token' || true
git ls-files | rg '(^|/)(\.env|.*\.sqlite|.*\.sqlite-wal|.*\.sqlite-shm)$' || true
```

还要检查：

- `docs/ACCOUNT_DIRECTORY.md` 不包含真实人员名单；
- `deploy/vps/cipc-labequip.caddy` 中的域名已替换为示例域名，安装前必须由部署者替换；
- `deploy/vps/` 和 `deploy/lan/` 中的真实网段、数据库路径、告警凭据没有被硬编码；
- 生产单元设置 `SEED_DEMO_USERS=false`；
- 首次空库使用 `pnpm bootstrap:admin` 初始化管理员；
- `.env.example`、可选 Compose 和 CI 不包含可用生产密钥；
- 公开仓库只发布代码、测试和部署模板，不发布生产 SQLite、备份、临时密码或私钥。
