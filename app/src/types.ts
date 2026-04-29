export interface Container {
  name: string;
  status: string;
  is_damp: boolean;
}

export interface Database {
  name: string;
  engine: string;
}

export interface RedisInfo {
  connected: boolean;
  version: string;
  memory: string;
  keys: number;
}

export interface DampStatus {
  docker_running: boolean;
  docker_installed: boolean;
  docker_desktop_installed: boolean;
  damp_path: string;
  tld: string;
  containers: Container[];
  databases: Database[];
  postgres_databases: Database[];
  redis: RedisInfo;
}

export interface Project {
  name: string;
  path: string;
  template: string;
}

export interface Template {
  name: string;
  description: string;
}

export interface ProjectSuggestion {
  path: string;
  suggested_template: string;
  detected_files: string[];
}
