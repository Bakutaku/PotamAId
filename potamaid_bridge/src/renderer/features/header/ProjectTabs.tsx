import type { Project } from '../../../shared/domain';
import { bridge } from '../../api/bridge';
import { Icon } from '../../components/Icon';
import { StatusDot } from '../../components/StatusDot';
import { useRunAction } from '../../state/Toasts';
import { useUiState } from '../../state/UiState';

/**
 * 対象modの切り替え。左の丸はゲームとの接続の状態（Mod との接続は未実装のため、今は常に未接続）。
 */
export function ProjectTabs({
  projects,
  selectedId,
}: {
  projects: Project[];
  selectedId: string | null;
}) {
  const { selectProject } = useUiState();
  const run = useRunAction();

  const addProject = () =>
    run(async () => {
      const dir = await bridge.pickProjectDirectory();
      if (dir) {
        const project = await bridge.addProject(dir);
        selectProject(project.id);
      }
    });

  return (
    <nav aria-label="対象mod" className="flex flex-wrap gap-1">
      {projects.map((project) => {
        const selected = project.id === selectedId;
        return (
          <button
            key={project.id}
            type="button"
            title={project.rootPath}
            aria-current={selected ? 'true' : undefined}
            onClick={() => selectProject(project.id)}
            className={`btn btn-sm rounded-selector font-medium ${
              selected
                ? 'border-primary bg-primary/15 text-primary-strong'
                : 'border-base-300 bg-base-100 text-muted'
            }`}
          >
            <StatusDot tone="neutral" label="ゲーム: 未接続" />
            {project.name}
          </button>
        );
      })}
      <button
        type="button"
        aria-label="対象modを追加"
        title="対象modを追加"
        onClick={() => void addProject()}
        className="btn btn-sm btn-square rounded-selector border-dashed border-base-300 bg-transparent text-muted"
      >
        <Icon name="plus" size={14} />
      </button>
    </nav>
  );
}
