# EasyRead Sync

将 EasyRead 已完成全文翻译的论文同步为 Zotero 的 `EasyRead翻译` 附件，在电脑与 Android 的 Zotero 内离线阅读。基于 [zotero-easyread](https://github.com/apple5089/zotero-easyread) 的独立插件，不修改原插件或 EasyRead 安装程序。

## 功能

- 右键文献或 PDF → **同步翻译内容**，可多选（每批最多 20 篇）。只有全文翻译完成的论文才导出；未译完、翻译运行中或有失败页时跳过，不自动补译。
- 输出无脚本的静态 HTML：译文、公式（KaTeX）、表格、插图和参考文献。不混入聊天记录、阅读批注或阅读进度。
- 首次同步创建存储附件并加 `EasyRead` 标签；再次同步更新同一附件，不产生副本。字节未变时跳过写入；文件丢失时恢复。
- 手机单栏排版，折叠目录，表格和长公式局部横向滚动，深色与打印样式。
- 文件上传与手机下载沿用 Zotero 现有的 WebDAV 或 Zotero Storage 配置，插件不接触云盘凭据。

原插件的「用 EasyRead 阅读」、批量发送和笔记同步能力保留，但执行「同步翻译内容」不会发送或翻译 PDF。

## 安装与使用

前置条件：Zotero 10.0.x、EasyRead 本地服务可访问（导出适配基线为 1.4.3 / API v1）、PDF 已下载到 Zotero。

1. 在项目根目录运行 `python build.py`，获得 `dist/easyread-zotero-sync-0.2.1.xpi`。
2. 在 Zotero 插件管理页「从文件安装插件」打开 XPI。从 0.2.0 升级直接安装即可，不影响已有附件。
3. 在 EasyRead 完成论文全文翻译。
4. 在 Zotero 选中文献，执行「同步翻译内容」。插件按 PDF 的完整 SHA-256 与 EasyRead 匹配，不按标题猜测。
5. 等待电脑端文件同步完成，再在 Android Zotero 同步并下载附件。

当前为候选构建：隔离宿主测试与真实论文渲染检查已通过，真实文献库与 Android 真机验收待完成，见 [VALIDATION.md](VALIDATION.md)。

## 连接设置

插件只读复用原插件已配置的连接目录与可执行文件路径，不修改这些设置。自动发现失败时，打开「工具 → EasyRead Sync：连接设置」：

- **数据目录**应包含 `.server.json`。
- **服务地址**留空自动发现；手动填写只接受 `http://127.0.0.1:端口`。端口可能随 EasyRead 重启变化。

设置修改后立即保存，无效的服务地址不会写入。

## 更新保护

**修改译文后重新同步，可能使 HTML 附件上已有的 Zotero 划线错位。** 插件不删除批注，不自动迁移位置。

- 附件有原生批注或被人工修改时，批量同步跳过并报告；单选同步时询问确认，默认不更新。
- 每次覆写前保留上一份 HTML 到 Profile 下的 `easyread-zotero-sync-backups/`，每个附件只保留一份，不进入云盘。
- 附件处于同步冲突、待下载或 Zotero 正在同步时，不覆写。

插件标识为 `easyread-zotero-sync@local.research`，使用独立的偏好、协议和 `easyread-zotero-sync.json` 注册表，不改原插件数据。卸载插件不会删除已导入的附件。更新清单为仓库根目录的 `updates.json`。

## 开发

命令在项目根目录执行，无需 npm 或 pip 运行时依赖（Node.js 22+、Python 3.10+）：

```bash
node --test tests/core.test.cjs tests/compat.test.cjs
python -m unittest discover -s tests -p "test_*.py" -v
python build.py
```

- `zotero/`：插件实现与固定版本的渲染资源。
- `tests/`：单元测试与隔离宿主测试；验证方法见 [VALIDATION.md](VALIDATION.md)。
- `docs/plan-sync-translation-content.md`：方案与边界。

## 许可

MIT，见 [LICENSE](LICENSE)。随插件打包的 KaTeX 与 Markdown 渲染资源来自上游开源项目，同为 MIT 许可。本项目不代表 Zotero 或 EasyRead 官方。
