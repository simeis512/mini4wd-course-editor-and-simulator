# 開発ルール

ブランチ名・コミットメッセージ・PR タイトルの書き方を揃えるためのルールです。
形式は [Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/) に合わせます。

## 種類（type）

| type | 使う場面 |
| --- | --- |
| `feat` | 機能の追加・変更（パーツ追加、表示の改善など） |
| `fix` | 不具合の修正 |
| `docs` | ドキュメントだけの変更 |
| `refactor` | 動きを変えないコードの整理 |
| `test` | テストの追加・修正だけ |
| `chore` | ビルド設定、依存関係、CI、リポジトリ設定など |

## 範囲（scope、任意）

変更の場所がはっきりしているときだけ付けます。

| scope | 対象 |
| --- | --- |
| `course` | パーツ定義・コース計算（`src/course`） |
| `editor` | エディタ画面・2D/3D 表示（`src/editor`） |
| `ar` | AR 表示 |
| `sim` | シミュレーター・物理演算（`src/physics` など） |
| `deps` | 依存パッケージ |

足りなければ増やしてかまいません。増やしたらこの表にも追記します。

## ブランチ名

```
<type>/<issue番号>-<短い英語の kebab-case>
```

- 例：`feat/6-wave-sideways`、`fix/41-loop-closure-angle`、`docs/branch-commit-rules`
- 対応する issue がなければ番号は省きます。
- 英小文字・数字・ハイフンだけを使い、3〜5 語程度に収めます。

## コミットメッセージ（英語）

```
<type>(<scope>): <summary>

<本文（任意）：なぜ変えたか>
```

- 例：`feat(course): make the wave swing sideways`、`fix(editor): keep picking working on raised pieces`
- summary は英語の命令形、小文字始まり、末尾にピリオドを付けず、72 文字以内。
- 互換性を壊す変更（URL 形式の変更など）は type の後ろに `!` を付け、本文に `BREAKING CHANGE:` を書きます。
- 1 コミット 1 目的を目安にします。

## PR タイトル（日本語）

```
<type>(<scope>): <日本語の要約>
```

- 例：`feat(course): ウェーブを横にうねる形にする`
- type と scope はコミットと同じ英語の語を使い、要約だけ日本語で書きます。
- PR 本文も日本語で書き、関連 issue は `Closes #番号` でつなぎます。
