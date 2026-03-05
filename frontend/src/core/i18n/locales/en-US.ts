import {
  CompassIcon,
  GraduationCapIcon,
  ImageIcon,
  MicroscopeIcon,
  PenLineIcon,
  ShapesIcon,
  SparklesIcon,
  VideoIcon,
} from "lucide-react";

import type { Translations } from "./types";

export const enUS: Translations = {
  migration: {
    settings: {
      modelSettings: {},
      toolSettings: {},
      skillSettings: {},
      retrieval: {},
      common: {},
    },
  },

  // Locale meta
  locale: {
    localName: "English",
  },

  // Common
  common: {
    home: "Home",
    settings: "Settings",
    delete: "Delete",
    rename: "Rename",
    share: "Share",
    openInNewWindow: "Open in new window",
    close: "Close",
    more: "More",
    search: "Search",
    download: "Download",
    thinking: "Thinking",
    artifacts: "Artifacts",
    public: "Public",
    custom: "Custom",
    notAvailableInDemoMode: "Not available in demo mode",
    loading: "Loading...",
    version: "Version",
    lastUpdated: "Last updated",
    code: "Code",
    preview: "Preview",
    cancel: "Cancel",
    save: "Save",
    install: "Install",
    create: "Create",
  },

  // Welcome
  welcome: {
    greeting: "Hello, again!",
    description:
      "Welcome to 🦌 Nion, an open source super agent. With built-in and custom skills, Nion helps you search on the web, analyze data, and generate artifacts like slides, web pages and do almost anything.",

    createYourOwnSkill: "Create Your Own Skill",
    createYourOwnSkillDescription:
      "Create your own skill to release the power of Nion. With customized skills,\nNion can help you search on the web, analyze data, and generate\n artifacts like slides, web pages and do almost anything.",
  },

  // Clipboard
  clipboard: {
    copyToClipboard: "Copy to clipboard",
    copiedToClipboard: "Copied to clipboard",
    failedToCopyToClipboard: "Failed to copy to clipboard",
    linkCopied: "Link copied to clipboard",
  },

  // Input Box
  inputBox: {
    placeholder: "How can I assist you today?",
    createSkillPrompt:
      "We're going to build a new skill step by step with `skill-creator`. To start, what do you want this skill to do?",
    addAttachments: "Add attachments",
    mode: "Mode",
    flashMode: "Flash",
    flashModeDescription: "Fast and efficient, but may not be accurate",
    reasoningMode: "Reasoning",
    reasoningModeDescription:
      "Reasoning before action, balance between time and accuracy",
    proMode: "Pro",
    proModeDescription:
      "Reasoning, planning and executing, get more accurate results, may take more time",
    ultraMode: "Ultra",
    ultraModeDescription:
      "Pro mode with subagents to divide work; best for complex multi-step tasks",
    reasoningEffort: "Reasoning Effort",
    reasoningEffortMinimal: "Minimal",
    reasoningEffortMinimalDescription: "Retrieval + Direct Output",
    reasoningEffortLow: "Low",
    reasoningEffortLowDescription: "Simple Logic Check + Shallow Deduction",
    reasoningEffortMedium: "Medium",
    reasoningEffortMediumDescription:
      "Multi-layer Logic Analysis + Basic Verification",
    reasoningEffortHigh: "High",
    reasoningEffortHighDescription:
      "Full-dimensional Logic Deduction + Multi-path Verification + Backward Check",
    searchModels: "Search models...",
    surpriseMe: "Surprise",
    surpriseMePrompt: "Surprise me",
    suggestions: [
      {
        suggestion: "Write",
        prompt: "Write a blog post about the latest trends on [topic]",
        icon: PenLineIcon,
      },
      {
        suggestion: "Research",
        prompt:
          "Conduct a deep dive research on [topic], and summarize the findings.",
        icon: MicroscopeIcon,
      },
      {
        suggestion: "Collect",
        prompt: "Collect data from [source] and create a report.",
        icon: ShapesIcon,
      },
      {
        suggestion: "Learn",
        prompt: "Learn about [topic] and create a tutorial.",
        icon: GraduationCapIcon,
      },
    ],
    suggestionsCreate: [
      {
        suggestion: "Webpage",
        prompt: "Create a webpage about [topic]",
        icon: CompassIcon,
      },
      {
        suggestion: "Image",
        prompt: "Create an image about [topic]",
        icon: ImageIcon,
      },
      {
        suggestion: "Video",
        prompt: "Create a video about [topic]",
        icon: VideoIcon,
      },
      {
        type: "separator",
      },
      {
        suggestion: "Skill",
        prompt:
          "We're going to build a new skill step by step with `skill-creator`. To start, what do you want this skill to do?",
        icon: SparklesIcon,
      },
    ],
  },

  // Sidebar
  sidebar: {
    newChat: "New chat",
    chats: "Chats",
    recentChats: "Recent chats",
    demoChats: "Demo chats",
    agents: "Agents",
    rss: "News",
  },

  // Agents
  agents: {
    title: "Agents",
    description:
      "Create and manage custom agents with specialized prompts and capabilities.",
    newAgent: "New Agent",
    emptyTitle: "No custom agents yet",
    emptyDescription:
      "Create your first custom agent with a specialized system prompt.",
    chat: "Chat",
    delete: "Delete",
    deleteConfirm:
      "Are you sure you want to delete this agent? This action cannot be undone.",
    deleteSuccess: "Agent deleted",
    newChat: "New chat",
    createPageTitle: "Design your Agent",
    createPageSubtitle:
      "Describe the agent you want — I'll help you create it through conversation.",
    nameStepTitle: "Name your new Agent",
    nameStepHint:
      "Letters, digits, and hyphens only — stored lowercase (e.g. code-reviewer)",
    nameStepPlaceholder: "e.g. code-reviewer",
    nameStepContinue: "Continue",
    nameStepInvalidError:
      "Invalid name — use only letters, digits, and hyphens",
    nameStepAlreadyExistsError: "An agent with this name already exists",
    nameStepCheckError: "Could not verify name availability — please try again",
    nameStepBootstrapMessage:
      "The new custom agent name is {name}. Let's bootstrap it's **SOUL**.",
    agentCreated: "Agent created!",
    startChatting: "Start chatting",
    backToGallery: "Back to Gallery",
  },

  // Breadcrumb
  breadcrumb: {
    workspace: "Workspace",
    chats: "Chats",
    rss: "News",
  },

  // Workspace
  workspace: {
    officialWebsite: "Nion's official website",
    githubTooltip: "Nion on Github",
    settingsAndMore: "Settings and more",
    visitGithub: "Nion on GitHub",
    reportIssue: "Report a issue",
    contactUs: "Contact us",
    about: "About Nion",
  },

  // Conversation
  conversation: {
    noMessages: "No messages yet",
    startConversation: "Start a conversation to see messages here",
  },

  // Chats
  chats: {
    searchChats: "Search chats",
  },

  // Page titles (document title)
  pages: {
    appName: "Nion",
    chats: "Chats",
    rss: "News",
    newChat: "New chat",
    untitled: "Untitled",
  },

  rssReader: {
    title: "RSS Subscriptions",
    entries: "Entries",
    allFeeds: "All feeds",
    addFeed: "Add feed",
    addFeedDescription: "Paste an RSS/Atom URL to import the latest entries.",
    feedUrlPlaceholder: "https://example.com/feed.xml",
    feedCategoryPlaceholder: "Category (optional, e.g. tech)",
    feedUrlRequired: "Feed URL is required",
    feedUrlInvalid: "Invalid URL. Please use http/https.",
    subscribe: "Subscribe",
    refresh: "Refresh",
    refreshAll: "Refresh list",
    emptyFeeds: "No feeds yet. Add one to start reading.",
    emptyEntries: "No entries found",
    loadingEntries: "Loading entries...",
    loadingEntry: "Loading article...",
    loadingMore: "Loading more...",
    loadMoreHint: "Scroll down to load more",
    filterAll: "All",
    filterUnread: "Unread",
    filterStarred: "Starred",
    markRead: "Mark read",
    markUnread: "Mark unread",
    star: "Star",
    unstar: "Unstar",
    openOriginal: "Open original",
    backToList: "Back to list",
    aiPanelTitle: "AI Reader Assistant",
    aiPanelDescription:
      "Article context to chat integration is planned for the next phase. In this phase, RSS reading and curation workflows are available.",
    feedAdded: "Subscribed successfully, imported {count} entries",
    feedDeleted: "Feed deleted",
    feedRefreshed: "Refresh complete, imported {count} new entries",
    feedAddFailed: "Failed to add feed",
    feedDeleteFailed: "Failed to delete feed",
    feedRefreshFailed: "Failed to refresh feed",
    feedDeleteConfirm:
      "Delete feed \"{title}\"? This will remove all associated entries.",
    entryUpdateFailed: "Failed to update entry status",
    entryLoadFailed: "Failed to load entries",
    entryNotFound: "Entry not found or has been removed",
  },

  // Tool calls
  toolCalls: {
    moreSteps: (count: number) => `${count} more step${count === 1 ? "" : "s"}`,
    lessSteps: "Less steps",
    executeCommand: "Execute command",
    presentFiles: "Present files",
    needYourHelp: "Need your help",
    useTool: (toolName: string) => `Use "${toolName}" tool`,
    searchFor: (query: string) => `Search for "${query}"`,
    searchForRelatedInfo: "Search for related information",
    searchForRelatedImages: "Search for related images",
    searchForRelatedImagesFor: (query: string) =>
      `Search for related images for "${query}"`,
    searchOnWebFor: (query: string) => `Search on the web for "${query}"`,
    viewWebPage: "View web page",
    listFolder: "List folder",
    readFile: "Read file",
    writeFile: "Write file",
    clickToViewContent: "Click to view file content",
    writeTodos: "Update to-do list",
    skillInstallTooltip: "Install skill and make it available to Nion",
  },

  // Subtasks
  uploads: {
    uploading: "Uploading...",
    uploadingFiles: "Uploading files, please wait...",
  },

  subtasks: {
    subtask: "Subtask",
    executing: (count: number) =>
      `Executing ${count === 1 ? "" : count + " "}subtask${count === 1 ? "" : "s in parallel"}`,
    in_progress: "Running subtask",
    completed: "Subtask completed",
    failed: "Subtask failed",
  },

  // Settings
  settings: {
    title: "Settings",
    description: "Adjust how Nion looks and behaves for you.",
    sections: {
      appearance: "Appearance",
      memory: "Memory",
      tools: "Tools",
      skills: "Skills",
      notification: "Notification",
      about: "About",
    },
    memory: {
      title: "Memory",
      description:
        "Nion automatically learns from your conversations in the background. These memories help Nion understand you better and deliver a more personalized experience.",
      empty: "No memory data to display.",
      rawJson: "Raw JSON",
      markdown: {
        overview: "Overview",
        userContext: "User context",
        work: "Work",
        personal: "Personal",
        topOfMind: "Top of mind",
        historyBackground: "History",
        recentMonths: "Recent months",
        earlierContext: "Earlier context",
        longTermBackground: "Long-term background",
        updatedAt: "Updated at",
        facts: "Facts",
        empty: "(empty)",
        table: {
          category: "Category",
          confidence: "Confidence",
          confidenceLevel: {
            veryHigh: "Very high",
            high: "High",
            normal: "Normal",
            unknown: "Unknown",
          },
          content: "Content",
          source: "Source",
          createdAt: "CreatedAt",
          view: "View",
        },
      },
    },
    appearance: {
      themeTitle: "Theme",
      themeDescription:
        "Choose how the interface follows your device or stays fixed.",
      system: "System",
      light: "Light",
      dark: "Dark",
      systemDescription: "Match the operating system preference automatically.",
      lightDescription: "Bright palette with higher contrast for daytime.",
      darkDescription: "Dim palette that reduces glare for focus.",
      languageTitle: "Language",
      languageDescription: "Switch between languages.",
    },
    tools: {
      title: "Tools",
      description: "Manage the configuration and enabled status of MCP tools.",
    },
    models: {
      title: "Models",
      description: "Manage model providers, model catalogs, and default model.",
    },
    sandbox: {
      title: "Sandbox",
      description: "Configure sandbox execution and environment variables.",
    },
    retrieval: {
      title: "Retrieval",
      description: "Configure embedding and rerank providers, local model catalog, and diagnostics.",
      tabEmbedding: "Embedding",
      tabRerank: "Rerank",
      tabTesting: "Testing",
      actionRefresh: "Refresh",
      localModelsTitleEmbedding: "Embedding model catalog",
      localModelsTitleRerank: "Rerank model catalog",
      noModels: "No retrieval models available.",
      statusInstalled: "Installed",
      statusNotInstalled: "Not installed",
      statusActive: "Active",
      statusConfiguredPending: "Configured (pending install)",
      configuredPendingHint: "This model is configured as active but not installed yet.",
      actionDownload: "Download",
      actionImport: "Import",
      actionDelete: "Delete",
      actionEnable: "Enable",
      actionEnabled: "Enabled",
      setActiveSuccess: "Active model updated.",
      removeSuccess: "Model removed.",
      operationFailedPrefix: "Operation failed: ",
      desktopOnlyHint: "Desktop runtime is required for local model operations.",
      advancedTitle: "Advanced provider settings",
      providerDetailTitle: "Provider settings",
      providerEmbeddingTitle: "OpenAI-compatible embedding provider",
      providerRerankTitle: "Rerank API provider",
      providerProtocolOpenAI: "OpenAI compatible",
      providerProtocolRerank: "Rerank API",
      providerApiKey: "API Key",
      providerApiBase: "API Base URL",
      providerModel: "Model",
      providerPath: "Path",
      providerModelList: "Model suggestions",
      providerDelete: "Reset provider",
      providerDeleteSuccess: "Provider reset.",
      providerDeleteConfirmTitle: "Reset provider settings?",
      providerDeleteConfirmDescription: (name: string) =>
        `Reset provider \"${name}\" settings?`,
      providerTestConnection: "Test connection",
      providerTesting: "Testing...",
      providerConnectionSuccess: "Provider connection succeeded.",
      testTitle: "Retrieval diagnostics",
      testQueryPlaceholder: "Enter a test query",
      testDocsPlaceholder: "One document per line for rerank test",
      actionTestEmbedding: "Test embedding",
      actionTestRerank: "Test rerank",
      testEmpty: "No test result yet.",
      deleteConfirmTitle: "Delete local model?",
      deleteConfirmDescription: (name: string) =>
        `Delete local model \"${name}\" from disk?`,
      autoSwitchLocalSuccess: "Switched to another local model.",
      autoSwitchRemoteSuccess: "Switched to remote provider model.",
      autoSwitchFailed: "Auto switch failed. Configure active model manually.",
    },
    skills: {
      title: "Agent Skills",
      description:
        "Manage the configuration and enabled status of the agent skills.",
      createSkill: "Create skill",
      emptyTitle: "No agent skill yet",
      emptyDescription:
        "Put your agent skill folders under the `/skills/custom` folder under the root folder of Nion.",
      emptyButton: "Create Your First Skill",
    },
    notification: {
      title: "Notification",
      description:
        "Nion only sends a completion notification when the window is not active. This is especially useful for long-running tasks so you can switch to other work and get notified when done.",
      requestPermission: "Request notification permission",
      deniedHint:
        "Notification permission was denied. You can enable it in your browser's site settings to receive completion alerts.",
      testButton: "Send test notification",
      testTitle: "Nion",
      testBody: "This is a test notification.",
      notSupported: "Your browser does not support notifications.",
      disableNotification: "Disable notification",
    },
    acknowledge: {
      emptyTitle: "Acknowledgements",
      emptyDescription: "Credits and acknowledgements will show here.",
    },
    workbenchPlugins: {
      title: "Workbench Plugins",
      description: "Manage workbench plugins for different artifact types",
      installed: "Installed",
      marketplace: "Marketplace",
      addPlugin: "Add Plugin",
      createViaSkill: "Create plugin via skill",
      uploadPackage: "Upload .nwp package",
      uploading: "Uploading...",
      uploadFormatError: "Please upload a .nwp package",
      uploadFailed: "Failed to upload plugin",
      pluginInstalled: "Plugin \"{name}\" installed",
      pluginDeleted: "Plugin deleted",
      deleteFailed: "Failed to delete plugin",
      deleteConfirmTitle: "Confirm Plugin Deletion",
      deleteConfirmDescription: "Delete plugin \"{name}\"? This action cannot be undone.",
      cancelAction: "Cancel",
      confirmDeleteAction: "Delete",
      emptyTitle: "No plugins installed",
      emptyDescription: "Install workbench plugins to handle different artifact types",
      emptyButton: "Create your first plugin",
    },
  },
};
