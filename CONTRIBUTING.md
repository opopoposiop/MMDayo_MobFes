# 開発・保守

## 検証

Node.jsが利用できる環境で、リポジトリ直下から次を実行してください。

```sh
node generate_mob_fes_penlight.mjs
node generate_mob_fes_penlight.mjs --optimized
node generate_mob_fes_penlight.mjs --billboard
node validate_mob_fes_penlight.mjs
```

検証コードの `VALID` は、PMX・fxdayo・ソース上の構造整合性を示します。MikuMikuDayo上の表示品質、GPU負荷、レイトレーシング結果を自動的に保証するものではありません。

## コメントと変更理由

- コードの実装手順には `HOW:` を使用します。
- テストの契約には `What:` を使用します。
- 採用しなかった単純な案や制約には、必要に応じて `Why not:` を使用します。
- コミットメッセージでは、変更理由を明確にします。

PMXの頂点数、モーフ順、fxdayoの定数は相互に依存します。成果物を変更した場合は、対応するPMX・fxdayo・生成コード・検証コードを同時に確認してください。
