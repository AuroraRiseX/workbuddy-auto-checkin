# WorkBuddy Auto Check-in

自动检查并领取 WorkBuddy「Buddy加油站」每日积分，提供 macOS 和 Windows 安装脚本。通过 WorkBuddy 自带的本地 IPC 使用当前登录状态，不保存密码、不导出云端 Token，也不调用 AI 模型。

## 工作方式

- 安装后立即运行，登录系统后启动，之后每小时检查一次。
- 当天已领取则跳过；失败后下一轮重试。
- 发起领取后重新查询状态，确认领取结果。
- 日志记录在当前用户的程序数据目录，不写入仓库。

需要电脑开机、联网、系统用户保持登录，并保持 WorkBuddy 登录有效。锁屏可运行；休眠期间暂停，唤醒后等待下一轮检查。奖励金额与活动有效期以客户端当期活动为准。

## 安装

先安装并登录 WorkBuddy，再安装 [Node.js](https://nodejs.org/) 18 或更新版本（推荐 LTS）。下载并解压本仓库后：

| 系统 | 安装 | 卸载定时任务 |
| --- | --- | --- |
| macOS | 双击 `install-mac.command` | 双击 `uninstall-mac.command` |
| Windows 10 / 11 | 双击 `install-windows.cmd` | 双击 `uninstall-windows.cmd` |

安装器将程序复制到固定目录并注册系统定时任务。安装成功后无需每天手动运行，移动下载文件夹也不会影响已安装任务。

完整安装步骤、日志位置、错误说明和高级配置见 [使用说明](使用说明.md)。

## 手动运行

```sh
node checkin.cjs --status     # 只查询，不领取
node checkin.cjs              # 检查并领取，必要时启动客户端
node checkin.cjs --no-launch  # 不启动客户端
node --test test.cjs          # 本地模拟测试，不访问真实账号
```

## 验证状态

macOS 已现场验证安装、系统任务运行及真实签到状态查询，8 项本地测试通过。Windows 安装器及命名管道分支尚未实机验证；从未领取状态由脚本完成真实领取的跨日过程尚未验证。

本工具依赖 WorkBuddy 内部接口，现场验证客户端版本为 5.9.3；后续客户端或活动规则变更可能需要更新脚本。本项目不是 WorkBuddy 官方项目。
