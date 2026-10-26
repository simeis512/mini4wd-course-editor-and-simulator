# カタログを使った追加調査（Issue #30）

調査日：2026-10-25（日本時間）。[調査全体・単位・クラスの定義](machine-parts.md)に従う。前回48行だったストック基礎データに56行を追加して104行とした。加工後のオープン向け実測は引き続き別ファイルの1行。適合関係7行とカタログ出典台帳6行は、部品の行数には含めない。

## 参照したカタログと採用範囲

ユーザー提供の[公式ダウンロードページ](https://www.tamiya.com/japan/customer/downloads/mini4wd/index.html)から、ラインアップ・グレードアップパーツ・マッチングリストを探した。版・URL・読取状況は [sources.csv](machine-parts/sources.csv) に保存した。

| 資料 | 確認できた範囲・使い方 |
| --- | --- |
| [ラインアップ・2025年10月版](https://d7z22c0gz59ng.cloudfront.net/cms/img/usr/inst/pdf/mini4wd/adv/lineup2510_v1.pdf) | 本文の一部のみ取得でき、構成品の寸法根拠には採用していない |
| [一覧ページの最新パーツカタログリンク](https://d7z22c0gz59ng.cloudfront.net/cms/img/usr/inst/pdf/mini4wd/parts/parts2512_v1.pdf) | 一覧の表示は「2025年10月版」、リンク先ファイル名は `parts2512_v1.pdf`。図表は今回の取得方法では判読できず、実際の版や数値を推定していない |
| [マッチングリスト・2025年12月版](https://d7z22c0gz59ng.cloudfront.net/cms/japan/mini4wd/mini4_regulation/parts_matching_2512_v01.pdf) | 図表を判読できず、適合の各セルは未採用 |
| [パーツカタログ・2025年6月版](https://d7z22c0gz59ng.cloudfront.net/cms/img/usr/inst/pdf/mini4wd/parts/parts2506_v3.pdf) | 本文を取得。ローラー・マスダンパー・ギヤ・足回り等の追加調査の索引にした |
| [マッチングリスト・2025年6月版](https://d7z22c0gz59ng.cloudfront.net/cms/japan/mini4wd/mini4_regulation/parts_matching_2506_v2.pdf) | 品番・製品名・注記を確認。表の列見出しや記号の位置がテキスト化で崩れるため、各セルの自動転記はしていない |

寸法・重量の採用根拠は、各CSV行の `source_url` にある公式製品ページ。追加行の `discovery_source_id` は調査の手掛かりにしたカタログ台帳への参照であり、そのPDFから行内の全数値を読み取ったという意味ではない。製品説明文・写真・PDF図版は転載せず、確認した仕様値と出典を整理した。

## 追加できた値

| 分類 | 追加行数 | 主な追加情報・公式出典 |
| --- | ---: | --- |
| マスダンパー | 7 | [15427](https://www.tamiya.com/japan/products/15427/index.html) 6×6×32mm・8.3g、[15515](https://www.tamiya.com/japan/products/15515/index.html) 6×6×14mm・約3.6g、[15517](https://www.tamiya.com/japan/products/15517/index.html) 8×8×14mm・6.6g、[15501](https://www.tamiya.com/japan/products/15501/index.html) 径7mm×5.5/11.5mm・1.5/3g、[15490](https://www.tamiya.com/japan/products/15490/index.html) / [15478](https://www.tamiya.com/japan/products/15478/index.html) のウエイト各8.3g |
| ギヤ | 13 | [15355](https://www.tamiya.com/japan/products/15355/index.html) の4:1、[15236](https://www.tamiya.com/japan/products/15236/index.html) の4:1/4.2:1、[15456](https://www.tamiya.com/japan/products/15456/index.html) / [15516](https://www.tamiya.com/japan/products/15516/index.html) の3.5/3.7/4/4.2/5:1。15516はカウンター・スパーの色の組合せも記録 |
| タイヤ・ホイール | 2 | [15545](https://www.tamiya.com/japan/products/15545/index.html) の26mmハード、[15546](https://www.tamiya.com/japan/products/15546/index.html) の31mmローフリクション・バレル |
| ローラー | 10 | [15344](https://www.tamiya.com/japan/products/15344/index.html) 径9×厚3mm、[15345](https://www.tamiya.com/japan/products/15345/index.html) 径11×厚4mm、[15475](https://www.tamiya.com/japan/products/15475/index.html) 外径13×内径5×厚3mm。17mm、9/8mm、樹脂製2段、プラリング付きも追加 |
| ステー・プレート | 7 | [15193](https://www.tamiya.com/japan/products/15193/index.html) 91×7mm、[15524](https://www.tamiya.com/japan/products/15524/index.html) / [15498](https://www.tamiya.com/japan/products/15498/index.html) / [15499](https://www.tamiya.com/japan/products/15499/index.html) の厚み1.5mm。各製品が明示する対応ローラー径も記録 |
| 車軸 | 4 | [15440](https://www.tamiya.com/japan/products/15440/index.html) / [15416](https://www.tamiya.com/japan/products/15416/index.html) の60mm、[15297](https://www.tamiya.com/japan/products/15297/index.html) / [15417](https://www.tamiya.com/japan/products/15417/index.html) の72mm。中空ステンレスと強化スチールを区別 |
| 軸受け | 3 | [15111](https://www.tamiya.com/japan/products/15111/index.html) 外径6×内径2mm、[15523](https://www.tamiya.com/japan/products/15523/index.html) のPOM製620（6×2mm）/520（5×2mm） |
| スペーサー | 10 | [15473](https://www.tamiya.com/japan/products/15473/index.html) アルミと[15506](https://www.tamiya.com/japan/products/15506/index.html) 樹脂。それぞれ長さ1.5 / 3 / 6 / 6.7 / 12mm |

ウエイト質量は1個当たりで、同梱ビス・ナット・プレートを含む完成機構の重量ではない。同じ8.3gのウエイトでも、15427単品、15490のサイド機構、15478のボールリンク機構は取付方法・動きが異なる。総重量だけで同じ制振効果と扱わない。

ローラーの径・厚みと、マシン上の取付高さは別の値。例えば径13mmのボールベアリング15475の内径5mmを、取付ビスの径として使わない。ブッシュ等を介した取付けを確認する。15532の520ベアリングは追加できる別売部品で、標準装着とは記録していない。

車軸長60/72mmはトレッド幅ではない。ホイールの幅・オフセット・差込み量が必要。中空軸の「標準より軽い」という相対説明から、絶対重量や回転慣性を算出していない。

### 追加・拡張した列

- `gears.csv` に `id` を追加。比率ごとのレコードを識別し、`item_no` は製品番号として保持する。`counter_gear_colour` / `spur_gear_colour` は15516の公表組合せのみ。色から未掲載のギヤを互換と推定しない。
- `dampers.csv` に `diameter_mm` と `weight_mass_approximate` を追加。スリム型の径と軸方向長さは `diameter_mm` / `height_mm`。搭載姿勢や路面からの高さではない。約3.6gの15515は概数フラグを付けた。
- `rollers.csv` に `bore_diameter_mm`、`thickness_mm`、`ring_material` を追加。厚みは確認できたベアリング本体の値のみ。上下2段全体の高さを示すとは限らない。
- `stays.csv` の `supported_roller_diameters_mm` は明示された径の一覧で、未掲載径の装着不能を断定しない。`hole_pitch_mm` や重量は未確定。
- `bearings.csv` の `type` でボールベアリングと滑り軸受けを区別。`spacers.csv` の長さは部品長で、最終的なローラー中心高さやブレーキ地上高とは区別する。

## 適合を条件付きで管理する

[fitment.csv](machine-parts/fitment.csv) に7件を記録した。`compatible` は記載条件下での装着適合、`conditional` は追加条件付き、`incompatible` は明示的な不適合。車検の適法性を確定する列ではない。

| 組合せ | 確認した条件 |
| --- | --- |
| 15543 × FM-A | [口紙の訂正](https://www.tamiya.com/japan/customer/info/2025/0609/index.html)で装着不可。似た製品名の15545はFM-Aを使用可能シャーシに含むため、品番を分ける |
| 15111 × PROカウンターギヤ | [公式製品説明](https://www.tamiya.com/japan/products/15111/index.html)で使用不可。車軸用途での適合と混同しない |
| 15523 × PROカウンターギヤ | [520形状](https://www.tamiya.com/japan/products/15523/index.html)を使用。620形状との一括適合にしない |
| 15478 × MA/AR | [無加工取付けが明記](https://www.tamiya.com/japan/products/15478/index.html)される純正の可動機構。可動するという理由だけでオープン専用にしない |
| 15478 / 15427 × 指定の他シャーシ | 製品ページの指定どおり[15430](https://www.tamiya.com/japan/products/15430/index.html)を併用。出典が指定するシャーシ一覧をCSVに記録 |

マッチングリストの注記は、タイヤ・ホイールとの組合せ、ピニオンのみ使用可能、別売部品との併用、シャーシ切削、皿穴加工などを区別している。したがって表の丸印だけをストック適合と解釈できない。今回読み取れた注記の定義を使い、**どのセルにその注記が付くかを読めない組合せには割り当てていない**。

また、2025年6月版のパーツ本文は15492をホワイトとする一方、マッチングリストの名称欄には旧レッド表記が残る。[現行15492](https://www.tamiya.com/japan/products/15492/index.html)の2023年1月の仕様変更と照合し、現行のレコードをレッドに戻していない。一覧・カタログの名称だけで材質を上書きしない。

## ストックとオープンの分離

今回追加したものは純正の未加工製品・構成の基礎データ。加工が必要な取付けまでストック用として保証するものではない。カタログの適合注記にシャーシ切削が必要とある組合せは、装着可でもストックでは採用できない場合がある。一方、公式に認められるボディ干渉部のカットや既存穴の皿穴加工等を一律にオープンへ移すこともしない。

カタログから、ペラタイヤの加工後径・重量、フレキのばね定数、加工バンパーの動特性は得られなかった。これらは [open/modified-tyres.csv](machine-parts/open/modified-tyres.csv) などで個体ごとに測定・集計する。純正の24mm・26mmタイヤや、純正ボールリンク機構の仕様値を加工後の代表値として複写していない。

## まだ必要なデータ

カタログと製品ページの追加照合でも、裸のホイール径、タイヤ幅、部品の多くの絶対重量、取付穴の座標・ピッチ、モーターの無負荷回転数・停止トルク、電池の負荷電圧、摩擦・反発係数は確定していない。

今回追加した部品長・厚みは、将来の部品配置と高さ計算の入力に使える。ただし実機の取付座標や物理係数には変換せず、未確認欄は空欄のまま保存した。CSVの形式・識別子・単位・出典参照を検証し、走行モデルへの反映は別途行う。
