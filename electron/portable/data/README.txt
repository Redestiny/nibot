Nibot 绿色版数据目录
====================

这个 data 目录一旦存在，Nibot 就以绿色（免安装）模式运行：所有数据都写在这里，
不碰系统目录，整个文件夹拷到 U 盘或别的电脑上可以直接接着用。

  data/.config/nibot/config.json   provider 配置（含明文 API key，请勿外传）
  data/books/                      默认的书籍目录
  data/app/                        窗口状态、浏览器缓存等运行时数据

几点说明：

* 删掉这个 data 目录，Nibot 会退回普通模式，改用系统目录
  （Windows 为 %APPDATA%\Nibot，书籍在“文档\Nibot”），并与命令行版
  nibot 共享 ~/.config/nibot 里的 provider 配置。
* 反过来，安装版如果想改成绿色模式，在 Nibot.exe 旁边新建一个 data
  文件夹即可，重启后生效。
* 绿色模式与安装版的 provider 配置各自独立，换模式后需要重新配一次。
* 书籍目录可以通过菜单“文件 → 选择书籍目录”改到别处；改完的路径会记在
  data/app/desktop.json 里，换电脑后如果路径不存在会自动回退到 data/books。
