import type { Project, WeightProfiles } from '../../../shared/domain';
import type { ProjectPatch } from '../../../shared/ipc';
import type { Database } from '../Database';

interface ProjectRow {
  id: string;
  name: string;
  root_path: string;
  read_only_concurrency: number;
  edit_concurrency: number;
  weight_profiles: string;
  created_at: number;
}

const toProject = (row: ProjectRow): Project => ({
  id: row.id,
  name: row.name,
  rootPath: row.root_path,
  readOnlyConcurrency: row.read_only_concurrency,
  editConcurrency: row.edit_concurrency,
  weightProfiles: JSON.parse(row.weight_profiles) as WeightProfiles,
  createdAt: row.created_at,
});

/** 対象mod の保存と読み込み */
export class ProjectRepository {
  constructor(private readonly db: Database) {}

  list(): Project[] {
    return this.db
      .all<ProjectRow>('SELECT * FROM projects ORDER BY created_at')
      .map(toProject);
  }

  find(id: string): Project | undefined {
    const row = this.db.get<ProjectRow>(
      'SELECT * FROM projects WHERE id = ?',
      id,
    );
    return row && toProject(row);
  }

  findByRootPath(rootPath: string): Project | undefined {
    const row = this.db.get<ProjectRow>(
      'SELECT * FROM projects WHERE root_path = ?',
      rootPath,
    );
    return row && toProject(row);
  }

  insert(project: Project): void {
    this.db.run(
      'INSERT INTO projects (id, name, root_path, read_only_concurrency, edit_concurrency, weight_profiles, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      project.id,
      project.name,
      project.rootPath,
      project.readOnlyConcurrency,
      project.editConcurrency,
      JSON.stringify(project.weightProfiles),
      project.createdAt,
    );
  }

  update(id: string, patch: ProjectPatch): void {
    if (patch.name !== undefined) {
      this.db.run('UPDATE projects SET name = ? WHERE id = ?', patch.name, id);
    }
    if (patch.readOnlyConcurrency !== undefined) {
      this.db.run(
        'UPDATE projects SET read_only_concurrency = ? WHERE id = ?',
        patch.readOnlyConcurrency,
        id,
      );
    }
    if (patch.editConcurrency !== undefined) {
      this.db.run(
        'UPDATE projects SET edit_concurrency = ? WHERE id = ?',
        patch.editConcurrency,
        id,
      );
    }
    if (patch.weightProfiles !== undefined) {
      this.db.run(
        'UPDATE projects SET weight_profiles = ? WHERE id = ?',
        JSON.stringify(patch.weightProfiles),
        id,
      );
    }
  }
}
