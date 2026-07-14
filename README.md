# Music-Player
A simple music player website with front-end and back-end

## 环境要求
1. Node.js（v16+）和 npm
2. 良好的网络环境
3. 最少10MB的硬盘空间

## 部署方法

1.安装 Node.js（v16+） git   npm  和  pm2

```
sudo apt update && sudo apt upgrade
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install git -y
sudo apt-get install -y nodejs
sudo npm install pm2 -g
```
使用git克隆项目
```
git clone https://github.com/Bai21357/Music-Player.git
```

2.依赖已在 package.json 中声明,切换至项目目录,然后执行：
```
cd Music-Player
npm install
```

3.使用 PM2 守护进程

启动
```
pm2 start server.js --name music-player
```

保存进程列表并设置开机自启
```
pm2 save
pm2 startup
```
重启项目
```
pm2 restart music-player
```

## 使用教程

#### 访客端
访问 http://IP:3000/
播放控制：点击歌曲列表中的歌曲开始播放；使用播放/暂停、上一首/下一首、进度条拖拽、音量调节。

歌词显示：当前播放歌曲若有匹配歌词，自动显示并高亮当前行。点击“双语/主译/译”按钮切换显示模式。


快捷键：

Space：播放/暂停

← / →：快退/快进 5 秒

L：切换歌词显示模式

#### 管理端
http://IP:3000/admin.html

可使用管理界面上传或删除歌词或歌曲

默认管理员密码 admin666

部署后请在server.js中及时修改密码

## 格式要求

歌词文件务必为 UTF‑8 编码

部分格式支持自动转码（如 Shift-JIS、GBK等）

音频文件 .mp3 .flac .m4a 格式均可

注意事项:如出现上传后文件名乱码,应先删除乱码文件(包括playlist.jsonlie列表记录)
再检查相关文件编码(针对歌词文件)

## 文件结构
```

~/music-player/
├── server.js               # 后端
├── package.json            # 依赖声明
├── playlist.json           # 歌曲列表
├── lyrics.json             # 歌词元数据
├── songs/                  # 音频文件
│   └── ... .mp3/.flac/.m4a
├── lyrics/                 # 歌词文件
│   └── ... .lrc/.txt
└── public/
    ├── index.html          # 播放器
    └── admin.html          # 管理后台
```

## 歌词匹配

该项目需要分别上传歌词与歌曲,当上传完成后,后台会自动匹配相应文件
推荐以 (歌手 - 歌名) 格式上传(歌词,歌名同)

该项目歌词内容格式需要 Bai21357/convert_lrc 转换

(Bai21357/convert_lrc 是一个用于预处理双语歌词文件的批处理工具)

#### 精确匹配

歌名应与歌词文件名完全一致

#### 模糊匹配

歌曲名字与歌词名字会被分别拆开,拆分成单独的字符串

让后根据字符串依次比较,若有相同字符串,则匹配成功


#### 歌词内容格式

[时间戳]外语歌词 / 中文歌词

[时间戳]外语歌词 / 中文歌词

示例

[00:15.14]さくらの季節 / 樱花季节

[00:30.31]動き出す 夜の世界は / 夜晚的世界动了

## 技术栈

后端：Node.js + Express + Multer（文件上传）+ music-metadata（元数据解析）+ iconv-lite + jschardet（编码检测）

前端：原生 HTML/CSS/JavaScript

数据存储：JSON 文件（playlist.json 和 lyrics.json）

## 注意事项

下面就是些碎碎念了

使用网站域名时nginx格式
```
server {
    server_name music.114514.xyz; #这里改为你自己的域名
    client_max_body_size 100m;    #修改上传文件大小限制

    access_log /var/log/nginx/music-player-access.log;
    error_log /var/log/nginx/music-player-error.log; #记录log

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
sudo ln -s /etc/nginx/sites-available/music-player /etc/nginx/sites-enabled/ #创建软链
sudo nginx -t   # 测试语法
sudo systemctl reload nginx #重载nginx
```
使用certbot给网站颁发证书
```
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d music.114514.xyz #这里改为你自己的网站
```
