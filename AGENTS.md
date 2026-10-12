## プロジェクト概要

- **PotamAId**: Minecraft 1.21.1 / NeoForge 向けの Mod

バージョンなどの値は `gradle.properties` で一元管理しています。値を確認するときはこのファイルを参照してください。

## 必ず守るルール

以下の規約は `docs/` にあります。該当する作業の前に必ず読んで従ってください。

- [docs/commit-convention.md](docs/commit-convention.md): コミットメッセージ・PR タイトルの規約（Conventional Commits）
- [docs/development-flow.md](docs/development-flow.md): ブランチ運用・PR・リリースの流れ

特に重要な点:

- `main` に直接コミットしない。作業ブランチ（`<type>/<内容>`）を作成して作業する。
- コミットメッセージと PR タイトルは Conventional Commits の形式で、説明は日本語で書く。
- **以下は release-please が管理しているため、編集しない。**
  - `gradle.properties` の `mod_version`
  - `CHANGELOG.md`
  - `.release-please-manifest.json`
  - `v*` 形式の git タグ
- ユーザーから指示されない限り、コミット・push・PR 作成は行わない。

## ディレクトリ構成

| パス | 内容 |
|---|---|
| `src/main/java/io/github/bakutaku/potamaid/` | Mod の Java ソース |
| `src/main/resources/assets/potamaid/` | テクスチャ・モデル・翻訳などのクライアント用アセット |
| `src/main/resources/data/potamaid/` | レシピ・ルートテーブル・タグなどのデータ |
| `src/main/templates/` | ビルド時に `gradle.properties` の値で `${}` が置換されるテンプレート（`neoforge.mods.toml` など） |
| `src/generated/resources/` | データ生成（`runData`）の出力先。**手動で編集しない** |
| `docs/` | 開発ルールなどのドキュメント |
| `.github/workflows/` | CI（`build.yml`）とリリース自動化（`release-please.yml`） |
| `run/` | 開発用クライアント・サーバーの実行ディレクトリ（git 管理外） |

## よく使うコマンド

```bash
./gradlew build       # ビルドとチェック。作業の最後に必ず実行して成功を確認する
./gradlew runClient   # 開発用クライアントを起動
./gradlew runServer   # 開発用サーバーを起動
./gradlew runGameTestServer  # GameTest を実行して終了する
./gradlew runData     # データ生成（src/generated/resources に出力）
```

Windows の PowerShell / コマンドプロンプトでは `gradlew.bat` を使います。

`runClient` や `runServer` はゲームが起動したまま終了しないため、エージェントが動作確認に使う場合はユーザーに確認してから実行してください。

## コーディング規約

### 全般

- 既存コードの書き方（命名・構成・コメントの量）に合わせる。
- Mod ID は文字列で直接書かず、`PotamAId.MODID` を参照する。
- ログは `PotamAId.LOGGER`（SLF4J）を使い、`System.out` は使わない。
- 文字コードは UTF-8。

### NeoForge / Minecraft

- ブロック・アイテム・クリエイティブタブなどの登録は `DeferredRegister` を使う。レジストリに直接登録しない。
- **クライアント専用のコード（描画・画面・`net.minecraft.client` パッケージ）は、`PotamAIdClient` など `Dist.CLIENT` 限定のクラスにのみ書く。** 共通コードから参照すると、専用サーバーでクラッシュする。
- 名前は Mojang 公式マッピング（Parchment 付き）に従う。
- レシピ・ルートテーブル・タグ・モデルなどの JSON は、できるだけデータ生成（DataGenerator）で作る。生成物は `src/generated/resources/` に出力されるので、手動で編集しない。
- 翻訳キーを追加したら、`assets/potamaid/lang/en_us.json` に英語の訳を必ず追加する。日本語の訳（`ja_jp.json`）も追加する。
- 設定項目は `Config.java`（`ModConfigSpec`）に追加する。

### 互換性

- 一度リリースしたブロック・アイテムの ID や、設定項目の名前を変更・削除すると、既存のワールドや設定ファイルが壊れる。変更が必要な場合はユーザーに確認し、破壊的変更（`feat!:` など）として扱う。

## 作業の進め方

- 作業が終わったら `./gradlew build` を実行し、成功することを確認してから報告する。失敗した場合は、そのことを結果とともに報告する。
- 依存関係（Gradle プラグイン、NeoForge、ライブラリ）や GitHub Actions のバージョンを上げる場合は、ユーザーに確認してから行う。
- 作業内容の報告やドキュメントは日本語で書く。

## 参考リンク

- [NeoForge ドキュメント](https://docs.neoforged.net/)
- [ModDevGradle](https://github.com/neoforged/ModDevGradle)
- [Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/)
- [release-please](https://github.com/googleapis/release-please)
