# PotamAId

Minecraft 1.21.1 / NeoForge 向けの Mod です。

ゲーム内のチャットから Claude Code に指示して、開発中の mod をその場で変更・確認できる、**mod開発者向けの開発ツール**です。
AI が編集したコードは、ホットスワップと `/reload` で、ゲームを再起動せずに反映します。

> 現在開発中で、まだ機能は実装されていません。詳しい仕様は [docs/specification.md](docs/specification.md) を参照してください。

## 動作環境

| 項目 | バージョン |
|---|---|
| Minecraft | 1.21.1 |
| NeoForge | 21.1.259 以上 |
| Java | 21 |

## 導入方法

1. Minecraft 1.21.1 に NeoForge をインストールします。
2. [Releases](../../releases) から `potamaid-<バージョン>.jar` をダウンロードします。
3. `.minecraft/mods` フォルダに jar ファイルを入れて、ゲームを起動します。

## 開発

### 必要なもの

- JDK 21
- IntelliJ IDEA（推奨）

### セットアップ

IntelliJ IDEA で `mod/` フォルダを開くと、Gradle プロジェクトとして自動で読み込まれます。
読み込み時に Minecraft と NeoForge が自動でダウンロードされます。

クローンしたら、main への誤コミットを防ぐ Git フックを有効にしてください（[詳細](docs/development-flow.md#main-への誤コミット防止)）。

```bash
git config core.hooksPath .githooks
```

### よく使うコマンド

Gradle のコマンドは `mod/` ディレクトリで実行します。

```bash
./gradlew runClient   # 開発用クライアントを起動
./gradlew runServer   # 開発用サーバーを起動
./gradlew runData     # データ生成（mod/src/generated/resources に出力）
./gradlew build       # mod/build/libs に配布用 jar を作成
```

Windows では `./gradlew` を `gradlew.bat` に置き換えてください。

ライブラリが見つからないなど依存関係で問題が起きた場合は、`./gradlew --refresh-dependencies` でキャッシュを更新してください。

### マッピングについて

このプロジェクトでは、Minecraft のメソッド名・フィールド名に Mojang 公式のマッピングを使用しています。
これらの名前には Mojang 独自のライセンスが適用されます。最新のライセンス文は以下を参照してください。
https://github.com/NeoForged/NeoForm/blob/main/Mojang.md

## 参考リンク

- [NeoForge ドキュメント](https://docs.neoforged.net/)
- [NeoForged Discord](https://discord.neoforged.net/)

## ライセンス

[MIT License](LICENSE)
