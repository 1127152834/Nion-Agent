# Chat Module Migration Plan

## Overview

This plan covers the migration of advanced chat input features from the old project to the new Nion-Agent project, including:
- @ and / mention shortcuts for context, skills, and MCP tools
- Context and Skills buttons with tag display
- MCP tools selector dialog
- Workspace paths integration
- Recent models tracking
- **Workbench plugin system** for extensible artifact editors (NEW)

## Phase 0: Documentation Discovery

### Findings from Old Project (`Nion_old/frontend/src/components/workspace/input-box.tsx`)

**File Size**: 1832 lines (vs 678 lines in new project)

**Key Features Identified**:

1. **Mention System** (lines 93-360):
   - `MentionTrigger`: `"@" | "/"`
   - `MentionState`: tracks trigger, query, start, end positions
   - `MentionOption`: id, label, value, kind (file/directory/skill/mcp), description
   - Recent mentions stored in localStorage (`RECENT_MENTIONS_STORAGE_KEY`)
   - Keyboard shortcuts: `Cmd/Ctrl + @` and `Cmd/Ctrl + /`

2. **Mention Autocomplete UI** (lines 1180-1312):
   - Popup window positioned above input
   - Grouped options (Recent, Files, Directories, Skills, MCP)
   - Active item highlighting
   - Icons for each type (FolderIcon, FileIcon, SparklesIcon, WrenchIcon)
   - Keyboard hints footer (Tab, ↑↓, Enter, Esc)
   - Tab key switches between Context and MCP sources for @ trigger

3. **Context Button** (lines 1605-1612):
   - Button with @ icon and "Context" label
   - Inserts @ trigger on click
   - Selected contexts displayed as tags above footer

4. **Skills Button** (lines 1613-1620):
   - Button with SparklesIcon and "Skill" label
   - Inserts / trigger on click
   - Selected skills displayed as tags (lines 1313-1330)

5. **MCP Tools Selector** (lines 1621-1688):
   - Dropdown dialog with search input
   - Multi-select checkboxes
   - Badge showing selected count
   - Filtered options based on search query

6. **Workspace Paths** (line 371, 389):
   - `workspacePaths` prop: `string[]`
   - Used to build file/directory mention options
   - Path normalization utilities (lines 223-240)

7. **Recent Models** (lines 155-181, 1708-1724):
   - Stored in localStorage (`RECENT_MODELS_STORAGE_KEY`)
   - Displayed in separate group in model selector
   - Limited to 5 recent models

### Current New Project State

**Existing in new project**:
- Basic input box with mode selector
- Model selector
- Attachment button
- Suggestion list

**Missing from new project**:
- @ and / mention system
- Context and Skills buttons
- MCP tools selector
- Workspace paths integration
- Recent models tracking
- Selected tags display

## Phase 0.5: Workbench Plugin System (NEW)

### Goal
Create a pluggable workbench system that allows dynamic installation of artifact editors based on file type.

### Background

**Current Problem**: Old project has hardcoded artifact editors (ImageWorkbench, FrontendProjectExplorer, CodeEditor). Adding new editors (PPT, Document, Xiaohongshu) requires modifying core code.

**Solution**: Plugin-based workbench system where each editor is a self-contained `.nwp` package that can be installed/uninstalled dynamically.

### Architecture

```typescript
// Workbench Plugin Interface
interface WorkbenchPlugin {
  id: string;                          // 'ppt-editor' | 'image-editor'
  name: string;                        // Display name
  version: string;
  icon: LucideIcon;

  // File type matching (returns priority 0-100, or false)
  canHandle: (artifact: Artifact) => boolean | number;

  // Render workbench UI
  render: (context: WorkbenchContext) => ReactNode;

  // Lifecycle hooks
  onMount?(context: WorkbenchContext): void;
  onSave?(content: string): Promise<void>;
  onClose?(): void;
}

// Workbench Registry
class WorkbenchRegistry {
  register(plugin: WorkbenchPlugin): void;
  unregister(id: string): void;
  findBestMatch(artifact: Artifact): WorkbenchPlugin | null;
  findAllMatches(artifact: Artifact): WorkbenchPlugin[];
}
```

### Plugin Package Format (.nwp)

**Structure** (ZIP archive):
```
my-workbench.nwp
├── manifest.json          # Plugin metadata
├── index.tsx             # Entry component
├── components/           # Sub-components
├── assets/              # Icons, styles
└── README.md
```

**manifest.json**:
```json
{
  "id": "ppt-editor",
  "name": "PPT Editor",
  "version": "1.0.0",
  "description": "Professional PPT editing workbench",
  "author": "AI Generated",
  "icon": "assets/icon.png",
  "main": "index.tsx",

  "workbench": {
    "fileTypes": ["ppt", "pptx"],
    "mimeTypes": ["application/vnd.ms-powerpoint"],
    "priority": 90
  },

  "dependencies": {
    "react": "^19.0.0",
    "lucide-react": "^0.263.1"
  }
}
```

### Plugin SDK

```typescript
// @nion/workbench-sdk (built-in)

export interface WorkbenchContext {
  artifact: Artifact;
  threadId: string;

  // File operations (full permissions)
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  listFiles(dir: string): Promise<string[]>;

  // Network (full permissions)
  fetch(url: string, options?: RequestInit): Promise<Response>;

  // UI operations
  toast(message: string, type?: 'success' | 'error' | 'info'): void;
  dialog(options: DialogOptions): Promise<boolean>;
  addAction(action: WorkbenchAction): void;

  // Storage
  storage: {
    get(key: string): Promise<any>;
    set(key: string, value: any): Promise<void>;
    remove(key: string): Promise<void>;
  };
}
```

### Tasks

1. **Create plugin infrastructure** (`frontend/src/core/workbench/`):
   - `types.ts` - Plugin interfaces
   - `registry.ts` - WorkbenchRegistry class
   - `loader.ts` - Load and parse .nwp packages
   - `sdk.ts` - WorkbenchContext implementation
   - `worker.ts` - Web Worker isolation

2. **Create plugin management UI** (`frontend/src/components/workspace/settings/workbench-plugins-page.tsx`):
   - Installed plugins list (enable/disable/uninstall)
   - Plugin marketplace (browse/install)
   - Upload plugin (.nwp file)
   - Skill-based plugin creation (NEW feature)

3. **Refactor artifact-file-detail.tsx**:
   - Replace hardcoded conditionals with plugin system
   - Use `WorkbenchRegistry.findBestMatch(artifact)`
   - Support multiple workbenches per file type
   - Add workbench switcher UI

4. **Migrate existing workbenches to plugins**:
   - ImageWorkbench → `image-editor.nwp`
   - CodeEditor → `code-editor.nwp`
   - FrontendProjectExplorer → `frontend-project.nwp`
   - Package as .nwp and register as built-in plugins

5. **Implement Skill-based plugin creation**:
   - Add `/create-workbench` skill command
   - AI generates plugin code (manifest + components)
   - Auto-package as .nwp
   - Provide install/upload options

6. **Add plugin marketplace backend** (optional):
   - API endpoints for plugin listing
   - Upload/download plugins
   - Version management

### Plugin Lifecycle

```
Installation:
1. Upload .nwp file (or install from marketplace)
2. Extract to ~/.nion/workbench-plugins/{plugin-id}/
3. Validate manifest.json
4. Register to WorkbenchRegistry
5. Show in installed plugins list

Runtime:
1. User opens artifact
2. WorkbenchRegistry.findBestMatch(artifact)
3. Load plugin in Web Worker
4. Render plugin UI
5. Handle user interactions

Uninstallation:
1. Remove from WorkbenchRegistry
2. Delete plugin files
3. Clean up plugin data
```

### Security & Isolation

- **Full permissions**: All plugins have complete access (no permission system)
- **Web Worker isolation**: Plugins run in separate workers for stability
- **No code review**: Plugins are not reviewed before installation

### Built-in Plugins (Future)

After migration, create these official plugins:
- `document-editor.nwp` - Markdown/Word documents
- `ppt-editor.nwp` - PowerPoint presentations
- `xiaohongshu-editor.nwp` - Xiaohongshu post editor
- `video-player.nwp` - Video playback
- `3d-viewer.nwp` - 3D model viewer

### Documentation References
- Old project artifacts: `Nion_old/frontend/src/components/workspace/artifacts/`
- ImageWorkbench: `image-workbench.tsx` (21KB)
- FrontendProjectExplorer: `frontend-project-explorer.tsx` (63KB)
- artifact-file-detail: `artifact-file-detail.tsx` (14KB)

### Verification
- [ ] WorkbenchRegistry implemented
- [ ] Plugin loader parses .nwp packages
- [ ] Web Worker isolation works
- [ ] Plugin management UI functional
- [ ] Existing workbenches migrated to plugins
- [ ] Skill-based plugin creation works
- [ ] Multiple workbenches per file type supported

---

## Phase 1: Mention System Foundation

### Goal
Implement core mention detection, state management, and option building.

### Tasks

1. **Add mention types and interfaces** to `input-box.tsx`:
   ```typescript
   type MentionTrigger = "@" | "/";
   type MentionAtSource = "context" | "mcp";

   interface MentionOption {
     id: string;
     label: string;
     value: string;
     kind: "file" | "directory" | "skill" | "mcp";
     description?: string;
   }

   interface MentionState {
     trigger: MentionTrigger;
     query: string;
     start: number;
     end: number;
   }

   interface SelectedContextTag {
     value: string;
     kind: "file" | "directory";
   }

   interface RecentMentionsState {
     "@": string[];
     "/": string[];
   }
   ```

2. **Copy utility functions** from old project (lines 223-360):
   - `normalizePath()`, `basename()`, `dirname()`
   - `buildPathMentionOptions()`
   - `resolveMentionState()`
   - `rankMentionOption()`
   - `removeLooseMentionTriggers()`
   - `readRecentMentions()`, `writeRecentMentions()`

3. **Add state management**:
   ```typescript
   const [mentionState, setMentionState] = useState<MentionState | null>(null);
   const [mentionAtSource, setMentionAtSource] = useState<MentionAtSource>("context");
   const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
   const [selectedContexts, setSelectedContexts] = useState<SelectedContextTag[]>([]);
   const [selectedMcpTools, setSelectedMcpTools] = useState<string[]>([]);
   const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
   const [recentMentions, setRecentMentions] = useState<RecentMentionsState>({
     "@": [],
     "/": [],
   });
   ```

4. **Build mention options** using existing hooks:
   - `fileMentionOptions` from `workspacePaths` prop
   - `skillMentionOptions` from `useSkills()` hook
   - `mcpMentionOptions` from `useMCPConfig()` hook

### Documentation References
- Old project: `Nion_old/frontend/src/components/workspace/input-box.tsx:93-360`
- Copy patterns from lines 242-293 (buildPathMentionOptions)
- Copy patterns from lines 460-483 (skill and MCP options)

### Verification
- [ ] Mention state updates on @ or / input
- [ ] Mention options built correctly from workspace paths, skills, MCP
- [ ] Recent mentions persist in localStorage

## Phase 2: Mention Autocomplete UI

### Goal
Implement the mention popup with keyboard navigation and option rendering.

### Tasks

1. **Create mention popup component** (copy from lines 1180-1312):
   - Position above input using absolute positioning
   - Show only when `mentionState` is not null
   - Display grouped options with headers
   - Highlight active option based on `mentionActiveIndex`

2. **Implement keyboard navigation** (copy from lines 905-968):
   - `handleMentionKeyDown()` function
   - Arrow Up/Down: navigate options
   - Enter/Tab: select active option
   - Escape: close popup
   - Tab (@ trigger only): switch between Context and MCP sources
   - Cmd/Ctrl + @: insert @ trigger
   - Cmd/Ctrl + /: insert / trigger

3. **Implement option selection** (copy from lines 826-871):
   - `applyMentionOption()` function
   - Remove trigger from input
   - Add to selected contexts/skills/MCP tools
   - Update recent mentions
   - Focus textarea and restore caret position

4. **Add source switcher for @ trigger** (lines 1192-1216):
   - Toggle buttons for "Context" and "MCP"
   - Only show when `mentionState.trigger === "@"`
   - Update `mentionAtSource` state

5. **Render option icons**:
   - FolderIcon for directories
   - FileIcon for files
   - SparklesIcon for skills
   - WrenchIcon for MCP tools

6. **Add keyboard hints footer** (lines 1286-1309):
   - Show Tab, ↑↓, Enter, Esc keys
   - Localized labels

### Documentation References
- Old project: `Nion_old/frontend/src/components/workspace/input-box.tsx:1180-1312`
- Keyboard handling: lines 905-968
- Option application: lines 826-871

### Verification
- [ ] Popup appears on @ or / input
- [ ] Arrow keys navigate options
- [ ] Enter selects option
- [ ] Tab switches Context/MCP for @
- [ ] Escape closes popup
- [ ] Cmd/Ctrl + @ and / shortcuts work

## Phase 3: Context and Skills Buttons

### Goal
Add @ Context and / Skills buttons to input footer with tag display.

### Tasks

1. **Add Context button** (copy from lines 1605-1612):
   ```typescript
   <PromptInputButton
     className="gap-1! px-2! text-xs"
     onClick={() => insertMentionTrigger("@")}
     disabled={disabled}
   >
     <span>@</span>
     <span>{t.migration.workspace?.inputBox?.contextLabel ?? "Context"}</span>
   </PromptInputButton>
   ```

2. **Add Skills button** (copy from lines 1613-1620):
   ```typescript
   <PromptInputButton
     className="gap-1! px-2! text-xs"
     onClick={() => insertMentionTrigger("/")}
     disabled={disabled}
   >
     <SparklesIcon className="size-3" />
     <span>{t.migration.workspace?.inputBox?.skillLabel ?? "Skill"}</span>
   </PromptInputButton>
   ```

3. **Implement `insertMentionTrigger()`** (copy from lines 880-903):
   - Insert trigger at caret position
   - Add leading space if needed
   - Focus textarea and set caret position

4. **Add selected contexts tags** (copy from lines 1313-1330):
   - Display above footer when `selectedContexts.length > 0`
   - Show file/directory icon
   - Show path/name
   - X button to remove

5. **Add selected skills tags** (similar pattern):
   - Display above footer when `selectedSkills.length > 0`
   - Show SparklesIcon
   - Show skill name
   - X button to remove

6. **Add tag removal handlers**:
   ```typescript
   const removeSelectedContext = useCallback((value: string) => {
     setSelectedContexts((prev) => prev.filter((item) => item.value !== value));
   }, []);

   const removeSelectedSkill = useCallback((value: string) => {
     setSelectedSkills((prev) => prev.filter((item) => item !== value));
   }, []);
   ```

### Documentation References
- Old project buttons: lines 1605-1620
- Tags display: lines 1313-1330
- Insert trigger: lines 880-903

### Verification
- [ ] @ Context button inserts @ trigger
- [ ] / Skills button inserts / trigger
- [ ] Selected contexts display as tags
- [ ] Selected skills display as tags
- [ ] X button removes tags

## Phase 4: MCP Tools Selector

### Goal
Implement MCP tools multi-select dropdown dialog.

### Tasks

1. **Add MCP selector state**:
   ```typescript
   const [mcpSelectorOpen, setMcpSelectorOpen] = useState(false);
   const [mcpSelectorQuery, setMcpSelectorQuery] = useState("");
   ```

2. **Create MCP button with badge** (copy from lines 1621-1643):
   ```typescript
   <DropdownMenu
     open={mcpSelectorOpen}
     onOpenChange={(open) => {
       setMcpSelectorOpen(open);
       if (!open) setMcpSelectorQuery("");
     }}
   >
     <DropdownMenuTrigger asChild>
       <PromptInputButton className="gap-1! px-2! text-xs" disabled={disabled}>
         <WrenchIcon className="size-3" />
         <span>MCP</span>
         {selectedMcpTools.length > 0 && (
           <span className="bg-foreground text-background inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-semibold">
             {selectedMcpTools.length}
           </span>
         )}
       </PromptInputButton>
     </DropdownMenuTrigger>
   </DropdownMenu>
   ```

3. **Create dropdown content** (copy from lines 1644-1688):
   - Search input at top
   - Scrollable list of checkboxes
   - Show "No MCP tools found" when filtered list is empty
   - Each item shows label and description

4. **Implement filtered options** (copy from lines 485-499):
   ```typescript
   const filteredMcpOptions = useMemo(() => {
     const normalizedQuery = mcpSelectorQuery.trim().toLowerCase();
     return mcpMentionOptions
       .map((option) => ({
         option,
         score: rankMentionOption(option, normalizedQuery),
       }))
       .filter((item) => item.score > 0 || !normalizedQuery)
       .sort((a, b) => {
         if (a.score !== b.score) return b.score - a.score;
         return a.option.value.localeCompare(b.option.value);
       })
       .map((item) => item.option);
   }, [mcpSelectorQuery, mcpMentionOptions]);
   ```

5. **Add toggle handler**:
   ```typescript
   const toggleSelectedMcpTool = useCallback((value: string, enabled: boolean) => {
     if (enabled) {
       setSelectedMcpTools((prev) => [...prev, value]);
     } else {
       setSelectedMcpTools((prev) => prev.filter((item) => item !== value));
     }
   }, []);
   ```

### Documentation References
- Old project: lines 1621-1688
- Filtered options: lines 485-499

### Verification
- [ ] MCP button opens dropdown
- [ ] Search filters options
- [ ] Checkboxes toggle selection
- [ ] Badge shows selected count
- [ ] Selected MCP tools persist

## Phase 5: Workspace Paths Integration

### Goal
Add workspace paths prop and integrate with mention system.

### Tasks

1. **Add `workspacePaths` prop** to InputBox:
   ```typescript
   workspacePaths?: string[];
   ```

2. **Build file mention options** (copy from lines 456-459):
   ```typescript
   const fileMentionOptions = useMemo(
     () => buildPathMentionOptions(workspacePaths),
     [workspacePaths],
   );
   ```

3. **Update parent component** to pass workspace paths:
   - Determine source of workspace paths (backend API or context)
   - Pass to InputBox component

4. **Ensure path utilities are working**:
   - Test `normalizePath()`, `basename()`, `dirname()`
   - Test `buildPathMentionOptions()` with sample paths

### Documentation References
- Old project prop: line 371, 389
- Build options: lines 456-459
- Path utilities: lines 223-293

### Verification
- [ ] workspacePaths prop accepted
- [ ] File/directory options built correctly
- [ ] @ trigger shows file/directory options
- [ ] Selected paths display as tags

## Phase 6: Recent Models Tracking

### Goal
Track recently used models and display in model selector.

### Tasks

1. **Add constants**:
   ```typescript
   const RECENT_MODELS_STORAGE_KEY = "nion:recent-models";
   const RECENT_MODELS_LIMIT = 5;
   ```

2. **Copy localStorage functions** (lines 155-181):
   ```typescript
   function readRecentModels(): string[] { ... }
   function writeRecentModels(models: string[]): void { ... }
   ```

3. **Add state**:
   ```typescript
   const [recentModelNames, setRecentModelNames] = useState<string[]>([]);

   useEffect(() => {
     setRecentModelNames(readRecentModels());
   }, []);
   ```

4. **Build recent and remaining models** (lines 436-455):
   ```typescript
   const recentModels = useMemo(() =>
     recentModelNames
       .filter((name) => modelNamesSet.has(name))
       .map((name) => models.find((model) => model.name === name))
       .filter((model): model is Model => Boolean(model)),
     [modelNamesSet, models, recentModelNames],
   );

   const remainingModels = useMemo(
     () => models.filter((model) => !recentNameSet.has(model.name)),
     [models, recentNameSet],
   );
   ```

5. **Update model selector** (lines 1708-1724):
   - Add `ModelSelectorGroup` for recent models
   - Add `ModelSelectorSeparator` between groups
   - Add heading "Recent Models" and "All Models"

6. **Update recent models on selection**:
   ```typescript
   const handleModelSelect = useCallback((model_name: string) => {
     // ... existing logic ...

     // Update recent models
     const updated = [model_name, ...recentModelNames.filter(n => n !== model_name)]
       .slice(0, RECENT_MODELS_LIMIT);
     setRecentModelNames(updated);
     writeRecentModels(updated);
   }, [/* deps */]);
   ```

### Documentation References
- Old project: lines 155-181 (localStorage), 436-455 (build lists), 1708-1724 (UI)

### Verification
- [ ] Recent models persist in localStorage
- [ ] Recent models group shows in selector
- [ ] Selecting model updates recent list
- [ ] Limited to 5 recent models

## Phase 7: Internationalization and Styling

### Goal
Add i18n translations and ensure consistent styling.

### Tasks

1. **Add translations** to `zh-CN.ts` and `en-US.ts`:
   ```typescript
   migration: {
     workspace: {
       inputBox: {
         contextLabel: "Context",
         contextLabelZh: "上下文",
         skillLabel: "Skill",
         skillLabelZh: "技能",
         mcpToolsMulti: "MCP tools (multi-select)",
         mcpToolsMultiZh: "MCP 工具（多选）",
         searchMcpPlaceholder: "Search MCP tools...",
         searchMcpPlaceholderZh: "搜索 MCP 工具...",
         noMcpToolsFound: "No MCP tools found",
         noMcpToolsFoundZh: "未找到 MCP 工具",
         noMatches: "No matches",
         noMatchesZh: "无匹配项",
         switchLabel: "Switch",
         switchLabelZh: "切换",
         completeLabel: "Complete",
         completeLabelZh: "完成",
         navigateLabel: "Navigate",
         navigateLabelZh: "导航",
         selectLabel: "Select",
         selectLabelZh: "选择",
         closeLabel: "Close",
         closeLabelZh: "关闭",
         recentModels: "Recent Models",
         allModels: "All Models",
         noModelsFound: "No models found",
       },
     },
   },
   ```

2. **Update types.ts** to include migration types.

3. **Review and adjust styling**:
   - Ensure mention popup matches design system
   - Ensure tags match existing tag styles
   - Ensure buttons match existing button styles
   - Test dark mode compatibility

4. **Add responsive behavior**:
   - Test on different screen sizes
   - Ensure popup doesn't overflow viewport

### Documentation References
- Old project i18n usage: lines 401-403, 481, 1611, 1619, etc.

### Verification
- [ ] All labels translated
- [ ] Chinese translations work
- [ ] Styling consistent with design system
- [ ] Dark mode works
- [ ] Responsive on mobile

## Final Phase: Integration and Verification

### Goal
Integrate all features and verify complete functionality.

### Tasks

1. **Integration testing**:
   - Test @ trigger → select file → tag appears → submit message
   - Test / trigger → select skill → tag appears → submit message
   - Test MCP selector → select tools → badge updates
   - Test keyboard shortcuts (Cmd/Ctrl + @, Cmd/Ctrl + /)
   - Test keyboard navigation in mention popup
   - Test Tab switching between Context and MCP
   - Test recent models display and update

2. **Edge cases**:
   - Empty workspace paths
   - No skills available
   - No MCP servers configured
   - Long file paths (truncation)
   - Many selected tags (overflow)
   - Rapid typing while mention popup open

3. **Performance**:
   - Mention popup renders quickly
   - Filtering large option lists is smooth
   - No unnecessary re-renders

4. **Accessibility**:
   - Keyboard navigation works without mouse
   - Screen reader announces mention options
   - Focus management is correct

### Verification Checklist

**Mention System**:
- [ ] @ trigger detects correctly
- [ ] / trigger detects correctly
- [ ] Cmd/Ctrl + @ inserts @ trigger
- [ ] Cmd/Ctrl + / inserts / trigger
- [ ] Mention state updates on input
- [ ] Recent mentions persist

**Mention Popup**:
- [ ] Popup appears on trigger
- [ ] Options grouped correctly
- [ ] Arrow keys navigate
- [ ] Enter selects option
- [ ] Tab switches Context/MCP for @
- [ ] Tab completes for /
- [ ] Escape closes popup
- [ ] Icons display correctly
- [ ] Keyboard hints show

**Buttons and Tags**:
- [ ] @ Context button works
- [ ] / Skills button works
- [ ] MCP button opens dialog
- [ ] Selected contexts show as tags
- [ ] Selected skills show as tags
- [ ] MCP badge shows count
- [ ] X button removes tags

**MCP Selector**:
- [ ] Dialog opens/closes
- [ ] Search filters options
- [ ] Checkboxes toggle
- [ ] Selected tools persist
- [ ] Empty state shows

**Workspace Paths**:
- [ ] Paths prop accepted
- [ ] File options built
- [ ] Directory options built
- [ ] Paths display correctly

**Recent Models**:
- [ ] Recent group shows
- [ ] Selecting updates list
- [ ] Limited to 5 models
- [ ] Persists in localStorage

**I18n and Styling**:
- [ ] All labels translated
- [ ] Chinese works
- [ ] Styling consistent
- [ ] Dark mode works
- [ ] Responsive

## Implementation Notes

### Anti-Patterns to Avoid
- Do NOT invent new APIs - copy exact patterns from old project
- Do NOT skip verification steps
- Do NOT assume structure without checking examples
- Do NOT transform existing code - copy and adapt from old project

### Key Dependencies
- `useSkills()` hook from `@/core/skills/hooks`
- `useMCPConfig()` hook from `@/core/mcp/hooks`
- `usePromptInputController()` from `@/components/ai-elements/prompt-input`
- `useI18n()` hook from `@/core/i18n/hooks`

### File Locations
- Main component: `frontend/src/components/workspace/input-box.tsx`
- I18n: `frontend/src/core/i18n/locales/{zh-CN,en-US}.ts`
- Types: `frontend/src/core/i18n/locales/types.ts`

## Execution Strategy

Execute phases sequentially. Each phase must be completed and verified before moving to the next. Use the verification checklist to confirm completion.

For each phase:
1. Read the referenced old project code sections
2. Copy and adapt the patterns (do not reinvent)
3. Test the implementation
4. Check off verification items
5. Commit changes before moving to next phase

Estimated total implementation time: 6-8 hours across all phases.
