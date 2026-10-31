# 更新履歴の断片

画面やコードを変える PR は、ここに `<PR番号>.md` を 1 つ置きます（#137）。main に merge されると
GitHub Actions がまとめて [`CHANGELOG.md`](../CHANGELOG.md) に書き、`package.json` の `version` を上げ、断片を消します。
PR ごとに別のファイルなので、並行する PR どうしで衝突しません。

```md
---
type: feat
---

- 追加：走行の視点に「追従（横）」を足しました
```

- `type`：`feat`（機能を足す・変える → `0.(x+1).0`）／`fix`（不具合を直す → `0.x.(y+1)`）／`none`（版を上げない）
  - `docs` / `test` / `chore` / `refactor` / `perf` だけの PR は `none`。本文は空でよい
  - 使う人が体感できる性能改善だけ、`none` のまま `- その他：パーツの追加が速くなりました` のように書く（いまの最新版に足されます）
- `url-format`：共有 URL の形式（`src/course/codec.ts` の `FORMAT_VERSION`）を変えたときだけ、新しい番号を書く。
  履歴に「形式を ○ にしました。古い URL もそのまま開けます……」の行が付きます
- 本文：1 行ずつ `- 追加：` `- 修正：` `- 変更：` `- その他：` で始め、使う人に向けた言葉で書く（PR 番号は自動で付きます）

PR 番号は PR を作ってから決まるので、PR を作ったあとにこのファイルを足してコミットします。
CI（`node scripts/changes.mjs check`）が、断片の書き忘れと `url-format` の書き忘れを止めます。
文書だけの PR（`src/`・`index.html`・`public/` を変えない PR）には要りません。
