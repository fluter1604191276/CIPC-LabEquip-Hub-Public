# 实验室资源平台 v1.4.6 发布说明

发布日期：2026-09-18

## 本版重点

v1.4.6 是升级链路稳定性增强版本，业务数据模型和日常操作流程保持兼容。

### 升级中心增强

- 检查更新时解析并保存 Git 提交 SHA，升级时按不可变提交下载代码，避免标签漂移。
- 升级代理增加原子目录锁，网页重复点击、systemd 触发和人工命令不会并发切换 release。
- 下载版本的语法检查和测试改为非 shell 参数调用，并使用运行账号执行测试。
- systemd 升级单元增加 `TimeoutStartSec=15min`。
- 损坏或失败的升级请求会被隔离为 `.invalid-*` / `.failed-*` / `.completed-*` 文件，避免反复触发。
- 升级页面在任务排队或执行期间自动轮询状态，完成后自动停止轮询。
- 手动升级脚本固定到获取后的目标 commit，并增加并发锁。

## 兼容性

- 兼容 v1.3.0 及之后的生产数据库。
- 不要求重新创建账号、实验室、设备或预约数据。
- 已安装 v1.4.0 及之后升级代理的环境，可先将当前代码更新到 v1.4.6，再继续使用系统升级中心。
- v1.3.0/v1.3.1 环境继续使用手动升级脚本完成首次迁移。

## 升级后检查

```bash
curl -fsS http://127.0.0.1:4000/api/health
curl -fsS http://127.0.0.1:8080/healthz
sudo systemctl status cipc-labequip-api.service --no-pager
sudo systemctl status cipc-labequip-upgrade.path --no-pager
cat /var/lib/cipc-labequip/data/upgrade/status.json
```

升级代理只回滚代码 release；数据库仍通过升级前创建的 SQLite 快照单独恢复。
