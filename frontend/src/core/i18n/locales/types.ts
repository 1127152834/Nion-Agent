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
    createYourOwnPlugin: string;
    createYourOwnPluginDescription: string;
  };

  // Clipboard
  clipboard: {
    copyToClipboard: string;
    copiedToClipboard: string;
    failedToCopyToClipboard: string;
    linkCopied: string;
  };

  citations: {
    source: string;
    visitSource: string;
  };

  // Input Box
  inputBox: {
    placeholder: string;
    createSkillPrompt: string;
    createPluginPrompt: string;
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
    contextLabel: string;
    skillLabel: string;
    mcpLabel: string;
    searchMcpTools: string;
    noMcpTools: string;
    generatingFollowUpSuggestions: string;
    surpriseMe: string;
    surpriseMePrompt: string;
    temporaryChat: string;
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

  // Artifact Center
  artifactCenter: {
    triggerLabel: string;
    title: string;
    description: string;
    searchPlaceholder: string;
    filterLabel: string;
    filterAll: string;
    filterDocuments: string;
    filterImages: string;
    filterMedia: string;
    filterCode: string;
    filterSkills: string;
    filterOther: string;
    sortLabel: string;
    sortRecent: string;
    sortNameAsc: string;
    sortNameDesc: string;
    resultSummary: string;
    clearFiltersAction: string;
    groupedSectionTitle: string;
    ungroupedSectionTitle: string;
    autoGroupHint: string;
    persistAutoGroups: string;
    enableAutoGrouping: string;
    disableAutoGrouping: string;
    createGroupAction: string;
    createGroupPrompt: string;
    downloadGroupAction: string;
    renameGroupAction: string;
    deleteGroupAction: string;
    renameGroupPrompt: string;
    deleteGroupConfirm: string;
    moveArtifactAction: string;
    removeFromGroupAction: string;
    moveArtifactPrompt: string;
    moveArtifactNoGroupHint: string;
    dragToMoveHint: string;
    emptyTitle: string;
    emptyDescription: string;
    filteredEmptyTitle: string;
    filteredEmptyDescription: string;
    workbenchTitle: string;
    matchedPluginPrefix: string;
    noMatchedPlugin: string;
    loadingContent: string;
    noPreview: string;
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
    bulkDeleteTitle: string;
    bulkDeleteDescription: string;
    bulkDeleteSuccess: string;
    bulkDeletePartialFailure: string;
    bulkDeleteFailure: string;
    deleteChatFailed: string;
    selectedChatsCount: string;
    cancelManageChats: string;
    manageChats: string;
    selectAllChats: string;
    clearChatSelection: string;
    deleteSelectedChats: string;
    moreSelectedChats: string;
    deleteCurrentChatInSelectionDescription: string;
    deleteCurrentChatInSelectionTitle: string;
    deleteCurrentChatTitle: string;
    deleteCurrentChatDescription: string;
  };

  // Agents
  agents: {
    title: string;
    description: string;
    defaultBadge: string;
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
    searchPlaceholder: string;
    filterAll: string;
    filterDefault: string;
    filterHeartbeat: string;
    filterEvolution: string;
    viewMemory: string;
    noToolGroups: string;
    catalogSummary: string;
    heartbeatOn: string;
    heartbeatOff: string;
    evolutionOn: string;
    evolutionOff: string;
    picker: {
      selectAgent: string;
      defaultAgentName: string;
      defaultAgentDescription: string;
      noDescription: string;
      settingsTooltip: string;
    };
    settings: {
      pageTitle: string;
      tabs: {
        basic: string;
        memory: string;
        heartbeat: string;
        evolution: string;
        soul: string;
        identity: string;
        logs: string;
        reports: string;
      };
      layout: {
        overviewGroup: string;
        personaGroup: string;
        runtimeGroup: string;
        observabilityGroup: string;
        subtitle: string;
        openChat: string;
      };
      loading: string;
      loadFailed: string;
      save: string;
      saving: string;
      cancel: string;
      memory: {
        title: string;
        profileTitle: string;
        historyTitle: string;
        entriesTitle: string;
        searchPlaceholder: string;
        filterAll: string;
        emptyHint: string;
        startChatToBuild: string;
        defaultUsesGlobalTitle: string;
        defaultUsesGlobalDescription: string;
        goToGlobalMemory: string;
        itemCount: string;
        factCount: string;
      };
      basic: {
        title: string;
        saved: string;
        saveFailed: string;
        nameLabel: string;
        nameImmutableHint: string;
        descriptionLabel: string;
        descriptionPlaceholder: string;
        modelLabel: string;
        modelPlaceholder: string;
        toolGroupsLabel: string;
        toolGroupsPlaceholder: string;
        heartbeatTitle: string;
        heartbeatDescription: string;
        evolutionTitle: string;
        evolutionDescription: string;
      };
      editor: {
        soulTitle: string;
        identityTitle: string;
        loadSoulFailed: string;
        loadIdentityFailed: string;
      };
      heartbeat: {
        title: string;
        enabledLabel: string;
        timezoneLabel: string;
        templatesLabel: string;
        templatesComingSoon: string;
        saveSettings: string;
      };
      evolution: {
        title: string;
        enabledLabel: string;
        intervalHoursLabel: string;
        autoTriggerLabel: string;
        saveSettings: string;
      };
      logs: {
        reportsTitle: string;
        suggestionsTitle: string;
        executionLogsTitle: string;
        allStatus: string;
        loading: string;
        loadLogsFailed: string;
        noLogs: string;
        logDetailsTitle: string;
        duration: string;
        error: string;
        result: string;
        loadReportsFailed: string;
        noReports: string;
        suggestionUnit: string;
        loadSuggestionsFailed: string;
        noSuggestions: string;
        confidence: string;
        suggestionDetailsTitle: string;
        suggestionContent: string;
        evidenceSummary: string;
        impactScope: string;
        processing: string;
        dismiss: string;
        accept: string;
        status: {
          success: string;
          failed: string;
          running: string;
          completed: string;
          pending: string;
          accepted: string;
          dismissed: string;
        };
        priority: {
          high: string;
          medium: string;
          low: string;
        };
      };
      toasts: {
        soulSaved: string;
        identitySaved: string;
        heartbeatSaved: string;
        evolutionSaved: string;
        suggestionDismissed: string;
        suggestionAccepted: string;
      };
    };
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
    messageList: {
      streamInterruptedTitle: string;
      streamInterruptedHint: string;
      streamEndedUnexpectedlyHint: string;
      retryLastMessage: string;
      errorDetails: string;
      incompleteResponseTitle: string;
      incompleteResponseHint: string;
      noRetryableUserMessage: string;
      retryFailedPrefix: string;
    };
    todoList: {
      title: string;
    };
    runtimeMode: {
      sandboxLabel: string;
      hostLabel: string;
      pickDir: string;
      hostDialogTitle: string;
      hostDialogDescription: string;
      hostDialogCurrentDir: string;
      hostDialogChooseDir: string;
      hostDialogCancel: string;
      hostBoundDirectory: string;
      hostDirLocked: string;
      hostDirMissing: string;
      hostDirDetected: (path: string) => string;
      hostDirNotEmptyHint: string;
      createEmptyFolderAndUse: string;
      folderNamePlaceholder: string;
      folderNameRequired: string;
      folderNameInvalid: string;
      creating: string;
      confirm: string;
      locked: string;
      lockedTip: string;
      desktopOnly: string;
      modeSaveFailed: string;
      sandboxTip: string;
      hostTip: string;
    };
    runtimeOnboarding: {
      title: string;
      description: string;
      coreStatusLabel: string;
      coreReady: string;
      coreNotReady: string;
      versionLabel: string;
      platformLabel: string;
      noOptionalComponents: string;
      downloadComponent: string;
      retry: string;
      skip: string;
      later: string;
      continueToWorkspace: string;
      status: {
        notDownloaded: string;
        downloading: string;
        downloaded: string;
        failed: string;
        skipped: string;
        unknown: string;
      };
    };
    artifactPanel: {
      plugin: string;
      filePreview: string;
      directory: string;
      tabDirectory: string;
      tabPreview: string;
      tabPlugin: string;
      openWithWorkbench: string;
      chooseWorkbenchTitle: string;
      chooseWorkbenchDescription: string;
      targetPrefix: string;
      pluginLoading: string;
      pluginResolving: string;
      pluginMissingOrDisabled: string;
      pluginUnsupportedSurface: string;
      retryLoad: string;
      selectFileHint: string;
      pluginEntryMissing: string;
    };
    pluginAssistant: {
      title: string;
      description: string;
      restoring: string;
      sessionNotReady: string;
      createSessionSuccess: string;
      generateSuccess: string;
      autoVerifyPassed: string;
      manualVerifyPassed: string;
      manualVerifyFailed: string;
      packageSuccess: string;
      flow: {
        title: string;
        subtitle: string;
        sessionConfig: string;
        pluginNamePlaceholder: string;
        descriptionPlaceholder: string;
        createSession: string;
        sessionStatus: string;
        uninitialized: string;
        actions: string;
        generate: string;
        autoVerify: string;
        manualPass: string;
        manualFail: string;
        package: string;
        download: string;
        manualNotePlaceholder: string;
        artifacts: string;
        demoImage: string;
        states: {
          draft: string;
          generated: string;
          autoVerified: string;
          manualVerified: string;
          packaged: string;
        };
      };
    };
    header: {
      expandSidebar: string;
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
    awaitingResponse: string;
  };

  scheduler: {
    taskManager: {
      reminderFallbackTitle: string;
      createTitle: string;
      taskNameLabel: string;
      triggerTypeLabel: string;
      triggerTypeInterval: string;
      triggerTypeOnce: string;
      triggerValueLabelCron: string;
      triggerValueLabelInterval: string;
      triggerValueLabelOnce: string;
      promptLabel: string;
      promptPlaceholder: string;
      createTask: string;
      creatingTask: string;
      taskListTitle: string;
      refresh: string;
      loading: string;
      noTasks: string;
      nextRunPrefix: string;
      runNow: string;
      deleteTask: string;
      historyTitle: string;
      historySelectHint: string;
      noHistory: string;
      startPrefix: string;
      endPrefix: string;
      errorPrefix: string;
      createValidation: string;
      invalidInterval: string;
      invalidScheduleTime: string;
      createSuccess: string;
      createFailed: string;
      deleteSuccess: string;
      deleteFailed: string;
      runSuccess: string;
      runFailed: string;
      status: {
        completed: string;
        running: string;
        failed: string;
        cancelled: string;
        pending: string;
      };
    };
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
      hostImportRequiredTitle: string;
      hostImportRequiredDescription: string;
      hostImportAction: string;
      hostImportUnavailable: string;
      hostImportSuccess: string;
      hostImportFailed: string;
      hostGrantRequired: string;
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
    discoverSources: string;
    discoverCategories: string;
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
    feedKeyboardHint: string;
    entryKeyboardHint: string;
    entryDetailKeyboardHint: string;
    filterAll: string;
    filterUnread: string;
    filterStarred: string;
    markRead: string;
    markUnread: string;
    statusRead: string;
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
    readabilityLoading: string;
    readabilityFailed: string;
    openOriginal: string;
    backToList: string;
    aiPanelTitle: string;
    aiPanelDescription: string;
    aiPanelBadge: string;
    aiWelcomeTitle: string;
    aiWelcomeDescription: string;
    aiContextEntry: string;
    aiContextFeed: string;
    aiContextEmpty: string;
    aiSendFailed: string;
    shortcutToggleAssistant: string;
    shortcutNewAssistantChat: string;
    shortcutCloseAssistant: string;
    quickPromptSummaryLabel: string;
    quickPromptSummaryPrompt: string;
    quickPromptTakeawayLabel: string;
    quickPromptTakeawayPrompt: string;
    quickPromptTranslateLabel: string;
    quickPromptTranslatePrompt: string;
    newAssistantChatLabel: string;
    aiSummaryCardDescription: string;
    openAssistant: string;
    aiPanelHeaderNewChat: string;
    aiPanelSubtitle: string;
    aiComposerPlaceholder: string;
    aiComposerSkill: string;
    aiComposerNoSkill: string;
    aiComposerTool: string;
    aiComposerNoTool: string;
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
    assistantInputShortcutHint: string;
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
    clarificationManualHint: string;
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
      sessionPolicy: string;
      memory: string;
      embedding: string;
      tools: string;
      channels: string;
      skills: string;
      notification: string;
      diagnostics: string;
      desktopRuntime: string;
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
      checkpointer: Record<string, any>;
      memory: Record<string, any>;
      models: Record<string, any>;
      rss: Record<string, any>;
      sandbox: Record<string, any>;
      suggestions: Record<string, any>;
      subagents: Record<string, any>;
      summarization: Record<string, any>;
      title: Record<string, any>;
      tools: Record<string, any>;
      [key: string]: Record<string, any>;
    };
    modelPage: Record<string, any>;
    channelPage: Record<string, any>;
    skillImportDialog: Record<string, any>;
    skillPage: Record<string, any>;
    toolPage: Record<string, any>;
    workbenchPluginsPage: Record<string, any>;
    memory: {
      title: string;
      description: string;
      scopeTitle: string;
      scopeDescription: string;
      empty: string;
      rawJson: string;
      hub: Record<string, string>;
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
    sessionPolicy: {
      title: string;
      description: string;
    };
    sandbox: {
      title: string;
      description: string;
    };
    diagnostics: {
      title: string;
      description: string;
      gatewayFacadeBadge: string;
      refresh: string;
      frontendTitle: string;
      frontendDescription: string;
      platformType: string;
      windowOrigin: string;
      backendBaseUrl: string;
      langgraphBaseUrl: string;
      gatewayTitle: string;
      gatewayDescription: string;
      loading: string;
      unavailable: string;
      runtimeMode: string;
      gatewayHost: string;
      gatewayPort: string;
      gatewayFacadePath: string;
      langgraphUpstream: string;
      frontendAllowedOrigins: string;
      corsRegex: string;
      browserShouldUseGatewayFacade: string;
      booleanTrue: string;
      booleanFalse: string;
    };
    desktopRuntime: {
      title: string;
      description: string;
      desktopOnlyHint: string;
      restartHint: string;
      configVersion: string;
      activePorts: string;
      frontendPortLabel: string;
      gatewayPortLabel: string;
      langgraphPortLabel: string;
      validationInteger: string;
      validationRange: string;
      validationDistinct: string;
      loadFailed: string;
      saveSuccess: string;
      saveFailed: string;
      reset: string;
      save: string;
      saving: string;
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
    aboutPage: {
      heroBadge: string;
      heroTitleLine1: string;
      heroTitleLine2: string;
      heroDescription: string;
      tags: {
        forUsers: string;
        transparent: string;
        iterative: string;
        evolving: string;
      };
      metrics: {
        lowBarrierLabel: string;
        lowBarrierValue: string;
        lowBarrierHint: string;
        responseModeLabel: string;
        responseModeValue: string;
        responseModeHint: string;
        deliveryLabel: string;
        deliveryValue: string;
        deliveryHint: string;
      };
      whyTitle: string;
      whyDescription: string;
      valueCards: {
        startTitle: string;
        startDescription: string;
        visibleTitle: string;
        visibleDescription: string;
        stableTitle: string;
        stableDescription: string;
      };
      scenariosTitle: string;
      scenarios: {
        dailyBriefTitle: string;
        dailyBriefDescription: string;
        writingTitle: string;
        writingDescription: string;
        automationTitle: string;
        automationDescription: string;
        decompositionTitle: string;
        decompositionDescription: string;
      };
      stepsTitle: string;
      steps: {
        step1Badge: string;
        step1Title: string;
        step1Description: string;
        step2Badge: string;
        step2Title: string;
        step2Description: string;
        step3Badge: string;
        step3Title: string;
        step3Description: string;
      };
      ctaTitle: string;
      ctaDescription: string;
      ctaBadge: string;
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
      noDescription: string;
      marketplaceInstallAction: string;
      marketplaceInstalling: string;
      marketplaceInstallSuccess: string;
      marketplaceInstallFailed: string;
      marketplaceEmpty: string;
      marketplaceDetailAction: string;
      marketplaceDetailTitle: string;
      marketplaceDetailEmpty: string;
      testPluginAction: string;
      pluginTestPassed: string;
      pluginTestFailed: string;
      pluginTestRunFailed: string;
      verified: string;
      unverified: string;
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
