/**
 * AI からの質問（item/tool/requestUserInput）と、MCP サーバーの入力要求
 * （mcpServer/elicitation/request）を、Bridge の承認待ちの形に変換する。
 */
import type { ApprovalResponse, FormField } from '../../../shared/domain';
import type { AiApprovalRequest } from '../AiProvider';
import type { McpServerElicitationRequestParams } from './protocol/v2/McpServerElicitationRequestParams';
import type { McpServerElicitationRequestResponse } from './protocol/v2/McpServerElicitationRequestResponse';
import type { ToolRequestUserInputParams } from './protocol/v2/ToolRequestUserInputParams';
import type { ToolRequestUserInputResponse } from './protocol/v2/ToolRequestUserInputResponse';

/** 承認待ちの、許可などに使わない項目の初期値 */
const EMPTY_REQUEST = {
  command: null,
  cwd: null,
  reason: null,
  files: [],
  source: null,
  message: null,
  questions: [],
  fields: [],
  url: null,
} satisfies Omit<AiApprovalRequest, 'kind'>;

// ---- AI からの質問 ----

export function toQuestionRequest(
  params: ToolRequestUserInputParams,
): AiApprovalRequest {
  return {
    ...EMPTY_REQUEST,
    kind: 'question',
    questions: params.questions.map((q) => ({
      id: q.id,
      header: q.header,
      question: q.question,
      options: q.options ?? [],
      allowOther: q.isOther || !q.options || q.options.length === 0,
      secret: q.isSecret,
    })),
  };
}

/** 回答しなかったときは、空の回答を返す */
export function toQuestionResponse(
  response: ApprovalResponse,
): ToolRequestUserInputResponse {
  if (response.decision === 'deny' || !response.answers) {
    return { answers: {} };
  }
  return {
    answers: Object.fromEntries(
      Object.entries(response.answers).map(([id, answers]) => [
        id,
        { answers },
      ]),
    ),
  };
}

// ---- MCP の入力要求 ----

export function toElicitationRequest(
  params: McpServerElicitationRequestParams,
): AiApprovalRequest {
  const base = {
    ...EMPTY_REQUEST,
    source: params.serverName,
    message: params.message,
  };
  if (params.mode === 'url') {
    return { ...base, kind: 'url', url: params.url };
  }
  return {
    ...base,
    kind: 'form',
    fields: schemaToFields(params.requestedSchema),
  };
}

export function toElicitationResponse(
  response: ApprovalResponse,
): McpServerElicitationRequestResponse {
  if (response.decision === 'deny') {
    return { action: 'decline', content: null, _meta: null };
  }
  return { action: 'accept', content: response.values ?? {}, _meta: null };
}

/**
 * MCP の入力フォームの JSON Schema（object の properties）を、画面の入力項目にする。
 * 形式の違う schema（openai/form など）も、読める範囲で読む。
 */
export function schemaToFields(schema: unknown): FormField[] {
  if (!isRecord(schema) || !isRecord(schema.properties)) {
    return [];
  }
  const required = Array.isArray(schema.required)
    ? schema.required.filter((r): r is string => typeof r === 'string')
    : [];
  return Object.entries(schema.properties).flatMap(([name, prop]) =>
    isRecord(prop) ? [toField(name, prop, required.includes(name))] : [],
  );
}

function toField(
  name: string,
  prop: Record<string, unknown>,
  required: boolean,
): FormField {
  const base = {
    name,
    title: typeof prop.title === 'string' ? prop.title : name,
    description: typeof prop.description === 'string' ? prop.description : null,
    required,
  };

  // 単一選択: enum（enumNames があれば表示名に使う）か oneOf の const
  const single = enumOptions(prop);
  if (single) {
    return {
      ...base,
      kind: 'select',
      options: single,
      defaultValue: typeof prop.default === 'string' ? prop.default : null,
    };
  }
  // 複数選択: items が enum か anyOf の const
  if (prop.type === 'array' && isRecord(prop.items)) {
    return {
      ...base,
      kind: 'multiSelect',
      options: enumOptions(prop.items) ?? [],
      defaultValue: Array.isArray(prop.default)
        ? prop.default.filter((d): d is string => typeof d === 'string')
        : [],
    };
  }
  switch (prop.type) {
    case 'boolean':
      return {
        ...base,
        kind: 'boolean',
        options: [],
        defaultValue: typeof prop.default === 'boolean' ? prop.default : false,
      };
    case 'number':
    case 'integer':
      return {
        ...base,
        kind: prop.type,
        options: [],
        defaultValue: typeof prop.default === 'number' ? prop.default : null,
      };
    default:
      return {
        ...base,
        kind: 'text',
        options: [],
        defaultValue: typeof prop.default === 'string' ? prop.default : null,
      };
  }
}

function enumOptions(
  prop: Record<string, unknown>,
): { value: string; label: string }[] | null {
  if (Array.isArray(prop.enum)) {
    const names = Array.isArray(prop.enumNames) ? prop.enumNames : [];
    return prop.enum.map((value, i) => ({
      value: String(value),
      label: typeof names[i] === 'string' ? names[i] : String(value),
    }));
  }
  const consts = Array.isArray(prop.oneOf)
    ? prop.oneOf
    : Array.isArray(prop.anyOf)
      ? prop.anyOf
      : null;
  if (consts) {
    return consts.filter(isRecord).map((option) => ({
      value: String(option.const),
      label:
        typeof option.title === 'string' ? option.title : String(option.const),
    }));
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
