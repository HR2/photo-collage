# フォトコラージュ (Web 版)

iPad アプリ版 (Swift) を JavaScript で組み直したものです。ビルド不要の静的サイトで、依存ライブラリはありません。

## 動かし方

ES モジュールと Web Worker を使うため、`index.html` を直接開くのではなく HTTP サーバー経由で開いてください。

```bash
python3 -m http.server 8765 --directory web
```

ブラウザで http://localhost:8765 を開きます。公開するときは `web/` フォルダをそのまま静的ホスティング (GitHub Pages、Netlify、Cloudflare Pages など) に置けば動きます。

「共有・写真に保存」ボタン (Web Share API) は HTTPS か localhost でのみ表示されます。

## 構成

```
src/
  main.js               起動
  util.js               DOM 生成・アイコンなどの小物
  model/
    geometry.js         セルの座標変換・トリミング計算・縁とタイトルの区画割り
    project.js          編集中の状態・取り消し・保存と再開
  layout/
    index.js            方式の一覧・トリミング量の評価
    justified.js        A 行揃え (動的計画法 + 局所探索)
    slicing.js          B 分割ツリー / C メリハリ (焼きなまし法)
    random.js           seed から再現できる乱数
    worker.js, client.js  レイアウト計算を Web Worker で実行
  services/
    images.js           写真の読み込みと縮小版の作成
    render.js           キャンバスへの描画 (画面表示と書き出しで共通)
    exporter.js         JPEG / PNG の書き出し
    store.js            IndexedDB への自動保存
  views/
    setup.js            出力サイズと写真の選択
    compare.js          A・B・C の見比べ
    editor.js           編集画面と設定パネル
    editorCanvas.js     編集キャンバスのジェスチャー
    common.js           画面遷移・ダイアログ・読み込み中表示
```

## Swift 版との違い

- 写真の読み込みは写真ピッカーの代わりにファイル選択とドラッグ＆ドロップ
- 保存先は IndexedDB (ブラウザごと)
- 出力サイズの上限は合計 16,777,216 ピクセル (iPad / iPhone の Safari がこれを超えるキャンバスを作れないため)
- マウス・トラックパッドでも操作できる: Ctrl+ホイール (トラックパッドのピンチ) で拡大縮小、ホイールで位置調整、⌘Z / ⇧⌘Z で取り消し・やり直し
