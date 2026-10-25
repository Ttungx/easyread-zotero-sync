# EasyRead Sync

将 EasyRead 已完成全文翻译的论文同步为 Zotero 的 `EasyRead翻译` 附件，在手机上离线阅读翻译版。

<img src="assets/android-reader.png" width="280" align="left" alt="Android Zotero 内阅读翻译版论文">

基于 [zotero-easyread](https://github.com/apple5089/zotero-easyread) 的独立插件，不修改原插件或 EasyRead 安装程序。

## 功能

- 右键 **同步翻译内容**，可多选（每批 20 篇）；只同步已完成全文翻译的论文，不自动补译。
- 附件为无脚本静态 HTML：译文、公式（KaTeX）、表格、插图、参考文献，不含聊天与批注数据。
- 原地更新同一附件，不产生副本；字节未变跳过写入，文件丢失自动恢复。
- 手机单栏排版、折叠目录、表格与长公式局部滚动、深色模式。
- 同步沿用 Zotero 现有的 WebDAV / Zotero Storage；WebDAV 推荐使用 [坚果云官方插件](https://github.com/nutstore/zotero-plugin-nutstore)。

原插件的「用 EasyRead 阅读」、批量发送和笔记同步能力保留；执行「同步翻译内容」不会发送或翻译 PDF。

## 安装与使用

前置条件：Zotero 10.0.x、EasyRead 本地服务可访问（导出适配基线为 1.4.3 / API v1）、PDF 已下载到 Zotero。

1. 从 [Releases](https://github.com/Ttungx/easyread-zotero-sync/releases) 下载 XPI，或运行 `python build.py` 构建。
2. 在 Zotero 插件管理页安装；从 0.2.0 升级直接覆盖。
3. 在 EasyRead 完成论文全文翻译。
4. 在 Zotero 执行「同步翻译内容」，插件按 PDF 指纹自动匹配。
5. 电脑端同步完成后，在 Android Zotero 下载附件离线阅读。

当前为候选构建：隔离宿主测试与真实论文渲染检查已通过，真实文献库与 Android 真机验收待完成，见 [VALIDATION.md](VALIDATION.md)。

## 连接设置

插件只读复用原插件已配置的连接目录与可执行文件路径，不修改这些设置。自动发现失败时，打开「工具 → EasyRead Sync：连接设置」：

- **数据目录**应包含 `.server.json`。
- **服务地址**留空自动发现；手动填写只接受 `http://127.0.0.1:端口`。端口可能随 EasyRead 重启变化。

设置修改后立即保存，无效的服务地址不会写入。

## 更新保护

**修改译文后重新同步，可能使 HTML 附件上已有的 Zotero 划线错位。** 插件不删除批注，不自动迁移位置。

- 附件有原生批注或被人工修改时不直接覆写：批量跳过，单选时确认。
- 每次覆写前在 Profile 的 `easyread-zotero-sync-backups/` 保留上一份 HTML。
- 同步冲突、待下载或 Zotero 正在同步时不覆写。

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
