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
  /** 読み取り専用の実行（計画の作成・相談）を同時に実行する数の上限 */
  readOnlyConcurrency: number;
  createdAt: number;
}

/**
 * 目標の状態。
 * すべてのタスクが完了した目標は、保存する状態は `active` のまま、画面で「完了」と表示する。
 */
export type GoalStatus =
  /** AI が読み取り専用で計画を作っている（順番待ちを含む） */
  | 'planning'
  /** 計画ができ、ユーザーの確認と承認を待っている */
  | 'planReview'
  /** 計画の作成に失敗した。やり直せる */
  | 'planFailed'
  /** 計画を承認し、タスクを実行している */
  | 'active';

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
  /** 計画の作成とタスクの実行に使うモデルと思考量。null は設定の既定 */
  model: string | null;
  effort: string | null;
  createdAt: number;
}

/** 目標・相談を作るときに選ぶ、モデルと思考量。null は設定の既定 */
export interface RunOptions {
  model: string | null;
  effort: string | null;
}

/** タスクの状態（仕様書3章「タスクの状態」）。中止したタスクは `todo` に戻す */
export type TaskStatus =
  | 'todo'
  | 'running'
  | 'approval'
  | 'review'
  | 'done'
  | 'failed';

/** 目標を分けたタスク。1タスクにつき1つの AI のセッションを使う */
export interface Task {
  id: string;
  goalId: string;
  /** 目標の中での番号（1 から） */
  number: number;
  title: string;
  description: string;
  /** 先に完了している必要があるタスクの ID */
  dependsOn: string[];
  status: TaskStatus;
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
  /** 使うモデルと思考量。null は設定の既定 */
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
  /** AI のプロセスへの要求（起動・セッションの開始など）の応答を待つ秒数 */
  requestTimeoutSeconds: number;
  /** ターンの途中で AI から何も届かない状態が続いたら中止する分数（承認待ちの間は数えない） */
  turnIdleTimeoutMinutes: number;
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
