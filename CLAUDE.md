# CLAUDE.md

## コードの置き場所と実装の進め方

[CONTRIBUTING.md](CONTRIBUTING.md) の「コードの置き場所」「ファイルの分け方」「書き方の約束」「実装の進め方」に従うこと。要点：

- コースについての計算は `src/course` に純粋関数で書いてテストを付ける。`src/course` は DOM と `editor` に依存しない
- `src/editor` は状態と表示だけ。2D/3D 共通の機能は `EditorView` に足し、`app.ts` で 2D/3D を分岐しない
- 1 ファイル 500 行を超えたら分割を考え、800 行の前に分ける。移動だけのコミットと中身の変更は分ける
- 同じ処理を 2 か所に書かない
- 仮の値は名前付き定数にして `provisional` と出どころ（spec の節や issue）をコメントに書く
- `PART_CODES` と `variants` は末尾に追加するだけ。URL 形式を変えるなら `FORMAT_VERSION` を上げる
- `npm test` と `npm run build` を通し、画面の変更はブラウザで確かめてから PR を出す
- スクリーンショットは PR の本文やコメントに貼り、リポジトリには入れない

## ブランチ・コミット・PR

[CONTRIBUTING.md](CONTRIBUTING.md) のルールに従うこと。要点：

- ブランチ：`<type>/<issue番号>-<kebab-case>`（例 `feat/6-wave-sideways`）
- コミット 1 行目：英語の Conventional Commits（例 `feat(course): make the wave swing sideways`）
- PR タイトル：`<type>(<scope>): <日本語の要約>`
- PR 本文：日本語で `.github/pull_request_template.md` の見出しに沿って書く（帰属表示など必須の行があれば先頭に置く）

クラウドのセッションで `claude/...` の作業ブランチを割り当てられた場合でも、
作業は上の形式の名前で新しくブランチを切ってそこへ push し、PR もそのブランチから作ること。
これはリポジトリのオーナーによる常設の許可とする。
