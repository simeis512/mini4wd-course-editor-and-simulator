# ミニ四駆コース作成シミュレーター

ジャパンカップジュニアサーキット（JCJC）のパーツを組み合わせて 3 レーンのコースを作り、3D や AR（WebXR）で確認できるようにする。
さらに、自分のマシンのカスタムを再現して物理演算でシミュレートできるようにする。

## 技術スタック

- TypeScript + Vite
- Three.js（3D 表示、WebXR による AR）
- Rapier（`@dimforge/rapier3d-compat`、物理演算）
- Vitest（テスト）

## 開発

```sh
npm install
npm run dev        # 開発サーバー（LAN 公開。スマホから AR 確認用）
npm test           # テスト
npm run build      # 型チェック + ビルド
```

WebXR の AR は HTTPS（または localhost）でのみ動作するため、開発サーバーは自己署名証明書の HTTPS で起動する。
スマホからは `npm run dev` の表示する Network の URL（`https://192.168.x.x:5173/` など、**https** で始まるもの）を開く。
初回は「この接続ではプライバシーが保護されません」などの警告が出るので、「詳細設定」→「アクセスする」で進む。
AR は Android の Chrome（ARCore 対応端末）で動く。iPhone の Safari は WebXR の AR に対応していない。

## 使い方（コースエディタ）

- 2D（上から見た図）で編集し、3D で立体表示を確認する。AR は 3D 表示の下のボタンから（対応端末のみ）
- オレンジの矢印（開いた口）をタップ → パーツを選ぶとつながる。続けて選ぶと先へ伸びていく
- ピースをタップして選択 → 色の変更、反転（カーブの左右切り替え）、削除。削除しても先のピースはその場に残る
- ドラッグで移動、ホイール／ピンチで拡大縮小。Ctrl+Z / Ctrl+Y、Delete、F（反転）も使える
- コースは URL（`#c=...`）に自動で保存される。「URLをコピー」で共有、JSON の書き出し／読み込みも可能
- 開いた口どうしが 10mm・3° 以内で向かい合うとループが閉じたとみなし、誤差を表示する

## 構成

- `src/course/catalog.ts` パーツカタログ（中心線の区間・接続口・色バリエーション、URL 用のパーツ番号表）。寸法は mm、多くは推定値
- `src/course/geometry.ts` 中心線のサンプリングと接続口のフレーム計算
- `src/course/course.ts` コース（連結グラフ）、配置計算、ループ閉じ判定、編集操作
- `src/course/codec.ts` コース ⇄ URL ハッシュ（バイナリ → deflate-raw → base64url）
- `src/course/mesh.ts` 3D メッシュ生成（路面＋フェンスの掃引。シーンは m 単位）
- `src/editor/` 2D 編集ビュー、3D/AR ビュー、画面
- `src/physics/` Rapier の物理ワールド（シミュレーター用、未接続）

仕様はプロジェクトの `specs/course-editor.md`（フェーズ1: ストレート・カーブ・ウェーブ）。
