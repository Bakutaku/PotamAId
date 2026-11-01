/**
 * AI プロバイダーの共通インターフェース（仕様書6章）。
 *
 * Bridge の本体はこのインターフェースだけを使い、Codex・Claude ごとの
 * プロトコルの違いは各プロバイダーの実装の中に閉じ込める。
 */
import type {
  Approval,
  ApprovalResponse,
  ProgressKind,
  ProviderId,
  ProviderStatus,
} from '../../shared/domain';

/**
 * AI に許可する操作の範囲。
 * - `readOnly`: 計画の作成と相談。ファイルを編集せず、承認で権限を広げない
 * - `workspaceWrite`: タスクの実行。作業ディレクトリの中を編集でき、それ以外は承認を求める
 */
export type AccessMode = 'readOnly' | 'workspaceWrite';

export interface SessionOptions {
  /** 作業ディレクトリ（対象modのリポジトリ） */
  cwd: string;
  access: AccessMode;
  /** セッション全体に与える指示（役割や守ること） */
  instructions?: string;
  /** 使うモデル。null ならプロバイダーの設定の既定（Bridge の設定の既定は呼び出し元で決める） */
  model?: string | null;
  /** 思考量（reasoning effort）。null ならモデルの既定 */
  effort?: string | null;
  /** セッションに接続する MCP サーバー（Bridge のツールなど） */
  mcpServers?: McpServerConfig[];
}

/** Streamable HTTP の MCP サーバーの接続先 */
export interface McpServerConfig {
  /** AI から見えるサーバーの名前 */
  name: string;
  url: string;
  /** 接続のたびに付けるヘッダー（認証のトークンなど） */
  headers: Record<string, string>;
}

export interface TurnInput {
  text: string;
  /** 最後の発言の形を JSON Schema で指定する（構造化出力） */
  outputSchema?: Record<string, unknown>;
}

/** プロバイダーから届く途中経過 */
export type AiEvent =
  /** 保存して一覧に出す途中経過 */
  | { type: 'progress'; kind: ProgressKind; text: string; detail?: string }
  /** 保存しない、いま行っていること（ボードのカードに出す） */
  | { type: 'activity'; text: string }
  /** AI の発言の途中までの文章（ストリーム表示用） */
  | { type: 'agentMessageDelta'; itemId: string; text: string };

/**
 * AI がユーザーの対応を求めている操作（許可・質問・MCP の入力フォームなど）。
 * Bridge が ID・対象mod・持ち主を付けて {@link Approval} にする。
 */
export type AiApprovalRequest = Omit<
  Approval,
  'id' | 'projectId' | 'owner' | 'createdAt'
>;

export interface TurnHandlers {
  onEvent(event: AiEvent): void;
  /**
   * 承認を求められたときに呼ばれる。ユーザーが回答するまで待つ Promise を返す。
   * ターンを中止したときは、プロバイダーが自分で取り消しを返す。
   */
  onApprovalRequest(request: AiApprovalRequest): Promise<ApprovalResponse>;
}

export interface TurnResult {
  status: 'completed' | 'interrupted' | 'failed';
  /** AI の最後の発言 */
  finalMessage: string | null;
  error: string | null;
}

export interface TurnHandle {
  /**
   * 入力の受け付けを確認したら true。確認できないまま終了したら false（応答喪失を含む）。
   * 遅くとも result と同時に解決する。省略時は runTurn が同期的に受け付ける。
   */
  readonly inputAccepted?: Promise<boolean>;
  /** ターンが終わると解決する。失敗しても reject せず、status で返す */
  readonly result: Promise<TurnResult>;
  /** ターンを中止する */
  cancel(): Promise<void>;
}

export interface AiSession {
  /** プロバイダーのセッション ID（Codex はスレッド ID）。保存して再開に使う */
  readonly sessionId: string;
  /** プロバイダーが実際に使うモデルと思考量（分からなければ undefined）。タスクに記録する */
  readonly model?: string | null;
  readonly effort?: string | null;
  runTurn(input: TurnInput, handlers: TurnHandlers): TurnHandle;
}

export interface AiProvider {
  readonly id: ProviderId;
  /** 画面に出す名前 */
  readonly displayName: string;
  /** ログインの状態などを確かめる */
  getStatus(): Promise<ProviderStatus>;
  startSession(options: SessionOptions): Promise<AiSession>;
  resumeSession(sessionId: string, options: SessionOptions): Promise<AiSession>;
  /** 子プロセスなどを止める。次に使うときに起動し直す */
  dispose(): Promise<void>;
}
