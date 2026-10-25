import { bridge } from '../../api/bridge';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { useRunAction } from '../../state/Toasts';
import { useUiState } from '../../state/UiState';

/** 対象modがまだないときの案内 */
export function NoProjects() {
  const run = useRunAction();
  const { selectProject } = useUiState();
  return (
    <EmptyState
      title="対象modを追加してください"
      action={
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() =>
            void run(async () => {
              const dir = await bridge.pickProjectDirectory();
              if (dir) {
                selectProject((await bridge.addProject(dir)).id);
              }
            })
          }
        >
          <Icon name="folder" size={14} />
          フォルダーを選ぶ
        </button>
      }
    >
      AI が編集する mod のリポジトリのフォルダーを選びます。AI
      はそのフォルダーを作業ディレクトリにして動きます。
    </EmptyState>
  );
}
