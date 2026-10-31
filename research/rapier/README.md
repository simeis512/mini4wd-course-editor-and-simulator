# Rapier の実験（#125）

Rapier で再現できる物理現象を確かめる小さな実験。アプリには入れず、マージもしない。結果と判定は #125 にまとめてある。

```
npx vitest run research/rapier --silent=false
```

| ファイル | 項目 |
| --- | --- |
| `thrust.test.ts` | 1. スラスト角（回るローラー、コースでの走行、力で足す回避策） |
| `mass-damper.test.ts` | 2. マスダンパー、3. ボールリンクマスダンパー |
| `slide-damper.test.ts` | 4. スライドダンパー |
| `gears.test.ts` | 5. ギヤ、ジャイロ効果、回転の速さの上限 |
| `motor-position.test.ts` | 6. モーター位置 |
| `roller-forces.test.ts` | 7. ローラーにかかる力 |
| `tunnelling.test.ts` | A. 速いときにフェンスをすり抜けないか |
| `tyre-grip.test.ts` | B. タイヤ（レイキャスト）のグリップの出方 |
| `determinism.test.ts`, `determinism.html` | C. 同じ設定で同じ結果になるか（Node とブラウザ）。`npm run dev` で開いた `/research/rapier/determinism.html` を別の端末で見比べる |
| `cost.test.ts` | D. 部品や台数を増やしたときの計算時間 |
| `ray-tyres.test.ts` | E. タイヤが線であることの限界 |
| `sensitivity.test.ts` | F. 仮の値がラップタイムにどれだけ効くか |
| `soft-chassis.test.ts` | G. 空気抵抗、やわらかい物体でシャーシのたわみ |
| `flexible-fence.test.ts` | H. コースのフェンスのしなり |
| `climb.test.ts` | I. 傾いたフェンスをローラーが乗り越えるコースアウト |
| `speed-cap.test.ts` | J. Rapier の速さの上限（400 × lengthUnit m/s） |
| `roller-grip.ts`, `roller-grip.test.ts` | K. ローラーの軸方向の摩擦（細いエッジは食い込む、という通説）と乗り越え |
