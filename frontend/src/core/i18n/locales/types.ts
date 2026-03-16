import type { LucideIcon } from "lucide-react";

export interface Translations {
  migration: Record<string, Record<string, Record<string, string>>>;

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
    cliLabel: string;
    searchMcpTools: string;
    searchCliTools: string;
    noMcpTools: string;
    noCliTools: string;
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
    nameStepDisplayNameLabel: string;
    nameStepDisplayNamePlaceholder: string;
    nameStepSlugLabel: string;
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
    totalCount: string;
    statusDotHint: string;
    filterAll: string;
    filterDefault: string;
    filterHeartbeat: string;
    filterEvolution: string;
    viewMemory: string;
    noToolGroups: string;
    noMemoryOverview: string;
    memoryOverview: string;
    catalogSummary: string;
    heartbeatOn: string;
    heartbeatOff: string;
    evolutionOn: string;
    evolutionOff: string;
    status: {
      heartbeat: string;
      evolution: string;
      toolGroupsConfigured: string;
      toolGroupsEmpty: string;
    };
    avatar: {
      edit: string;
      title: string;
      hint: string;
      emptyHint: string;
      unsupportedType: string;
      loadFailed: string;
      pick: string;
      zoom: string;
      remove: string;
      apply: string;
      uploadSuccess: string;
      uploadFailed: string;
      deleteSuccess: string;
      deleteFailed: string;
    };
    picker: {
      selectAgent: string;
      defaultAgentName: string;
      defaultAgentDescription: string;
      defaultRole: string;
      noDescription: string;
      settingsTooltip: string;
    };
    settings: {
      pageTitle: string;
      tabs: {
        basic: string;
        memory: string;
        heartbeat: string;
        scheduler: string;
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
        itemCount: string;
        factCount: string;
      };
      basic: {
        title: string;
        saved: string;
        saveFailed: string;
        displayNameLabel: string;
        displayNamePlaceholder: string;
        displayNameHint: string;
        nameLabel: string;
        nameImmutableHint: string;
        descriptionLabel: string;
        descriptionPlaceholder: string;
        modelLabel: string;
        modelPlaceholder: string;
        modelDefaultOption: string;
        modelEmptyHint: string;
        modelLoadFailed: string;
        modelLegacyUnavailableOption: string;
        modelLegacyUnavailableHint: string;
        advancedTitle: string;
        toolGroupsLabel: string;
        toolGroupsPlaceholder: string;
        toolGroupsHint: string;
        heartbeatTitle: string;
        heartbeatDescription: string;
        evolutionTitle: string;
        evolutionDescription: string;
      };
      editor: {
        soulTitle: string;
        identityTitle: string;
        editMode: string;
        previewMode: string;
        previewEmpty: string;
        loadSoulFailed: string;
        loadIdentityFailed: string;
      };
      heartbeat: {
        title: string;
        conceptTitle: string;
        conceptDescription: string;
        conceptHint: string;
        enabledLabel: string;
        enabledDescription: string;
        timezoneLabel: string;
        governanceIntervalLabel: string;
        governanceIntervalHint: string;
        intervalOption: string;
        scopeTitle: string;
        scopeDescription: string;
        templatesLabel: string;
        templatesComingSoon: string;
        statusTitle: string;
        nextRunLabel: string;
        runNowLabel: string;
        runningLabel: string;
        saveSettings: string;
      };
      evolution: {
        title: string;
        conceptTitle: string;
        conceptDescription: string;
        conceptHint: string;
        enabledLabel: string;
        enabledDescription: string;
        intervalHoursLabel: string;
        intervalHoursHint: string;
        intervalOption: string;
        autoTriggerLabel: string;
        autoTriggerDescription: string;
        scopeTitle: string;
        scopeDescription: string;
        runNow: string;
        runningNow: string;
        runNowHint: string;
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
        heartbeatRunTriggered: string;
        evolutionSaved: string;
        evolutionRunTriggered: string;
        suggestionDismissed: string;
        suggestionAccepted: string;
      };
    };
  };

  // Breadcrumb
  breadcrumb: {
    workspace: string;
    chats: string;
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
      strictDisabled: string;
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
      newSession: string;
      publish: string;
      publishSuccess: string;
      progressHint: string;
      importedSourceHint: string;
      progress: {
        steps: {
          debugPlugin: string;
          collectRequirements: string;
          discussInteraction: string;
          pageDesign: string;
          generatePlugin: string;
        };
      };
      pluginPanel: {
        title: string;
        subtitle: string;
        empty: string;
        pluginIdLabel: string;
        sourceModeLabel: string;
        sourceModeImported: string;
        sourceModeScratch: string;
        noDescription: string;
        previewTitle: string;
        previewUnavailable: string;
        readmeTitle: string;
        readmeEmpty: string;
        demoTitle: string;
      };
      publishDialog: {
        title: string;
        description: string;
        versionLabel: string;
        versionPlaceholder: string;
        versionInvalid: string;
        versionNotGreater: string;
        pluginDescriptionLabel: string;
        pluginDescriptionPlaceholder: string;
        descriptionRequired: string;
        releaseNotesLabel: string;
        releaseNotesPlaceholder: string;
        releaseNotesRequired: string;
        downloadAfterPublish: string;
        downloadAfterPublishHint: string;
        cancel: string;
        confirm: string;
        publishing: string;
      };
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
    dashboard: {
      badge: string;
      title: string;
      description: string;
      relocatedTitle: string;
      relocatedDescription: string;
      metrics: {
        agentCount: string;
        agentCountHint: string;
        taskCount: string;
        taskCountHint: string;
        successRate: string;
        successRateHint: string;
        failedTaskCount: string;
        failedTaskCountHint: string;
      };
      agentsTitle: string;
      agentsDescription: string;
      cardDescription: string;
      taskCountBadge: string;
      successRateLabel: string;
      failedRunsLabel: string;
      openAgentSettings: string;
      emptyTitle: string;
      emptyDescription: string;
      recentTitle: string;
      recentDescription: string;
      recentEmpty: string;
      recentOpen: string;
      recentLastRun: string;
      recentNextRun: string;
      loading: string;
    };
    settings: {
      badge: string;
      title: string;
      description: string;
      timezoneBadge: string;
      createTask: string;
      taskListTitle: string;
      taskListDescription: string;
      nextRunPrefix: string;
      enabledLabel: string;
      disabledLabel: string;
      loading: string;
      emptyTitle: string;
      emptyDescription: string;
      historyTitle: string;
      historyEmptyHint: string;
      noHistory: string;
      historyStartPrefix: string;
      historyEndPrefix: string;
      historyErrorPrefix: string;
      metrics: {
        historyCount: string;
        successRate: string;
      };
      trigger: {
        cron: string;
        interval: string;
        once: string;
      };
      validation: {
        required: string;
        invalidInterval: string;
        invalidScheduleTime: string;
        invalidCron: string;
      };
      editor: {
        createTitle: string;
        createDescription: string;
        editTitle: string;
        editDescription: string;
        timezoneLabel: string;
        timezoneDescription: string;
        timezoneAction: string;
        nameLabel: string;
        namePlaceholder: string;
        triggerTypeLabel: string;
        triggerTypeCron: string;
        triggerTypeInterval: string;
        triggerTypeOnce: string;
        cronLabel: string;
        intervalLabel: string;
        onceLabel: string;
        promptLabel: string;
        promptPlaceholder: string;
        createAction: string;
        saveAction: string;
        creating: string;
        saving: string;
      };
      status: {
        completed: string;
        running: string;
        failed: string;
        cancelled: string;
        pending: string;
      };
      deleteDialogTitle: string;
      deleteDialogDescription: string;
      deleteDialogConfirm: string;
      toastCreateSuccess: string;
      toastUpdateSuccess: string;
      toastSaveFailed: string;
      toastEnabled: string;
      toastDisabled: string;
      toastRunSuccess: string;
      toastRunFailed: string;
      toastDeleteSuccess: string;
      toastDeleteFailed: string;
    };
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
      cliTools: string;
      searchSettings: string;
      mcpServers: string;
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
      saveBar: Record<string, string>;
      fieldTip: Record<string, string>;
      environmentVariables: Record<string, string>;
      checkpointer: Record<string, string>;
      memory: Record<string, string>;
      models: Record<string, string>;
      sandbox: Record<string, string>;
      suggestions: Record<string, string>;
      subagents: Record<string, string>;
      summarization: Record<string, string>;
      title: Record<string, string>;
      tools: Record<string, string>;
      [key: string]: Record<string, string>;
    };
    modelPage: Record<string, string>;
    channelPage: Record<string, string>;
    skillImportDialog: Record<string, string>;
    skillPage: Record<string, string>;
    toolPage: Record<string, string>;
    searchSettingsPage: Record<string, string>;
    mcpServersPage: Record<string, string>;
    workbenchPluginsPage: Record<string, string>;
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
    retrieval: {
      title: string;
      description: string;
      tabPacks: string;
      tabEmbedding: string;
      tabRerank: string;
      tabTesting: string;
      actionRefresh: string;
      packTitle: string;
      packAdvancedTitle: string;
      activePackHint: string;
      packNameZh: string;
      packNameEn: string;
      localModelsTitleEmbedding: string;
      localModelsTitleRerank: string;
      noModels: string;
      statusInstalled: string;
      statusNotInstalled: string;
      statusActive: string;
      statusConfiguredPending: string;
      configuredPendingHint: string;
      actionDownload: string;
      downloading: string;
      actionImport: string;
      actionDelete: string;
      packActionDownload: string;
      packActionDownloadAndEnable: string;
      packActionEnable: string;
      packActionDelete: string;
      packDownloadProgressTemplate: string;
      actionEnable: string;
      actionEnabled: string;
      setActiveSuccess: string;
      migrationSuccess: string;
      removeSuccess: string;
      packDownloadSuccess: string;
      packDownloadAndEnableSuccess: string;
      packDeleteSuccess: string;
      packDeleteActiveForbidden: string;
      packDeleteKeepOneRequired: string;
      packNormalizedHint: string;
      operationFailedPrefix: string;
      desktopOnlyHint: string;
      advancedTitle: string;
      providerDetailTitle: string;
      providerEmbeddingTitle: string;
      providerRerankTitle: string;
      providerProtocolOpenAI: string;
      providerProtocolRerank: string;
      providerApiKey: string;
      providerApiBase: string;
      providerModel: string;
      providerPath: string;
      providerModelList: string;
      providerDelete: string;
      providerDeleteSuccess: string;
      providerDeleteConfirmTitle: string;
      providerDeleteConfirmDescription: (name: string) => string;
      providerTestConnection: string;
      providerTesting: string;
      providerConnectionSuccess: string;
      testTitle: string;
      testQueryPlaceholder: string;
      testDocsPlaceholder: string;
      actionTestEmbedding: string;
      actionTestRerank: string;
      testEmpty: string;
      deleteConfirmTitle: string;
      deleteConfirmDescription: (name: string) => string;
      autoSwitchLocalSuccess: string;
      autoSwitchRemoteSuccess: string;
      autoSwitchFailed: string;
    };
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
      brand: {
        eyebrow: string;
        slogan: string;
        subline: string;
        masterClaim: string;
        ctaPrimary: string;
        ctaSecondary: string;
      };
      proofMetrics: {
        orchestrationLabel: string;
        orchestrationValue: string;
        orchestrationHint: string;
        memoryLabel: string;
        memoryValue: string;
        memoryHint: string;
        channelLabel: string;
        channelValue: string;
        channelHint: string;
      };
      messageHouse: {
        title: string;
        promise: string;
        pillars: {
          orchestration: string;
          memory: string;
          ecosystem: string;
          automation: string;
          safety: string;
        };
      };
      capabilitiesTitle: string;
      capabilitiesSubtitle: string;
      capabilities: {
        orchestrationTitle: string;
        orchestrationValue: string;
        orchestrationProof: string;
        memoryTitle: string;
        memoryValue: string;
        memoryProof: string;
        ecosystemTitle: string;
        ecosystemValue: string;
        ecosystemProof: string;
        automationTitle: string;
        automationValue: string;
        automationProof: string;
        channelsTitle: string;
        channelsValue: string;
        channelsProof: string;
      };
      trustTitle: string;
      trustSubtitle: string;
      trust: {
        runtimeTitle: string;
        runtimeDescription: string;
        runtimeProof: string;
        memoryTitle: string;
        memoryDescription: string;
        memoryProof: string;
        pluginTitle: string;
        pluginDescription: string;
        pluginProof: string;
        taskTitle: string;
        taskDescription: string;
        taskProof: string;
      };
      scenariosTitle: string;
      scenariosSubtitle: string;
      scenarios: {
        infoTitle: string;
        infoResult: string;
        infoPath: string;
        writingTitle: string;
        writingResult: string;
        writingPath: string;
        automationTitle: string;
        automationResult: string;
        automationPath: string;
        channelTitle: string;
        channelResult: string;
        channelPath: string;
      };
      ctaTitle: string;
      ctaDescription: string;
      ctaBadge: string;
      ctaPrimary: string;
      ctaSecondary: string;
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
      marketplaceUpdateAction: string;
      marketplaceInstalledAction: string;
      marketplaceInstalling: string;
      marketplaceInstallSuccess: string;
      marketplaceInstallFailed: string;
      marketplaceInstalled: string;
      marketplaceUpdateAvailable: string;
      marketplaceEmpty: string;
      marketplaceDetailAction: string;
      marketplaceDetailTitle: string;
      marketplaceDetailEmpty: string;
      debugPluginAction: string;
      testPluginAction: string;
      testPluginOpenAssistantSuccess: string;
      pluginTestPassed: string;
      pluginTestFailed: string;
      pluginTestRunFailed: string;
      installedState: string;
      downloadAction: string;
      pluginDownloadSuccess: string;
      pluginDownloadFailed: string;
      builtInState: string;
      uploadOverwriteTitle: string;
      uploadOverwriteDescription: string;
      uploadOverwriteConfirm: string;
      uploadDuplicateNameTitle: string;
      uploadDuplicateNameDescription: string;
      uploadDuplicateNameConfirm: string;
      uploadBuiltInNameConflict: string;
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
