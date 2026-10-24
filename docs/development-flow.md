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

### 初回リリースまでの例外

初回リリース（0.1.0）までに作る機能は、機能ごとにブランチを分けず、`feat/initial-release` ブランチにまとめて実装します。初回リリース後は、通常どおり機能追加・修正ごとにブランチを作成します。

- ブランチ内のコミットは、機能ごとに分けて [コミットメッセージ規約](commit-convention.md) の形式で書きます。
- Squash merge すると 1 つのコミットにまとまり、CHANGELOG には PR タイトルの 1 行しか載りません。機能ごとに CHANGELOG に載せるため、マージ時のコミット本文の末尾に、含まれる変更を Conventional Commits の形式で 1 行ずつ書きます。release-please はそれぞれを別の変更として扱います。

  ```
  feat: 初回リリースの機能を実装

  feat: プレイヤーのゲーム情報取得と確認コマンドを追加
  feat: ○○を追加
  ```

### main への誤コミット防止

GitHub 側では [Rules](github-settings.md#rules) で main への直接 push を禁止していますが、手元での `git commit` は止められません。
そのため、main でのコミットを止める pre-commit フックを `.githooks/` に用意しています。クローンしたら一度だけ次のコマンドを実行して有効にしてください。

```bash
git config core.hooksPath .githooks
```

有効にすると、main で `git commit` を実行したときにエラーになります。作業ブランチを作成してからコミットしてください。

## PR

1. 作業ブランチを push して、`main` に向けた PR を作成します。本文にはテンプレートが入るので、概要と動作確認を書き、チェックリストを確認します。
2. **PR タイトルを [コミットメッセージ規約](commit-convention.md) の形式にします。** Squash merge 後、これが main のコミットメッセージになります。
3. CI（Build ワークフローと PR Title ワークフロー）が成功していることを確認します。
   CI でビルドした jar は、Actions の実行結果ページの「Artifacts」からダウンロードできます（保存期間 7 日）。
4. **Squash and merge** でマージします。

## リリース

リリースは release-please で自動化しています。

- `feat:` や `fix:` などを含む変更が main にマージされると、release-please が `chore(main): release x.y.z` というタイトルの **リリース PR** を自動で作成します。その後のマージ内容も、同じリリース PR に追加されていきます。
- リリース PR には次の変更が含まれます。
  - `mod/gradle.properties` の `mod_version` の更新
  - `CHANGELOG.md` の更新
- **リリースしたいタイミングで、リリース PR をマージします。** マージすると次の処理が自動で行われます。
  1. `vX.Y.Z` のタグを作成
  2. GitHub Release を作成（本文は CHANGELOG の内容）
  3. Mod の jar をビルドして Release に添付

### リリース PR では CI が動かない

GitHub の仕様により、`GITHUB_TOKEN` で作成された PR（release-please のリリース PR）では、Build ワークフローと PR Title ワークフローが実行されません。
そのため、必須チェックが「Waiting for status to be reported」のままになり、通常の方法ではマージできません。

リリース PR の変更は `mod_version` と `CHANGELOG.md` だけで、jar はマージ後に Release Please ワークフローでビルドされるため、CI を省略してマージして構いません。
マージ画面で **「Merge without waiting for requirements to be met (bypass rules)」にチェックを入れて** マージしてください（Rules の Bypass list に入っている管理者のみ可能です）。

CI を動かしてからマージしたい場合は、リリース PR をいったん閉じて、もう一度開いてください。人の操作として扱われるため CI が実行されます。ただし、release-please がリリース PR を更新するたびに同じ操作が必要です。

### 手動で変更してはいけないもの

以下は release-please が管理しているため、手動で編集しないでください。

- `mod/gradle.properties` の `mod_version`
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

## GitHub リポジトリの設定

Actions の権限・マージ方法・Rules などの GitHub 側の設定は、[GitHub リポジトリの設定](github-settings.md) にまとめています。
