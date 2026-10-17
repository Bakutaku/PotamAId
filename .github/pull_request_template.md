## 概要

<!-- 何を・なぜ変更したかを書いてください。関連する Issue があれば「Closes #123」のように書くと、マージ時に自動で閉じられます。 -->

## 動作確認

<!-- 確認した方法を書いてください（例: runClient でブロックを設置できることを確認、GameTest を追加）。 -->

## チェックリスト

- [ ] PR タイトルが [Conventional Commits の形式](https://github.com/Bakutaku/PotamAId/blob/main/docs/commit-convention.md)になっている
- [ ] `./gradlew build` が成功する
- [ ] 翻訳キーを追加した場合、`en_us.json` と `ja_jp.json` の両方に追加した
- [ ] データ生成の対象を変更した場合、`./gradlew runData` を実行して生成物をコミットした
- [ ] クライアント専用のコード（`net.minecraft.client` など）を、共通のコードから参照していない
- [ ] リリース済みのブロック・アイテムの ID や設定項目の名前を変更・削除していない（する場合は `feat!:` にする）
