/**
 * サイドバーの目標・相談の1件に共通の見た目。
 * 選んだものには左端に縦の線を伸ばして出し、どれを見ているか分かるようにする
 */
export const SELECTABLE_ITEM_CLASS =
  'relative flex w-full rounded-field px-2.5 text-left transition-colors duration-150 hover:bg-base-200 ' +
  "before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:scale-y-0 before:rounded-full before:bg-primary before:transition-transform before:duration-200 before:content-['']";

export const SELECTED_ITEM_CLASS =
  'bg-primary/15 hover:bg-primary/20 before:scale-y-100';
