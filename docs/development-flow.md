# 開発フロー

## 全体の流れ

```
作業ブランチで開発
   ↓ PR を作成（CI でビルドを確認）
main に Squash merge
   ↓ release-please が「リリース PR」を自動で作成・更新
リリース PR をマージ
   ↓ タグ（v0.2.0 など）と GitHub Release が自動で作成され、jar が添付される
```

## ブランチ

| ブランチ | 役割 |
|---|---|
| `main` | 次のリリースに含まれる内容。常にビルドが通る状態を保つ |
| 作業ブランチ | 機能追加・修正ごとに `main` から作成する |

- `main` に直接コミット・push しないでください。必ず PR を通します。
- 作業ブランチの名前は `<type>/<内容>` の形にします。type は [コミットメッセージ規約](commit-convention.md) と同じものを使います。
  - 例: `feat/river-spawn`, `fix/config-loading`, `docs/readme-install`
- 作業が終わってマージした作業ブランチは削除します。

## PR

1. 作業ブランチを push して、`main` に向けた PR を作成します。
2. **PR タイトルを [コミットメッセージ規約](commit-convention.md) の形式にします。** Squash merge 後、これが main のコミットメッセージになります。
3. CI（Build ワークフロー）が成功していることを確認します。
   CI でビルドした jar は、Actions の実行結果ページの「Artifacts」からダウンロードできます（保存期間 7 日）。
4. **Squash and merge** でマージします。

## リリース

リリースは release-please で自動化しています。

- `feat:` や `fix:` などを含む変更が main にマージされると、release-please が `chore(main): release x.y.z` というタイトルの **リリース PR** を自動で作成します。その後のマージ内容も、同じリリース PR に追加されていきます。
- リリース PR には次の変更が含まれます。
  - `gradle.properties` の `mod_version` の更新
  - `CHANGELOG.md` の更新
- **リリースしたいタイミングで、リリース PR をマージします。** マージすると次の処理が自動で行われます。
  1. `vX.Y.Z` のタグを作成
  2. GitHub Release を作成（本文は CHANGELOG の内容）
  3. Mod の jar をビルドして Release に添付

### 手動で変更してはいけないもの

以下は release-please が管理しているため、手動で編集しないでください。

- `gradle.properties` の `mod_version`
- `CHANGELOG.md`
- `.release-please-manifest.json`
- `v*` 形式の git タグ

### バージョンの決まり方

[Semantic Versioning](https://semver.org/lang/ja/) に従い、コミットの type から自動で決まります。

| 含まれる変更 | 0.x の間 | 1.0.0 以降 |
|---|---|---|
| `fix:` / `perf:` のみ | パッチ（0.1.0 → 0.1.1） | パッチ（1.0.0 → 1.0.1） |
| `feat:` を含む | マイナー（0.1.0 → 0.2.0） | マイナー（1.0.0 → 1.1.0） |
| 破壊的変更（`!`）を含む | マイナー（0.1.0 → 0.2.0） | メジャー（1.0.0 → 2.0.0） |

最初のリリースは 0.1.0 です。

### 特定のバージョンでリリースしたい場合

1.0.0 に上げる場合など、自動で決まる番号と違うバージョンにしたいときは、コミットのフッターに `Release-As:` を書きます。

```
chore: 1.0.0 としてリリース

Release-As: 1.0.0
```

### jar の添付に失敗した場合

GitHub Release の作成後に jar のビルドや添付が失敗した場合は、次のどちらかの方法で再試行します。

- **失敗したジョブだけを再実行する**: Actions の実行結果ページで「Re-run failed jobs」を選びます。`upload-jar` ジョブだけが再実行されます（「Re-run all jobs」ではリリースが作成済みと判定されず、jar の添付がスキップされます）。
- **タグを指定して手動実行する**: Actions → Release Please → 「Run workflow」で、`tag` に対象のリリースタグ（例: `v0.1.0`）を入力して実行します。そのタグのコミットから jar をビルドし、対応する GitHub Release に添付します。同名の jar が添付済みの場合は上書きします。

## GitHub リポジトリの初期設定

リポジトリを GitHub に作成したら、以下を設定してください。

- **Settings → Actions → General → Workflow permissions**
  - 「Allow GitHub Actions to create and approve pull requests」にチェックを入れる（release-please がリリース PR を作るために必要）
- **Settings → General → Pull Requests**
  - 「Allow squash merging」のみ有効にする
  - Default commit message を「Pull request title」にする
  - 「Automatically delete head branches」を有効にする
- **Settings → Rules（Public リポジトリ、または有料プランの場合）**
  - `main` への直接 push を禁止し、PR と Build ワークフローの成功を必須にする

### 注意: リリース PR では CI が動かない

GitHub の仕様により、`GITHUB_TOKEN` で作成された PR（release-please のリリース PR）では、Build ワークフローが自動で実行されません。
リリース PR の変更はバージョン番号と CHANGELOG だけなので通常は問題ありませんが、main を Rules で保護して「CI の成功」を必須にしている場合は、リリース PR がマージできなくなります。その場合は、ルールの設定を調整するか、release-please に Personal Access Token や GitHub App のトークンを渡す設定に変更してください。
