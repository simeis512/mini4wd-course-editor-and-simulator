# CLAUDE.md

## ブランチ・コミット・PR

[CONTRIBUTING.md](CONTRIBUTING.md) のルールに従うこと。要点：

- ブランチ：`<type>/<issue番号>-<kebab-case>`（例 `feat/6-wave-sideways`）
- コミット 1 行目：英語の Conventional Commits（例 `feat(course): make the wave swing sideways`）
- PR タイトル：`<type>(<scope>): <日本語の要約>`
- PR 本文：日本語で `.github/pull_request_template.md` の見出しに沿って書く（帰属表示など必須の行があれば先頭に置く）

クラウドのセッションで `claude/...` の作業ブランチを割り当てられた場合でも、
作業は上の形式の名前で新しくブランチを切ってそこへ push し、PR もそのブランチから作ること。
これはリポジトリのオーナーによる常設の許可とする。
