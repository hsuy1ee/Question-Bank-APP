[中文](./README.md) | [English](./README.en.md)

# 题库刷题

Windows 本地刷题软件，支持导入 JSONL 题库，进行顺序练习、随机练习、错题练习和收藏练习。

## 功能概览

- 导入 `.jsonl` 题库
- 支持单选、多选、判断题
- 支持顺序练习、随机练习、错题练习、收藏练习
- 支持答题记录、正确率、错题数、收藏数统计
- 支持 Word 题库按固定格式转换为 JSONL
- 使用本地 SQLite 文件保存题库和学习记录

## 编译教程

### 环境要求

- Windows
- Node.js 24 或较新版本
- npm

安装依赖：

```bash
npm install
```

### 开发运行

启动 Electron 开发版：

```bash
npm run dev
```

### 普通构建

检查 TypeScript、编译 Electron 主进程并构建前端：

```bash
npm run build
```

该命令会生成：

```text
dist/
dist-electron/
```

### 打包 Windows 安装包

生成 Windows 安装包：

```bash
npm run dist
```

打包结果会输出到：

```text
release/
```

其中常见文件包括：

```text
题库刷题 Setup 0.1.0.exe
题库刷题 Setup 0.1.0.exe.blockmap
win-unpacked/
```

`.exe` 是安装包；`win-unpacked/` 是免安装运行目录；`.blockmap` 是 electron-builder 生成的分块映射文件，主要用于自动更新的差量下载。如果只是手动安装软件，可以忽略 `.blockmap`。

## 题库格式

题库导入格式使用 JSONL：一行一道题，每一行都是一个完整 JSON 对象。

单选题示例：

```json
{"id":"q001","type":"single","question":"题干内容","options":["选项A","选项B","选项C","选项D"],"answer":["A"],"explanation":"答案：A（选项A）","tags":["单选"],"source":"示例题库"}
```

多选题示例：

```json
{"id":"q002","type":"multiple","question":"以下哪些说法正确？","options":["选项A","选项B","选项C","选项D"],"answer":["A","C"],"explanation":"答案：AC","tags":["多选"],"source":"示例题库"}
```

判断题示例：

```json
{"id":"q003","type":"judge","question":"判断题题干","answer":["true"],"explanation":"答案：A（A、是）","tags":["判断"],"source":"示例题库"}
```

字段说明：

- `id`：题目唯一 ID
- `type`：题型，只能是 `single`、`multiple`、`judge`
- `question`：题干
- `options`：选项，单选和多选需要提供
- `answer`：答案，统一使用字符串数组
- `explanation`：答案或解析
- `tags`：标签
- `source`：题库来源

## Word 转 JSONL

项目提供了一个 Word 转 JSONL 脚本：

```text
scripts/convert-docx-to-jsonl.ps1
```

运行示例：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\convert-docx-to-jsonl.ps1 `
  -InputDocx ".\你的题库.docx" `
  -OutputJsonl ".\converted\你的题库.jsonl"
```

脚本适配的 Word 题库格式如下：

```text
1. [单选] 题干内容
A. 选项A
B. 选项B
C. 选项C
D. 选项D
答案：A（选项A）
```

```text
2. [多选] 题干内容
A. 选项A
B. 选项B
C. 选项C
D. 选项D
答案：ABCD
```

```text
3. [判断] 题干内容
A. A、是
B. B、否
答案：B（B、否）
```

如果 Word 里的题目格式发生明显变化，需要同步调整转换脚本。

## 本地数据

软件使用 `sql.js` 在本地保存 SQLite 数据库，不需要额外安装 MySQL、PostgreSQL 或 SQLite 服务。

默认数据库位置：

```text
C:\Users\<你的用户名>\AppData\Roaming\question-bank-desktop\question-bank.sqlite
```

数据库中保存：

- 已导入题库
- 题目
- 答题记录
- 错题记录
- 收藏记录
- 首页统计数据

删除软件项目目录不会自动删除该数据库
