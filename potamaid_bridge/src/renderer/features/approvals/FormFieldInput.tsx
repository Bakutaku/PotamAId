import { useId } from 'react';
import type { FormField } from '../../../shared/domain';

/** 入力フォームの1項目の値。未入力は null */
export type FieldValue = string | number | boolean | string[] | null;

/** MCP の入力フォームの1項目（種類に応じた入力欄） */
export function FormFieldInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: FieldValue;
  onChange(value: FieldValue): void;
}) {
  const id = useId();
  const label = (
    <span className="font-medium">
      {field.title}
      {field.required && <span className="text-error-strong"> *</span>}
    </span>
  );
  const description = field.description && (
    <span className="text-xs text-muted">{field.description}</span>
  );

  switch (field.kind) {
    case 'boolean':
      return (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          {label}
          {description}
        </label>
      );
    case 'multiSelect': {
      const selected = Array.isArray(value) ? value : [];
      return (
        <fieldset className="flex flex-col gap-1">
          <legend>{label}</legend>
          {description}
          {field.options.map((option) => (
            <label key={option.value} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={selected.includes(option.value)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...selected, option.value]
                      : selected.filter((v) => v !== option.value),
                  )
                }
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      );
    }
    case 'select':
      return (
        <div className="flex flex-col gap-1">
          <label htmlFor={id}>{label}</label>
          {description}
          <select
            id={id}
            className="select select-sm w-full"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value || null)}
          >
            <option value="">（選んでください）</option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      );
    case 'number':
    case 'integer':
      return (
        <div className="flex flex-col gap-1">
          <label htmlFor={id}>{label}</label>
          {description}
          <input
            id={id}
            type="number"
            step={field.kind === 'integer' ? 1 : 'any'}
            className="input input-sm w-40"
            value={typeof value === 'number' ? value : ''}
            onChange={(e) =>
              onChange(e.target.value === '' ? null : Number(e.target.value))
            }
          />
        </div>
      );
    case 'text':
      return (
        <div className="flex flex-col gap-1">
          <label htmlFor={id}>{label}</label>
          {description}
          <input
            id={id}
            className="input input-sm w-full"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
  }
}
