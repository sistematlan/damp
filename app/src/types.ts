export interface Container {
  name: string;
  status: string;
  state: string;
  is_damp: boolean;
  resources?: ContainerResources;
}

export interface ContainerResources {
  memory_usage: number;
  memory_limit: number;
  memory_percent: number;
  cpu_percent: number;
  pids: number;
  memory_limited: boolean;
  swap_limited: boolean;
  pressure: "ok" | "warning" | "critical" | "unbounded";
}

export interface RuntimeSummary {
  memory_usage: number;
  memory_limit: number;
  running_containers: number;
  limited_containers: number;
  warnings: number;
  sampled_at: string;
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
  runtime: RuntimeSummary;
  response_time_ms: number;
}

export interface Project {
  name: string;
  path: string;
  template: string;
  domain: string;
  status: string;
  health: string;
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
