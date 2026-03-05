export type StartupFailureCode =
  | "none"
  | "network"
  | "port_conflict"
  | "python_dependency_missing"
  | "unknown";

export type StartupRecoveryActionId =
  | "retry_startup"
  | "open_logs"
  | "exit_app";

export interface StartupError {
  code: StartupFailureCode;
  title: string;
  message: string;
  actions: StartupRecoveryAction[];
}

export interface StartupRecoveryAction {
  id: StartupRecoveryActionId;
  label: string;
  description: string;
}

export function getStartupError(code: StartupFailureCode, error?: Error): StartupError {
  switch (code) {
    case "network":
      return {
        code,
        title: "Network Error",
        message: "Failed to connect to required services. Please check your network connection and try again.",
        actions: [
          {
            id: "retry_startup",
            label: "Retry",
            description: "Retry starting the application"
          },
          {
            id: "open_logs",
            label: "View Logs",
            description: "Open logs directory to diagnose the issue"
          },
          {
            id: "exit_app",
            label: "Exit",
            description: "Exit the application"
          }
        ]
      };

    case "port_conflict":
      return {
        code,
        title: "Port Conflict",
        message: "Required ports are already in use. Please close other applications using ports 2024, 8001, or 3000.",
        actions: [
          {
            id: "retry_startup",
            label: "Retry",
            description: "Retry after closing conflicting applications"
          },
          {
            id: "open_logs",
            label: "View Logs",
            description: "Open logs directory to see which ports are in use"
          },
          {
            id: "exit_app",
            label: "Exit",
            description: "Exit the application"
          }
        ]
      };

    case "python_dependency_missing":
      return {
        code,
        title: "Missing Dependencies",
        message: "Required dependencies (uv or pnpm) are not installed. Please install them and try again.",
        actions: [
          {
            id: "retry_startup",
            label: "Retry",
            description: "Retry after installing dependencies"
          },
          {
            id: "open_logs",
            label: "View Logs",
            description: "Open logs directory for more details"
          },
          {
            id: "exit_app",
            label: "Exit",
            description: "Exit the application"
          }
        ]
      };

    default:
      return {
        code: "unknown",
        title: "Startup Failed",
        message: error?.message || "An unknown error occurred during startup. Please check the logs for more details.",
        actions: [
          {
            id: "retry_startup",
            label: "Retry",
            description: "Retry starting the application"
          },
          {
            id: "open_logs",
            label: "View Logs",
            description: "Open logs directory to diagnose the issue"
          },
          {
            id: "exit_app",
            label: "Exit",
            description: "Exit the application"
          }
        ]
      };
  }
}
