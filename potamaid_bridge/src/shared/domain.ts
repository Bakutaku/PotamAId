/**
 * Bridge が扱うデータの型。
 *
 * main プロセス（Bridge の本体）と renderer（画面）の両方から使うため、
 * Node.js・Electron・React に依存するものはここに置かない。
 * 仕様は docs/specification.md の3章（目標・タスク・相談）と5章を参照。
 */

/** AI プロバイダーの ID。Claude は後で対応する */
export type ProviderId = 'codex' | 'claude';

/** 対象mod（AI が編集する mod のリポジトリ） */
export interface Project {
  id: string;
  /** 画面に出す名前（初期値はフォルダー名） */
  name: string;
  /** リポジトリのルートの絶対パス。AI の作業ディレクトリになる */
  rootPath: string;
  /** 読み取り専用の実行（計画の作成・調査タスク・相談）を同時に実行する数の上限 */
  readOnlyConcurrency: number;
  /** 編集タスクを同時に実行する数の上限（目標ごとの worktree で並行する。初期値は 1） */
  editConcurrency: number;
  /**
   * タスクの重さ → 使う実行の設定（プロファイル）の ID。
   * 指定のない重さは、目標の既定を使う（仕様書6章「実行の設定とモデルの選び方」）
   */
  weightProfiles: WeightProfiles;
  createdAt: number;
}

/** タスクの重さ → 実行の設定（プロファイル）の ID */
export type WeightProfiles = Partial<Record<TaskWeight, string>>;

/** 目標の状態（仕様書3章「目標の状態」） */
export type GoalStatus =
  /** AI が読み取り専用で計画を作っている（順番待ちを含む） */
  | 'planning'
  /** 計画ができ、ユーザーの確認と承認を待っている */
  | 'planReview'
  /** 計画の作成に失敗した。やり直せる */
  | 'planFailed'
  /** 計画を承認し、タスクを実行している。反映の前の競合の解消を含む */
  | 'active'
  /**
   * タスクがすべて完了し、ゲームを起動するディレクトリへの反映を待っている
   * （ほかの目標の確認中、コミットしていない変更がある、反映に失敗したなど）
   */
  | 'waiting'
  /**
   * タスクがすべて完了し、ユーザーが目標を確かめている（確認中）。
   * 修正の指示を実行している間もこの状態のまま
   */
  | 'review'
  /** ユーザーが目標の確認を済ませた */
  | 'done';

/** 目標（「○○を実装したい」という依頼） */
export interface Goal {
  id: string;
  projectId: string;
  /** 短い題名。最初は依頼文の冒頭で、計画ができたら AI が付けた題名にする */
  title: string;
  /** ユーザーが書いた依頼文 */
  text: string;
  status: GoalStatus;
  /** AI が計画に添えた要約 */
  planSummary: string | null;
  /** 計画の作成に失敗したときの理由 */
  planError: string | null;
  providerId: ProviderId;
  /**
   * 目標の既定の実行の設定。計画の作成と、重さに対応する実行の設定がないタスクに使う。
   * profileId がなければ model・effort（null は Bridge の設定の既定）
   */
  profileId: string | null;
  model: string | null;
  effort: string | null;
  /** 目標のブランチ（計画の承認で作る。完了後も undo のために残す） */
  branch: string | null;
  /** 分岐元のブランチ（承認したときに、ゲームを起動するディレクトリで使っていたブランチ） */
  baseBranch: string | null;
  /** 目標の worktree の場所。完了にして消したら null */
  worktreePath: string | null;
  /** worktree の中で AI の作業ディレクトリにする場所（対象modのフォルダーに当たる場所） */
  workDir: string | null;
  /** 反映待ちの理由 */
  waitReason: string | null;
  /**
   * いまの作業の区切りを始めた時刻（計画の承認と、確認中・完了の目標への新しい指示で更新する）。
   * 確認待ちになったときに、この区切りで再起動が必要になったタスクを求めるのに使う
   */
  roundStartedAt: number | null;
  createdAt: number;
}

/**
 * 目標・相談を作るときに選ぶ、実行の設定。
 * profileId を選べばその実行の設定を使い、なければ model・effort を使う（null は設定の既定）
 */
export interface RunOptions {
  profileId: string | null;
  model: string | null;
  effort: string | null;
}

/** 実行の設定（プロファイル）。プロバイダー・モデル・思考量の組に名前を付けたもの */
export interface ExecutionProfile {
  id: string;
  name: string;
  providerId: ProviderId;
  /** null はプロバイダーの既定 */
  model: string | null;
  effort: string | null;
}

/**
 * タスクの重さ（仕様書6章）。AI が計画のときに付け、使うモデルを決めるのに使う。
 * 値の名前は仮のもの
 */
export type TaskWeight = 'light' | 'standard' | 'heavy' | 'max';

/** 軽い順の重さ */
export const TASK_WEIGHTS: readonly TaskWeight[] = [
  'light',
  'standard',
  'heavy',
  'max',
];

/** 実行の設定をどこから決めたか（タスクの指定 → 重さ → 目標の既定 → Bridge の設定の既定） */
export type RunSource = 'task' | 'weight' | 'goal' | 'default';

/** タスクの実行に実際に使った設定とモデル（設定を変えたあとでも分かるように記録する） */
export interface TaskRunInfo {
  source: RunSource;
  /** 使った実行の設定。モデルを直接指定したときは null */
  profileId: string | null;
  /** 実行したときの実行の設定の名前 */
  profileName: string | null;
  providerId: ProviderId;
  /** プロバイダーが実際に使ったモデル（分からなければ指定したもの） */
  model: string | null;
  effort: string | null;
}

/** タスクの状態（仕様書3章「タスクの状態」）。中止したタスクは `todo` に戻す */
export type TaskStatus = 'todo' | 'running' | 'approval' | 'done' | 'failed';

/**
 * タスクの種類。
 * 編集タスクは対象modごとに1件ずつ、調査タスクは読み取り専用で並行して実行する
 */
export type TaskKind = 'edit' | 'investigate';

/** 目標を分けたタスク。1タスクにつき1つの AI のセッションを使う */
export interface Task {
  id: string;
  goalId: string;
  /** 目標の中での番号（1 から） */
  number: number;
  title: string;
  description: string;
  kind: TaskKind;
  /** タスクの重さ */
  weight: TaskWeight;
  /** タスクで直接指定した実行の設定。null なら重さで決める */
  profileId: string | null;
  /** 最後の実行で実際に使った設定とモデル。まだ実行していなければ null */
  runInfo: TaskRunInfo | null;
  /** 先に完了している必要があるタスクの ID */
  dependsOn: string[];
  status: TaskStatus;
  /** 中止後、ユーザーが再開するまで自動実行を止める（Bridge の再起動後も保持する） */
  paused: boolean;
  /** 最新の途中経過の冒頭（ボードのカードに出す） */
  latest: string | null;
  /** AI が報告した結果の要約 */
  result: string | null;
  /** 反映にゲームの再起動が必要だと AI が報告したか */
  needsGameRestart: boolean;
  /** 失敗したときの理由 */
  error: string | null;
  /** まだ AI に渡していない追加の指示の数 */
  pendingInstructions: number;
  startedAt: number | null;
  finishedAt: number | null;
}

/** 相談の状態 */
export type ConsultStatus = 'idle' | 'queued' | 'running' | 'failed';

/** 相談（実装を伴わない質問・調べもの）。会話履歴を引き継いでやり取りする */
export interface Consult {
  id: string;
  projectId: string;
  title: string;
  providerId: ProviderId;
  /** 使う実行の設定。profileId がなければ model・effort（null は設定の既定） */
  profileId: string | null;
  model: string | null;
  effort: string | null;
  status: ConsultStatus;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 途中経過を持つもの。目標の途中経過は計画づくりの経過 */
export type ProgressOwnerType = 'goal' | 'task' | 'consult';

export interface ProgressOwner {
  type: ProgressOwnerType;
  id: string;
}

/** 途中経過の種類 */
export type ProgressKind =
  /** ユーザーの指示 */
  | 'user'
  /** AI の発言 */
  | 'agent'
  /** 推論の要約 */
  | 'reasoning'
  /** コマンドの実行 */
  | 'command'
  /** ファイルの変更 */
  | 'fileChange'
  /** MCP のツールの呼び出し */
  | 'mcp'
  /** Web 検索 */
  | 'webSearch'
  /** Bridge からのお知らせ（中止・中断など） */
  | 'system'
  | 'error';

/** 途中経過の1件。`seq` は Bridge 全体の連番 */
export interface ProgressEvent {
  seq: number;
  ownerType: ProgressOwnerType;
  ownerId: string;
  kind: ProgressKind;
  /** 一覧に出す1行の説明 */
  text: string;
  /** コマンドの出力や差分など、詳しい内容 */
  detail: string | null;
  createdAt: number;
}

/**
 * 承認待ちの種類。
 * AI からの質問と MCP の入力要求も、ユーザーの対応を待って止まるものとして承認待ちにまとめる。
 */
export type ApprovalKind =
  /** コマンドの実行の許可 */
  | 'command'
  /** ファイルの変更の許可 */
  | 'fileChange'
  /** AI からの質問（選択肢か自由な回答） */
  | 'question'
  /** MCP サーバーからの入力フォーム */
  | 'form'
  /** MCP サーバーからの、URL を開いて操作してほしいという要求 */
  | 'url';

/** AI からの質問の1問 */
export interface ApprovalQuestion {
  id: string;
  /** 短い見出し */
  header: string;
  question: string;
  /** 選択肢。空なら自由に回答する */
  options: { label: string; description: string }[];
  /** 選択肢のほかに、自由な回答もできるか */
  allowOther: boolean;
  /** パスワードなど、画面にも途中経過にも残さない回答か */
  secret: boolean;
}

/** MCP の入力フォームの1項目 */
export interface FormField {
  name: string;
  title: string;
  description: string | null;
  kind: 'text' | 'number' | 'integer' | 'boolean' | 'select' | 'multiSelect';
  required: boolean;
  /** select・multiSelect の選択肢 */
  options: { value: string; label: string }[];
  defaultValue: string | number | boolean | string[] | null;
}

/** AI がユーザーの対応を待っている操作 */
export interface Approval {
  id: string;
  projectId: string;
  /** 承認を求めているタスク・相談・計画づくり */
  owner: ProgressOwner;
  kind: ApprovalKind;
  /** 実行しようとしているコマンド */
  command: string | null;
  cwd: string | null;
  /** AI が示した理由 */
  reason: string | null;
  /** 変更しようとしているファイル */
  files: string[];
  /** 要求した MCP サーバーの名前（form・url） */
  source: string | null;
  /** ユーザーへの説明（form・url） */
  message: string | null;
  /** AI からの質問（question） */
  questions: ApprovalQuestion[];
  /** 入力フォームの項目（form） */
  fields: FormField[];
  /** 開いてほしい URL（url） */
  url: string | null;
  createdAt: number;
}

/** 承認への回答の種類 */
export type ApprovalDecision = 'allow' | 'allowForSession' | 'deny';

/** 承認への回答。質問とフォームでは、許可（allow）に回答の内容を添える */
export interface ApprovalResponse {
  decision: ApprovalDecision;
  /** 質問の ID → 回答（選んだ選択肢、または自由な回答） */
  answers?: Record<string, string[]>;
  /** フォームの項目名 → 入力した値 */
  values?: Record<string, string | number | boolean | string[]>;
}

/** テーマ。`null` は OS の設定に合わせる */
export type ThemeName = 'potamaid-light' | 'potamaid-dark';

/** Bridge 全体の設定 */
export interface Settings {
  theme: ThemeName | null;
  /** Codex の実行ファイルのパス。空なら PATH の `codex` を使う */
  codexPath: string;
  /** Codex のモデルの既定。空なら Codex の設定に従う */
  codexModel: string;
  /** Codex の思考量（reasoning effort）の既定。空ならモデルの既定に従う */
  codexEffort: string;
  /** 登録した実行の設定（プロファイル） */
  profiles: ExecutionProfile[];
  /** 既定の実行の設定。null なら codexModel・codexEffort を使う */
  defaultProfileId: string | null;
  /** AI のプロセスへの要求（起動・セッションの開始など）の応答を待つ秒数 */
  requestTimeoutSeconds: number;
  /** ターンの途中で AI から何も届かない状態が続いたら中止する分数（承認待ちの間は数えない） */
  turnIdleTimeoutMinutes: number;
  /** ユーザーの対応が必要になったときに、デスクトップ通知を出すか */
  desktopNotifications: boolean;
}

/** プロバイダーの準備の状態 */
export type ProviderState =
  | 'checking'
  | 'ready'
  | 'notLoggedIn'
  | 'unavailable'
  | 'notSupported';

export interface ProviderStatus {
  id: ProviderId;
  /** 画面に出す名前（Claude は「Claude」と表示する） */
  displayName: string;
  state: ProviderState;
  /** 画面に出す説明（ログインの種類や、使えない理由と案内） */
  message: string;
  /** 選べるモデル。取得できなければ空 */
  models: ModelOption[];
}

/** 選べるモデル */
export interface ModelOption {
  id: string;
  displayName: string;
  description: string;
  /** プロバイダーの既定のモデルか */
  isDefault: boolean;
  /** 選べる思考量 */
  efforts: { id: string; description: string }[];
  defaultEffort: string | null;
}
