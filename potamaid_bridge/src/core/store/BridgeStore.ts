import { Database } from './Database';
import { ConsultRepository } from './repositories/ConsultRepository';
import { GoalRepository } from './repositories/GoalRepository';
import { ProgressEventRepository } from './repositories/ProgressEventRepository';
import { ProjectRepository } from './repositories/ProjectRepository';
import { SettingsRepository } from './repositories/SettingsRepository';
import { TaskRepository } from './repositories/TaskRepository';

/** Bridge の保存先。リポジトリをまとめて持つ */
export class BridgeStore {
  readonly projects: ProjectRepository;
  readonly goals: GoalRepository;
  readonly tasks: TaskRepository;
  readonly consults: ConsultRepository;
  readonly events: ProgressEventRepository;
  readonly settings: SettingsRepository;

  private readonly db: Database;

  /** @param path データベースのファイルのパス。`:memory:` ならメモリ上に作る */
  constructor(path: string) {
    this.db = new Database(path);
    this.projects = new ProjectRepository(this.db);
    this.goals = new GoalRepository(this.db);
    this.tasks = new TaskRepository(this.db);
    this.consults = new ConsultRepository(this.db);
    this.events = new ProgressEventRepository(this.db);
    this.settings = new SettingsRepository(this.db);
  }

  /** 複数のリポジトリへの書き込みを1つのトランザクションにまとめる */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }

  close(): void {
    this.db.close();
  }
}
