export interface RuntimeTopologyResponse {
  runtime_mode: "desktop" | "web";
  gateway_host: string;
  gateway_port: number;
  gateway_facade_path: string;
  langgraph_upstream: string;
  frontend_allowed_origins: string[];
  cors_allow_origin_regex: string;
  browser_should_use_gateway_facade: boolean;
}
