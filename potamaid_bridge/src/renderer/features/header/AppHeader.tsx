/**
 * ヘッダー: ロゴ、対象modの切り替え、実行数、テーマの切り替え、設定。
 */
import type { Project } from '../../../shared/domain';
import type { BridgeSnapshot } from '../../../shared/ipc';
import logo from '../../../../assets/river-spirit.png';
import { IconButton } from '../../components/IconButton';
import { useUiState } from '../../state/UiState';
import { ProjectTabs } from './ProjectTabs';
import { RunCounters } from './RunCounters';
import { ThemeToggle } from './ThemeToggle';

export function AppHeader({
  snapshot,
  project,
}: {
  snapshot: BridgeSnapshot;
  project: Project | null;
}) {
  const { openDialog } = useUiState();
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-base-300 bg-base-100 px-4 py-2">
      <div className="flex items-center gap-2">
        <img
          src={logo}
          alt=""
          className="size-[30px] [image-rendering:pixelated]"
        />
        <span className="font-pixel text-lg text-accent">PotamAId Bridge</span>
      </div>
      <ProjectTabs
        projects={snapshot.projects}
        selectedId={project?.id ?? null}
      />
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {project && <RunCounters runs={snapshot.runs[project.id]} />}
        <ThemeToggle theme={snapshot.settings.theme} />
        <IconButton
          icon="settings"
          label="設定"
          onClick={() => openDialog('settings')}
        />
      </div>
    </header>
  );
}
