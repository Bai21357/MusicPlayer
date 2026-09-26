# Music-Player

A simple music player website with front-end and back-end.

访客端播放音乐与双语歌词，管理端上传/删除歌曲、歌词与封面。

## 环境要求

1. Node.js（**v18+**，重构后前端使用 ES module、后端使用 `structuredClone`/`randomUUID`）和 npm
2. 良好的网络环境
3. 最少 10MB 的硬盘空间

## 部署方法

1. 安装 Node.js、git、npm 和 pm2

```
sudo apt update && sudo apt upgrade
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install git -y
sudo apt-get install -y nodejs
sudo npm install pm2 -g
```

使用 git 克隆项目

```
git clone https://github.com/Bai21357/MusicPlayer.git
```

2. 依赖已在 package.json 中声明，切换至项目目录后执行：

```
cd MusicPlayer
npm install
```

3. 设置管理员密码（**建议必做**）

```
export ADMIN_PASSWORD='你的密码'
```

未设置时沿用默认密码 `admin666`，服务启动时会打印一条警告。

4. 使用 PM2 守护进程

启动

```
pm2 start server.js --name musicplayer
```

保存进程列表并设置开机自启

```
pm2 save
pm2 startup
```

重启项目

```
pm2 restart musicplayer
```

## 配置项

全部通过环境变量配置，无需改代码：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `ADMIN_PASSWORD` | `admin666` | 管理端密码 |
| `MZ_DATA_DIR` | 项目根目录 | 数据目录（`songs/`、`lyrics/`、`covers/`、两个 JSON 的存放位置） |
| `MAX_AUDIO_MB` | `100` | 单个音频大小上限（MB） |
| `MAX_COVER_MB` | `20` | 单张封面上限（MB） |
| `MAX_LYRIC_MB` | `10` | 单个歌词上限（MB） |

## 使用教程

#### 访客端

访问 http://IP:3000/
播放控制：点击歌曲列表中的歌曲开始播放；使用播放/暂停、上一首/下一首、进度条拖拽、音量调节。

歌词显示：当前播放歌曲若有匹配歌词，自动显示并高亮当前行。点击“双语/主译/译”按钮切换显示模式。

快捷键：

| 按键 | 作用 |
| --- | --- |
| Space | 播放/暂停 |
| ← / → | 快退/快进 5 秒 |
| L | 切换歌词显示模式 |
| M | 静音/恢复音量 |

#### 管理端

http://IP:3000/admin.html

可使用管理界面上传或删除歌词或歌曲（支持批量删除）。

默认管理员密码 admin666，请通过 `ADMIN_PASSWORD` 环境变量修改。

## 格式要求

歌词文件务必为 UTF-8 编码

音频文件 .mp3 .flac .m4a 格式均可

注意事项：上传文件名会先做编码还原再净化后落盘（重名会自动加随机后缀），
因此不再需要手工清理乱码文件；若历史数据里已有乱码文件名，删除记录后重新上传即可。

> 关于非 UTF-8 歌词：`iconv-lite` 与 `jschardet` 仍在依赖列表里，但**当前代码并未使用它们**，
> 即 GBK / Shift-JIS 歌词的自动转码尚未实现（旧版 README 的说法与代码不符），
> 请先自行把歌词转换为 UTF-8。如需自动转码，可在
> `src/services/library.js` 的 `readLyricFile()` 里接入编码探测与转换。

## 文件结构

```
~/musicplayer/
├── server.js                    # 入口：启动 / 优雅退出
├── package.json                 # 依赖与脚本
├── .gitignore
├── src/                         # 后端源码
│   ├── app.js                   # Express 应用装配（中间件顺序）
│   ├── bootstrap.js             # 启动引导：创建目录与 JSON 文件
│   ├── config.js                # 全部配置与阈值
│   ├── middleware/
│   │   ├── adminAuth.js         # 管理端鉴权（定长比较）
│   │   ├── upload.js            # multer 配置与文件名生成
│   │   └── errorHandler.js      # 统一错误处理（必须最后注册）
│   ├── routes/
│   │   ├── publicRoutes.js      # /api/*
│   │   └── adminRoutes.js       # /admin/*
│   ├── services/
│   │   ├── library.js           # 媒体库业务：上传/配对/删除的一致性
│   │   └── metadata.js          # 文件名还原、歌手/歌名拆分、音频元数据
│   ├── store/
│   │   ├── jsonFileStore.js     # 原子写 + 串行队列的 JSON 存储
│   │   └── index.js             # playlist / lyrics 两个存储实例
│   └── utils/                   # ids / safePath / logger / fsHelpers
├── scripts/
│   ├── smoke-test.js            # 端到端 API 冒烟测试
│   ├── check-frontend.js        # 前端静态检查（import/DOM id/语法）
│   ├── browser-check.js         # 浏览器端 E2E（无头 Edge/Chrome + CDP）
│   └── lib/test-media.js        # 测试素材合成（带 INFO 标签的真实 WAV）
├── public/                      # 前端（由 Express 静态托管）
│   ├── index.html               # 播放器页面
│   ├── admin.html               # 管理后台页面
│   ├── css/
│   │   ├── player.css
│   │   └── admin.css
│   └── js/
│       ├── lib/                 # 两端共用：api / dom / format / lyrics
│       ├── player/              # main.js + lyricsView.js + playlistView.js
│       └── admin.js
├── playlist.json                # 歌曲列表（运行时生成，不入库）
├── lyrics.json                  # 歌词元数据（运行时生成，不入库）
├── songs/                       # 音频文件
│   └── ... .mp3/.flac/.m4a
├── lyrics/                      # 歌词文件
│   └── ... .lrc/.txt
└── covers/                      # 封面图片
```

## 接口一览

访客端：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/songs` | 歌曲列表 |
| GET | `/api/lyrics/:filename` | 歌词原文（纯文本） |

管理端（需在 `Authorization` 头、`?token=` 或请求体里带密码）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/admin/songs` | 歌曲列表 |
| POST | `/admin/batch-upload` | 批量上传（字段：`audio` / `lyric` / `cover`） |
| POST | `/admin/songs` | 单独上传音频（字段：`file`，多选） |
| POST | `/admin/songs/:id/cover` | 上传/替换封面（字段：`cover`） |
| POST | `/admin/songs/:id/lyric` | 上传/替换歌词（字段：`lyric`） |
| DELETE | `/admin/songs/batch` | 批量删除（JSON 体 `{ ids: [] }`） |
| DELETE | `/admin/songs/:id` | 删除单曲 |
| GET | `/admin/lyrics` | 歌词记录列表 |
| POST | `/admin/lyrics` | 上传歌词文件（字段：`file` 或 `lyric`） |
| DELETE | `/admin/lyrics/:id` | 删除歌词记录与其文件 |

## 歌词匹配

该项目需要分别上传歌词与歌曲，当上传完成后，后台会自动匹配相应文件
推荐以 (歌手 - 歌名) 格式上传（歌词、歌名同）

该项目歌词内容格式需要 Bai21357/convert_lrc 转换

(Bai21357/convert_lrc 是一个用于预处理双语歌词文件的批处理工具)

#### 精确匹配

歌名应与歌词文件名完全一致（封面文件名可带 `-cover`、`-front` 等后缀，会自动忽略）

#### 模糊匹配

若精确匹配失败，会再做一次忽略大小写的匹配

#### 歌词内容格式

```
[时间戳]外语歌词 / 中文歌词
[时间戳]外语歌词 / 中文歌词
```

示例

```
[00:15.14]さくらの季節 / 樱花季节
[00:30.31]動き出す 夜の世界は / 夜晚的世界动了
```

## 开发与测试

```
npm run start            # 启动服务
npm run dev              # nodemon 热重载
npm run test:smoke       # 端到端 API 冒烟测试（临时数据目录，不影响正式数据）
npm run check:frontend   # 前端静态检查：import 路径 / 语法 / DOM id / 样式表引用
npm run check:browser    # 浏览器端 E2E（无头 Edge/Chrome + CDP；未装浏览器则自动跳过）
```

前端是原生 ES module，无需构建；但**必须通过 HTTP 访问**（`npm start` 或任意静态服务器），
直接用 `file://` 打开 HTML 会因浏览器模块安全策略而无法加载脚本。

`check:browser` 会自己起服务、灌入测试数据、驱动真实页面并断言渲染结果与
控制台是否干净，截图输出到系统临时目录（`BROWSER_CHECK_SHOTS` 可指定目录，
`BROWSER_PATH` 可指定浏览器可执行文件）。

## 技术栈

后端：Node.js 18+ / Express 5 / Multer 2（文件上传）/ music-metadata 11（元数据解析）

前端：原生 HTML/CSS/JavaScript（ES module，无构建步骤）

数据存储：JSON 文件（`playlist.json` 与 `lyrics.json`），写入为原子替换

依赖版本（均为当前最新大版本）：

| 包 | 版本 | 备注 |
| --- | --- | --- |
| express | ^5.2.1 | v4 → v5 |
| multer | ^2.4.0 | v1（含已知漏洞）→ v2 |
| music-metadata | ^11.16.1 | v7 → v11，**纯 ESM 包** |
| cors | ^2.8.6 | |
| nodemon | ^3.1.14 | 开发依赖 |

> `music-metadata` 自 v8 起只提供 ESM 入口，而本后端仍是 CommonJS，
> 因此在 `src/services/metadata.js` 里用动态 `import()` 加载（只加载一次）。
> 这样既能用上最新版本，也不必把整个后端改成 ESM。
> 若希望后端也全量迁移到 ESM，可另行进行——那会涉及每个源文件的改写。

## 重构说明

本次重构（v2.0.0）在保持接口与页面行为不变的前提下拆分了单体文件，并修复了以下缺陷：

| 问题 | 说明 | 处理 |
| --- | --- | --- |
| 批量删除失效 | `DELETE /admin/songs/:id` 注册在 `/admin/songs/batch` 之前，`batch` 被当作 id，必然 404 | 调整注册顺序，并用冒烟测试锁定 |
| 错误中间件失效 | 全局错误中间件注册在所有路由**之前**，multer 错误从未被捕获，返回 HTML 错误页 | 移到路由之后，multer/JSON 解析错误统一转 JSON |
| 路径穿越 | `/api/lyrics/:filename` 直接 `path.join(lyricsDir, filename)` | 统一走 `resolveInsideDir`（basename + 目录归属校验） |
| XSS | 标题/歌手来自上传元数据，却被拼进 `innerHTML` | 前端改为 DOM API + `textContent` |
| 并发丢数据 | 读写 JSON 无串行化，并发请求互相覆盖 | `JsonFileStore` 串行队列 + 内存缓存 |
| 数据损坏 | `writeFileSync` 非原子，中断会留下半截 JSON | 先写临时文件再 `rename`，解析失败自动备份并重置 |
| 批量上传 O(n²) | 每个文件都全量读+写一次 `playlist.json` | 整批一次读-改-写 |
| 同名文件覆盖 | 存储名用 `Date.now() + 原名`，同批次同名必覆盖 | 加随机后缀；文件名先还原编码再净化 |
| 歌词池落错目录 | `POST /admin/lyrics` 的 `file` 字段被存进 `songs/` | 该路由使用独立的 lyrics 目录存储 |
| 硬编码密码 | `admin666` 写死在代码里且打印到日志 | 改为 `ADMIN_PASSWORD` 环境变量，日志只提示不打印 |
| ID 碰撞 | `Date.now() + Math.random().substr(2,4)`，且 `substr` 已废弃 | 改用 `crypto.randomUUID()` |
| 监听器泄漏 | 管理端每次渲染列表都重新绑定「全选」 | 只绑定一次 |
| 重复代码 | 删除歌曲逻辑两份、元数据解析两份、歌词行渲染三份 | 收敛到 `library.js` / `metadata.js` / `LyricsView` |
| 高亮错位 | 歌词解析顺序与 DOM 顺序不一致时高亮会偏 | 高亮索引直接对应定时行数组 |
| 依赖漏洞 | multer 1.x 有已知漏洞（安装时的 npm 警告） | 升到 multer 2.x，同时 express 4→5、music-metadata 7→11 |

行为保持不变的部分：所有 API 路径、请求/响应结构、错误文案、页面 DOM 结构与样式、
`playlist.json` / `lyrics.json` 的位置与格式（可直接复用已有数据）。

冒烟测试与浏览器 E2E 覆盖的回归点：批量删除路由、上传错误返回 JSON、路径穿越、
同批次同名文件、并发写入、歌词池落盘目录、**非 ASCII 文件名全链路**
（上传 → 落盘 → 静态访问 → 界面显示）、真实音频元数据解析优先于文件名、
歌词高亮与显示模式切换、管理端登录/列表/批量删除。

已知保留项（有意未改）：

- 管理端「单独上传音频」入口仍是占位提示（原逻辑如此，后端接口可用）
- `cors()` 仍为全量放行，以便 Live Server 等跨端口开发；生产建议在 nginx 层收紧
- 管理端密码为静态口令，未加会话与限流，请务必修改默认密码并用 HTTPS
- `iconv-lite` / `jschardet` 仍未被任何代码引用（见「格式要求」一节说明）

## 注意事项

下面就是些碎碎念了

使用网站域名时 nginx 格式

```
server {
    server_name music.114514.xyz; #这里改为你自己的域名
    client_max_body_size 100m;    #修改上传文件大小限制

    access_log /var/log/nginx/musicplayer-access.log;
    error_log /var/log/nginx/musicplayer-error.log; #记录log

    # 反向代理到 Node.js
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 静态资源缓存
    location ~* \.(css|js|jpg|jpeg|png|gif|ico|svg|woff|woff2|ttf|eot|mp3|wav|flac)$ {
        proxy_pass http://127.0.0.1:3000;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

启用站点

```
sudo ln -s /etc/nginx/sites-available/musicplayer /etc/nginx/sites-enabled/ #创建软链
sudo nginx -t   # 测试语法
sudo systemctl reload nginx #重载nginx
```

使用 certbot 给网站颁发证书

```
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d music.114514.xyz #这里改为你自己的网站
```
