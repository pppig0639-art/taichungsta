/* 簡易靜態伺服器：在 tcts 資料夾執行 `node serve.js` 即可。
   解決 Chrome 在 file:// 下 fetch('assets/...') 被擋住的問題。 */
const http=require('http'),fs=require('fs'),path=require('path');
const PORT=8000,ROOT=__dirname;
const TYPES={'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8',
  '.js':'application/javascript','.css':'text/css','.json':'application/json',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif',
  '.webp':'image/webp','.svg':'image/svg+xml',
  '.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.m4a':'audio/mp4',
  '.ico':'image/x-icon','.txt':'text/plain; charset=utf-8'};
http.createServer((req,res)=>{
  let url=decodeURIComponent(req.url.split('?')[0]);
  if(url==='/')url='/index.html';
  const fp=path.join(ROOT,url);
  /* 防止跳出根目錄 */
  if(!fp.startsWith(ROOT)){res.writeHead(403);return res.end('Forbidden');}
  fs.stat(fp,(err,st)=>{
    if(err||!st.isFile()){res.writeHead(404);return res.end('Not found: '+url);}
    const ext=path.extname(fp).toLowerCase();
    res.writeHead(200,{
      'Content-Type':TYPES[ext]||'application/octet-stream',
      'Content-Length':st.size,
      'Cache-Control':'no-cache'  // 開發中不快取，方便看修改
    });
    fs.createReadStream(fp).pipe(res);
  });
}).listen(PORT,()=>{
  console.log('  ★ tcts 本地伺服器啟動：http://localhost:'+PORT);
  console.log('  ★ 遊戲：     http://localhost:'+PORT+'/index.html');
  console.log('  ★ 後台：     http://localhost:'+PORT+'/admin.html');
  console.log('  ★ 按 Ctrl+C 停止伺服器');
});
