#!/usr/bin/env node
/* tools/build-bundle.js
 * 把 index.html 和 assets/ 資料夾整個打包成一個獨立的 HTML 檔。
 * 用法：node tools/build-bundle.js
 * 輸出：index-bundle.html（單一檔案，含所有圖／音檔 base64 內嵌） */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(ROOT, 'index.html');
const ADMIN_PATH = path.join(ROOT, 'admin.html');
const ASSETS_DIR = path.join(ROOT, 'assets');
const OUTPUT_PATH = path.join(ROOT, 'index-bundle.html');
const ADMIN_OUTPUT_PATH = path.join(ROOT, 'admin-bundle.html');

const MIMES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png',  '.webp': 'image/webp',
  '.gif': 'image/gif',  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',  '.ogg': 'audio/ogg',
  '.json': 'application/json', '.txt': 'text/plain'
};

function humanSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/1024/1024).toFixed(1) + ' MB';
}

function fileToDataURL(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIMES[ext] || 'application/octet-stream';
  const data = fs.readFileSync(filePath);
  return `data:${mime};base64,${data.toString('base64')}`;
}

/* 遞迴列出 assets/ 下所有檔案 */
function listAssetFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) {
      out.push(...listAssetFiles(full));
    } else if (it.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function buildAssetMap() {
  console.log('▸ 掃描 assets/ 資料夾...');
  if (!fs.existsSync(ASSETS_DIR)) {
    console.warn('!  assets/ 資料夾不存在，將產出沒有素材的 bundle');
  }
  const assetFiles = listAssetFiles(ASSETS_DIR);
  console.log('  找到', assetFiles.length, '個檔案');
  const assetMap = {};   /* 路徑 → dataURL（唯一一份大資料）*/
  const key2path = {};   /* 檔名(去副檔名) → 路徑（小字串索引，避免重複存 base64）*/
  let totalAssetSize = 0;
  for (const f of assetFiles) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    const stat = fs.statSync(f);
    assetMap[rel] = fileToDataURL(f);
    const stem = path.basename(f, path.extname(f));
    key2path[stem] = rel;
    totalAssetSize += stat.size;
    if (stat.size > 2 * 1024 * 1024) {
      console.log('  ⚠ 大檔：', rel, humanSize(stat.size));
    }
  }
  console.log('  資源原始大小：', humanSize(totalAssetSize),
    '→ base64 後約', humanSize(Math.round(totalAssetSize * 1.37)));
  return { assetMap, key2path };
}

function injectBundle(html, assetMap, key2path, label) {
  /* Injection A：放在 <body> 之後（主腳本之前）
     — 定義 __BUNDLED_ASSETS__（路徑→dataURL）+ __BUNDLED_KEY2PATH__（key→路徑，小索引）
       + 攔截 fetch（給 bootstrap 用） */
  const headInject =
'\n<!-- ═══ BUNDLED ASSETS（tools/build-bundle.js 產生）═══ -->\n' +
'<script>\n' +
'window.__BUNDLED_ASSETS__=' + JSON.stringify(assetMap) + ';\n' +
'window.__BUNDLED_KEY2PATH__=' + JSON.stringify(key2path) + ';\n' +
'window.__BUNDLED_KEYURL__=function(key){\n' +
'  var p=window.__BUNDLED_KEY2PATH__&&window.__BUNDLED_KEY2PATH__[key];\n' +
'  return p&&window.__BUNDLED_ASSETS__?window.__BUNDLED_ASSETS__[p]:null;\n' +
'};\n' +
'(function(){\n' +
'  var orig=window.fetch.bind(window);\n' +
'  window.fetch=function(p,opts){\n' +
'    if(typeof p===\'string\'&&window.__BUNDLED_ASSETS__&&window.__BUNDLED_ASSETS__[p]){\n' +
'      return orig(window.__BUNDLED_ASSETS__[p],opts);\n' +
'    }\n' +
'    return orig(p,opts);\n' +
'  };\n' +
'  console.log(\'[bundle:' + label + '] \'+Object.keys(window.__BUNDLED_KEY2PATH__).length+\' 個資源已內嵌（記憶體供應，不需 IndexedDB）\');\n' +
'})();\n' +
'</script>\n';

  /* Injection B：放在主腳本之後（</body> 之前）
     — 覆寫 loadAsset，bundle 內的 key 直接從記憶體 dataURL 轉 blob 回傳，
       完全繞過 IndexedDB，讓 file:// 直接開也能跑（不用 a-Shell） */
  const tailInject =
'\n<!-- ═══ BUNDLE：loadAsset 改走記憶體（繞過 IndexedDB）═══ -->\n' +
'<script>\n' +
'(function(){\n' +
'  if(typeof loadAsset!==\'function\')return;\n' +
'  var origLoad=loadAsset;\n' +
'  window.loadAsset=function(key,cb){\n' +
'    var url=window.__BUNDLED_KEYURL__&&window.__BUNDLED_KEYURL__(key);\n' +
'    if(url){\n' +
'      fetch(url).then(function(r){return r.blob();})\n' +
'        .then(function(b){cb(b);})\n' +
'        .catch(function(){origLoad(key,cb);});\n' +
'      return;\n' +
'    }\n' +
'    return origLoad(key,cb);\n' +
'  };\n' +
'  /* 重新套用一次場景圖片，確保用上記憶體素材 */\n' +
'  if(typeof applyImageAssets===\'function\'){try{applyImageAssets(function(){});}catch(e){}}\n' +
'  console.log(\'[bundle:' + label + '] loadAsset 已改走記憶體\');\n' +
'})();\n' +
'</script>\n';

  const bodyOpen = html.match(/<body[^>]*>/i);
  if (!bodyOpen) {
    console.error('×  找不到 <body> 標籤（' + label + '）');
    process.exit(1);
  }
  let out = html.replace(bodyOpen[0], bodyOpen[0] + headInject);
  /* 把 tailInject 插在最後一個 </body> 之前 */
  const lastBody = out.lastIndexOf('</body>');
  if (lastBody >= 0) {
    out = out.slice(0, lastBody) + tailInject + out.slice(lastBody);
  } else {
    out += tailInject;
  }
  return out;
}

function main() {
  if (!fs.existsSync(INDEX_PATH)) {
    console.error('×  找不到 index.html：', INDEX_PATH);
    process.exit(1);
  }

  const maps = buildAssetMap();
  const assetMap = maps.assetMap, key2path = maps.key2path;

  /* ── 1. 遊戲端 index-bundle.html ── */
  console.log('');
  console.log('▸ 打包遊戲端 index.html...');
  let gameHtml = fs.readFileSync(INDEX_PATH, 'utf8');
  gameHtml = injectBundle(gameHtml, assetMap, key2path, 'game');
  fs.writeFileSync(OUTPUT_PATH, gameHtml, 'utf8');
  console.log('  ✓ index-bundle.html　', humanSize(fs.statSync(OUTPUT_PATH).size));

  /* ── 2. 後台 admin-bundle.html ── */
  if (fs.existsSync(ADMIN_PATH)) {
    console.log('▸ 打包後台 admin.html...');
    let adminHtml = fs.readFileSync(ADMIN_PATH, 'utf8');
    adminHtml = injectBundle(adminHtml, assetMap, key2path, 'admin');
    fs.writeFileSync(ADMIN_OUTPUT_PATH, adminHtml, 'utf8');
    console.log('  ✓ admin-bundle.html　', humanSize(fs.statSync(ADMIN_OUTPUT_PATH).size));
  } else {
    console.warn('!  找不到 admin.html，跳過後台打包');
  }

  console.log('');
  console.log('════════════════════════════════════════════');
  console.log(' 完成！產生兩個檔案：');
  console.log('   • index-bundle.html  ← 玩家玩的（素材已全內嵌，繞過 IndexedDB）');
  console.log('   • admin-bundle.html  ← 後台改劇情/上傳素材');
  console.log('════════════════════════════════════════════');
  console.log('');
  console.log('▸ iPad 最簡單玩法（不用 a-Shell、不用任何 App）：');
  console.log('  1. 先在電腦把全部素材放進 assets/ 資料夾，再雙擊 build-bundle.bat');
  console.log('  2. 把 index-bundle.html 傳到 iPad（iCloud Drive / USB / 寄信給自己）');
  console.log('  3. iPad「檔案」App → 長按 index-bundle.html → 共享 → 用 Safari 開');
  console.log('  4. iPad 連到 ESP32 的 tcts-lock 熱點（密碼 tcts1908）');
  console.log('  5. 首次按解鎖，iOS 跳「允許尋找本地網路裝置」→ 點允許 → 開玩');
  console.log('     （素材全在 HTML 裡，從記憶體直接供應，不需 IndexedDB，file:// 可直接跑）');
  console.log('');
  console.log('  ※ admin-bundle.html 是要改劇情/在 iPad 上傳圖時才用，');
  console.log('    那種情況才需要 a-Shell 起 localhost 讓兩檔同來源共用資料。');
  console.log('    純玩遊戲只要 index-bundle.html 直接開即可。');
}

main();
