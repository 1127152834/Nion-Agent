import type { LucideIcon } from "lucide-react";

export interface Translations {
  migration: any;

  // Locale meta
  locale: {
    localName: string;
  };

  // Common
  common: {
    home: string;
    settings: string;
    delete: string;
    rename: string;
    share: string;
    openInNewWindow: string;
    close: string;
    more: string;
    search: string;
    download: string;
    thinking: string;
    artifacts: string;
    public: string;
    custom: string;
    notAvailableInDemoMode: string;
    loading: string;
    version: string;
    lastUpdated: string;
    code: string;
    preview: string;
    cancel: string;
    save: string;
    install: string;
    create: string;
    workingDirectory: string;
    browseWorkspace: string;
    directoryTree: string;
    filesSuffix: string;
    noFilesInDirectory: string;
  };

  // Welcome
  welcome: {
    greeting: string;
    description: string;
    createYourOwnSkill: string;
    createYourOwnSkillDescription: string;
  };

  // Clipboard
  clipboard: {
    copyToClipboard: string;
    copiedToClipboard: string;
    failedToCopyToClipboard: string;
    linkCopied: string;
  };

  // Input Box
  inputBox: {
    placeholder: string;
    createSkillPrompt: string;
    addAttachments: string;
    mode: string;
    flashMode: string;
    flashModeDescription: string;
    reasoningMode: string;
    reasoningModeDescription: string;
    proMode: string;
    proModeDescription: string;
    ultraMode: string;
    ultraModeDescription: string;
    reasoningEffort: string;
    reasoningEffortMinimal: string;
    reasoningEffortMinimalDescription: string;
    reasoningEffortLow: string;
    reasoningEffortLowDescription: string;
    reasoningEffortMedium: string;
    reasoningEffortMediumDescription: string;
    reasoningEffortHigh: string;
    reasoningEffortHighDescription: string;
    searchModels: string;
    surpriseMe: string;
    surpriseMePrompt: string;
    suggestions: {
      suggestion: string;
      prompt: string;
      icon: LucideIcon;
    }[];
    suggestionsCreate: (
      | {
          suggestion: string;
          prompt: string;
          icon: LucideIcon;
        }
      | {
          type: "separator";
        }
    )[];
  };

  // Sidebar
  sidebar: {
    recentChats: string;
    newChat: string;
    chats: string;
    demoChats: string;
    agents: string;
    rss: string;
    scheduler: string;
  };

  // Agents
  agents: {
    title: string;
    description: string;
    newAgent: string;
    emptyTitle: string;
    emptyDescription: string;
    chat: string;
    delete: string;
    deleteConfirm: string;
    deleteSuccess: string;
    newChat: string;
    createPageTitle: string;
    createPageSubtitle: string;
    nameStepTitle: string;
    nameStepHint: string;
    nameStepPlaceholder: string;
    nameStepContinue: string;
    nameStepInvalidError: string;
    nameStepAlreadyExistsError: string;
    nameStepCheckError: string;
    nameStepBootstrapMessage: string;
    agentCreated: string;
    startChatting: string;
    backToGallery: string;
  };

  // Breadcrumb
  breadcrumb: {
    workspace: string;
    chats: string;
    rss: string;
    scheduler: string;
  };

  // Workspace
  workspace: {
    officialWebsite: string;
    githubTooltip: string;
    settingsAndMore: string;
    visitGithub: string;
    reportIssue: string;
    contactUs: string;
    about: string;
    threadTitle: {
      untitled: string;
      loading: string;
    };
    todoList: {
      title: string;
    };
  };

  // Conversation
  conversation: {
    noMessages: string;
    startConversation: string;
  };

  // Chats
  chats: {
    searchChats: string;
  };

  // Page titles (document title)
  pages: {
    appName: string;
    chats: string;
    rss: string;
    scheduler: string;
    newChat: string;
    untitled: string;
  };

  artifacts: {
    fileDetail: {
      installSkillFailed: string;
      selectFile: string;
      copyFailed: string;
    };
  };

  rssReader: {
    title: string;
    entries: string;
    allFeeds: string;
    addFeed: string;
    addFeedDescription: string;
    feedUrlPlaceholder: string;
    feedCategoryPlaceholder: string;
    feedUrlRequired: string;
    feedUrlInvalid: string;
    subscribe: string;
    refresh: string;
    refreshAll: string;
    discoverTitle: string;
    discoverSearchPlaceholder: string;
    discoverEmpty: string;
    discoverLoadFailed: string;
    discoverFeatured: string;
    discoverSubscribed: string;
    discoverAlreadySubscribed: string;
    discoverPreview: string;
    discoverPreviewTitle: string;
    discoverPreviewLoading: string;
    discoverPreviewFailed: string;
    discoverPreviewEmpty: string;
    discoverPreviewRecentEntries: string;
    subscriptionsNavTitle: string;
    discoverNavDescription: string;
    subscriptionsNavDescription: string;
    goToDiscover: string;
    backToSubscriptions: string;
    discoverLanguageLabel: string;
    discoverLanguageAll: string;
    discoverLanguageChinese: string;
    discoverLanguageEnglish: string;
    discoverSortLabel: string;
    discoverSortFeatured: string;
    discoverSortTitle: string;
    discoverSortSite: string;
    discoverFeaturedSectionTitle: string;
    discoverFeaturedSectionDescription: string;
    discoverCategoryBoardTitle: string;
    discoverCategoryBoardDescription: string;
    discoverExploreCategory: string;
    rsshubTool: string;
    rsshubDialogTitle: string;
    rsshubDialogDescription: string;
    rsshubInstancePlaceholder: string;
    rsshubRoutePlaceholder: string;
    rsshubPreviewLabel: string;
    rsshubSearchPlaceholder: string;
    rsshubNoRoutes: string;
    rsshubRouteRequired: string;
    rsshubTemplateLabel: string;
    rsshubNoParamsNeeded: string;
    opmlTool: string;
    opmlDialogTitle: string;
    opmlDialogDescription: string;
    opmlFilterPlaceholder: string;
    opmlSelectFiltered: string;
    opmlClearSelection: string;
    opmlSelectedCount: string;
    opmlNoSource: string;
    opmlImportSelected: string;
    opmlParsed: string;
    opmlParseFailed: string;
    opmlSelectAtLeastOne: string;
    opmlImportSummary: string;
    emptyFeeds: string;
    emptyEntries: string;
    loadingEntries: string;
    loadingEntry: string;
    loadingMore: string;
    loadMoreHint: string;
    filterAll: string;
    filterUnread: string;
    filterStarred: string;
    markRead: string;
    markUnread: string;
    star: string;
    unstar: string;
    askAI: string;
    summarize: string;
    translate: string;
    askAIPrompt: string;
    summarizePrompt: string;
    translatePrompt: string;
    generateSummary: string;
    generateTranslation: string;
    summaryTitle: string;
    translationTitle: string;
    summaryFailed: string;
    translationFailed: string;
    openOriginal: string;
    backToList: string;
    aiPanelTitle: string;
    aiPanelDescription: string;
    assistantFloatingDescription: string;
    assistantOpen: string;
    assistantNewChat: string;
    assistantClose: string;
    assistantWelcomeTitle: string;
    assistantWelcomeDescription: string;
    assistantAskSelection: string;
    assistantThinking: string;
    assistantInputPlaceholder: string;
    assistantSend: string;
    assistantRestoreSelection: string;
    selectionCopied: string;
    selectionCopy: string;
    feedAdded: string;
    feedDeleted: string;
    feedRefreshed: string;
    feedAddFailed: string;
    feedDeleteFailed: string;
    feedRefreshFailed: string;
    feedDeleteConfirm: string;
    entryUpdateFailed: string;
    entryLoadFailed: string;
    entryNotFound: string;
  };

  // Tool calls
  toolCalls: {
    moreSteps: (count: number) => string;
    lessSteps: string;
    executeCommand: string;
    presentFiles: string;
    needYourHelp: string;
    useTool: (toolName: string) => string;
    searchForRelatedInfo: string;
    searchForRelatedImages: string;
    searchFor: (query: string) => string;
    searchForRelatedImagesFor: (query: string) => string;
    searchOnWebFor: (query: string) => string;
    viewWebPage: string;
    listFolder: string;
    readFile: string;
    writeFile: string;
    clickToViewContent: string;
    writeTodos: string;
    skillInstallTooltip: string;
  };

  // Uploads
  uploads: {
    uploading: string;
    uploadingFiles: string;
  };

  // Subtasks
  subtasks: {
    subtask: string;
    executing: (count: number) => string;
    in_progress: string;
    completed: string;
    failed: string;
  };

  // Settings
  settings: {
    title: string;
    description: string;
    sections: {
      appearance: string;
      memory: string;
      tools: string;
      channels: string;
      skills: string;
      notification: string;
      about: string;
    };
    validation: {
      rootLabel: string;
      validationFailed: string;
    };
    configSections: {
      saveBar: Record<string, any>;
      fieldTip: Record<string, any>;
      environmentVariables: Record<string, any>;
      memory: Record<string, any>;
      models: Record<string, any>;
      rss: Record<string, any>;
      sandbox: Record<string, any>;
      subagents: Record<string, any>;
      summarization: Record<string, any>;
      title: Record<string, any>;
      tools: Record<string, any>;
      [key: string]: Record<string, any>;
    };
    modelPage: Record<string, any>;
    skillImportDialog: Record<string, any>;
    skillPage: Record<string, any>;
    toolPage: Record<string, any>;
    workbenchPluginsPage: Record<string, any>;
    memory: {
      title: string;
      description: string;
      empty: string;
      rawJson: string;
      markdown: {
        overview: string;
        userContext: string;
        work: string;
        personal: string;
        topOfMind: string;
        historyBackground: string;
        recentMonths: string;
        earlierContext: string;
        longTermBackground: string;
        updatedAt: string;
        facts: string;
        empty: string;
        table: {
          category: string;
          confidence: string;
          confidenceLevel: {
            veryHigh: string;
            high: string;
            normal: string;
            unknown: string;
          };
          content: string;
          source: string;
          createdAt: string;
          view: string;
        };
      };
    };
    appearance: {
      themeTitle: string;
      themeDescription: string;
      system: string;
      light: string;
      dark: string;
      systemDescription: string;
      lightDescription: string;
      darkDescription: string;
      languageTitle: string;
      languageDescription: string;
    };
    tools: {
      title: string;
      description: string;
    };
    channels: {
      title: string;
      description: string;
    };
    models: {
      title: string;
      description: string;
    };
    sandbox: {
      title: string;
      description: string;
    };
    retrieval: Record<string, any>;
    skills: {
      title: string;
      description: string;
      createSkill: string;
      emptyTitle: string;
      emptyDescription: string;
      emptyButton: string;
    };
    notification: {
      title: string;
      description: string;
      requestPermission: string;
      deniedHint: string;
      testButton: string;
      testTitle: string;
      testBody: string;
      notSupported: string;
      disableNotification: string;
    };
    acknowledge: {
      emptyTitle: string;
      emptyDescription: string;
    };
    workbenchPlugins: {
      title: string;
      description: string;
      installed: string;
      marketplace: string;
      addPlugin: string;
      createViaSkill: string;
      uploadPackage: string;
      uploading: string;
      uploadFormatError: string;
      uploadFailed: string;
      pluginInstalled: string;
      pluginDeleted: string;
      deleteFailed: string;
      deleteConfirmTitle: string;
      deleteConfirmDescription: string;
      cancelAction: string;
      confirmDeleteAction: string;
      emptyTitle: string;
      emptyDescription: string;
      emptyButton: string;
    };
  };
}
