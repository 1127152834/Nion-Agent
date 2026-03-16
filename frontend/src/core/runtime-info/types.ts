export interface RuntimeInfoResponse {
  runtime_mode: "desktop" | "web";
  base_dir: string;
  nion_home_env: string | null;
  openviking_index_db: string;
  python_version: string;
  git_sha: string | null;
  sentence_transformers_available: boolean;
  default_agent_name: string;
  default_agent_normalized: string | null;
}

