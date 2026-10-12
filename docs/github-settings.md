# GitHub リポジトリの設定

GitHub の Settings 画面の設定はリポジトリのコードに残らないため、ここに記録しています。
CI やリリースの自動化はこの設定を前提に動いているので、リポジトリを作り直したり移したりした場合は、同じ内容を設定してください。

## Actions

**場所:** Settings → Actions → General → Workflow permissions

| 項目 | 設定 | 理由 |
|---|---|---|
| Workflow permissions | Read repository contents and packages permissions（既定値のまま） | 必要な権限は各ワークフローの `permissions:` で指定しているため |
| Allow GitHub Actions to create and approve pull requests | オン | release-please がリリース PR を作るために必要。オフだとリリース PR の作成に失敗する |

## Pull Requests

**場所:** Settings → General → Pull Requests

| 項目 | 設定 | 理由 |
|---|---|---|
| Allow merge commits | オフ | |
| Allow squash merging | オン | 1 PR を main の 1 コミットにするため |
| └ Default commit message | Pull request title | PR タイトルを main のコミットメッセージにするため。release-please はこれを読んでバージョンと CHANGELOG を決める |
| Allow rebase merging | オフ | |
| Automatically delete head branches | オン | マージした作業ブランチを自動で削除するため |

Default commit message を「Pull request title」にすると、コミットメッセージの本文は空になります。`Release-As:` などのフッターを使う場合は、マージ画面で本文に手で追加してください。

## Rules

**場所:** Settings → Rules → Rulesets → New ruleset → New branch ruleset

Public リポジトリ、または有料プランの Private リポジトリでのみ有効です（無料プランの Private リポジトリでは、作成しても適用されません）。

| 項目 | 設定 |
|---|---|
| Ruleset name | `main` |
| Enforcement status | Active |
| Target branches | Include default branch |
| Bypass list | Repository admin（**For pull requests only**） |
| Restrict deletions | オン |
| Block force pushes | オン |
| Require a pull request before merging | オン（Required approvals: 0、Allowed merge methods: Squash） |
| Require status checks to pass | オン（`build`、`pr-title`） |

- **ルールは管理者にも適用されます。** 管理者も main に直接 push できません。
- **Required approvals を 0 にしているのは**、1 人で開発していて、自分の PR は自分で承認できないためです。
- **ステータスチェックの名前**は、ワークフロー名（`Build`、`PR Title`）ではなくジョブ名（`build`、`pr-title`）です。一度も実行されていないチェックは候補に出ないため、先に PR を作って CI を動かしてから追加します。
- **Bypass list に Repository admin を入れているのは**、release-please のリリース PR では CI が動かず、そのままではマージできないためです（[開発フロー](development-flow.md#リリース-pr-では-ci-が動かない)を参照）。
  - 「Always allow」にすると main への直接 push も許可されてしまうため、必ず「For pull requests only」にします。

## 設定の確認

リポジトリのフォルダで次のコマンドを実行すると、今の設定を確認できます（[GitHub CLI](https://cli.github.com/) が必要です）。

`{owner}/{repo}` は、GitHub CLI が今のリポジトリに置き換えるので、そのまま入力して構いません。

マージ方法:

```bash
gh api 'repos/{owner}/{repo}' --jq '{allow_merge_commit, allow_squash_merge, allow_rebase_merge, squash_merge_commit_title, delete_branch_on_merge}'
```

Actions の権限（`can_approve_pull_request_reviews` が「Allow GitHub Actions to create and approve pull requests」）:

```bash
gh api 'repos/{owner}/{repo}/actions/permissions/workflow'
```

main に適用されているルール:

```bash
gh api 'repos/{owner}/{repo}/rules/branches/main' --jq '.[] | {type, parameters}'
```

Bypass list（`bypass_mode` が `pull_request` になっていること）は、ルールセットの ID を調べてから確認します。

```bash
gh api 'repos/{owner}/{repo}/rulesets' --jq '.[] | {id, name}'
```

```bash
gh api 'repos/{owner}/{repo}/rulesets/<ID>' --jq '{name, bypass_actors}'
```
