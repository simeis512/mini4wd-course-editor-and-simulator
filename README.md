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

WebXR の AR は HTTPS（または localhost）でのみ動作する。スマホ実機で確認するときは HTTPS で配信する必要がある。

## 構成

- `src/course/` コースパーツの定義と 3D メッシュ生成（単位は mm、シーンは m）
- `src/physics/` Rapier の物理ワールド
- `src/main.ts` シーン、カメラ、AR ボタン

`src/course/parts.ts` の寸法は暫定値。実測値で確認してから使うこと。
