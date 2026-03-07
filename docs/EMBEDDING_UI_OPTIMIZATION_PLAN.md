# Embedding Settings UI Optimization Plan

## Overview

Optimize the embedding settings UI (`frontend/src/components/workspace/settings/embedding-settings-page.tsx`) by adopting design patterns from the old project's retrieval settings page (`Nion_old/frontend/src/components/workspace/settings/retrieval-settings-page.tsx`).

**Reference**: `/Users/zhangtiancheng/Documents/项目/新项目/Nion_old/frontend/src/components/workspace/settings/retrieval-settings-page.tsx` (1450 lines)

## Current Issues

1. **Basic Layout**: Simple RadioGroup + Tabs lacks visual hierarchy
2. **No Model Management**: Missing model cards, download, installation features
3. **Limited Provider Config**: Basic form inputs without advanced features
4. **No Testing Interface**: Missing testing functionality
5. **Poor Visual Design**: Lacks polished look and consistent styling
6. **No Status Display**: Missing current status and error handling
7. **Limited Feedback**: No toast notifications or comprehensive loading states
8. **No Desktop Integration**: Missing desktop bridge features

## Phase 1: Core UI Structure Enhancement

### 1.1 Layout Improvements

**Current**: Basic form with RadioGroup and Tabs
**Target**: Professional layout with SettingsSection wrapper, status header, and organized sections

**Implementation**:
```tsx
// Add status header with refresh button
<div className="flex flex-wrap items-center justify-between gap-2">
  <Tabs value={activeTab} onValueChange={setActiveTab}>
    <TabsList variant="line">
      <TabsTrigger value="local">Local Models</TabsTrigger>
      <TabsTrigger value="openai">OpenAI</TabsTrigger>
      <TabsTrigger value="custom">Custom</TabsTrigger>
      <TabsTrigger value="testing">Testing</TabsTrigger>
    </TabsList>
  </Tabs>
  <div className="flex items-center gap-2">
    {statusError && <Badge variant="destructive">{statusError}</Badge>}
    <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
      {loading ? <Loader2Icon className="mr-1 size-4 animate-spin" /> : <RefreshCwIcon className="mr-1 size-4" />}
      Refresh
    </Button>
  </div>
</div>
```

**Files to modify**:
- `frontend/src/components/workspace/settings/embedding-settings-page.tsx`

### 1.2 Visual Design System

**Apply consistent styling**:
- Rounded borders: `rounded-lg`, `rounded-xl`, `rounded-md`
- Spacing: `space-y-3`, `space-y-4`, `gap-2`, `gap-3`
- Grid layouts: `grid gap-3 md:grid-cols-2`
- Section containers: `rounded-lg border p-4`

**Example section structure**:
```tsx
<section className="space-y-3 rounded-lg border p-4">
  <div className="text-sm font-medium">Local Models</div>
  {/* Content */}
</section>
```

## Phase 2: Model Management UI

### 2.1 Model Cards Component

**Create rich model cards** with:
- Display name (bold, larger font)
- Model ID, size, locale, license (smaller, muted text)
- Status badges (Installed, Active, Configured)
- Action buttons (Download, Enable, Delete)
- Progress tracking

**Implementation**:
```tsx
const renderModelCard = (model: EmbeddingModel) => (
  <div key={model.id} className="space-y-3 rounded-md border p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <div className="text-sm font-semibold">{model.displayName}</div>
        <div className="text-muted-foreground text-xs">
          {model.id} · {formatSize(model.size)}
          {model.locale && ` · ${model.locale}`}
          {model.license && ` · ${model.license}`}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant={model.installed ? "default" : "secondary"}>
          {model.installed ? "Installed" : "Not Installed"}
        </Badge>
        {model.isActive && <Badge variant="outline">Active</Badge>}
      </div>
    </div>

    {/* Progress display */}
    {progress[model.id] && (
      <div className="text-muted-foreground text-xs">{progress[model.id]}</div>
    )}

    {/* Action buttons */}
    <div className="flex flex-wrap gap-2">
      {!model.installed ? (
        <Button size="sm" variant="outline" onClick={() => handleDownload(model.id)}>
          <DownloadIcon className="mr-1 size-4" />
          Download
        </Button>
      ) : model.isActive ? (
        <Button size="sm" disabled>Enabled</Button>
      ) : (
        <Button size="sm" onClick={() => handleEnable(model.id)}>
          Enable
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => handleDelete(model.id)} disabled={!model.installed}>
        <Trash2Icon className="mr-1 size-4" />
        Delete
      </Button>
    </div>
  </div>
);
```

### 2.2 Desktop Bridge Integration

**Add desktop-specific features**:
- Model download with progress tracking
- Model import from local files
- Model removal
- Progress callbacks for real-time updates

**Implementation**:
```tsx
// Desktop bridge detection
const desktopBridge = useMemo(() => {
  if (typeof window === "undefined") return null;
  const bridge = (window as any).neoDesktop;
  return bridge && typeof bridge === "object" ? bridge : null;
}, []);

// Progress tracking
useEffect(() => {
  if (!desktopBridge?.onEmbeddingModelDownloadProgress) return;

  const unsubscribe = desktopBridge.onEmbeddingModelDownloadProgress((payload: any) => {
    const { modelId, status, downloadedBytes, totalBytes, message } = payload;
    setProgress(prev => ({
      ...prev,
      [modelId]: `${status} ${formatSize(downloadedBytes)}/${formatSize(totalBytes)} ${message}`
    }));
  });

  return () => typeof unsubscribe === "function" && unsubscribe();
}, [desktopBridge]);
```

## Phase 3: Advanced Provider Configuration

### 3.1 Collapsible Advanced Section

**Add collapsible section** for provider configuration:

```tsx
<Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
  <CollapsibleTrigger asChild>
    <Button variant="ghost" size="sm">
      <ChevronDownIcon className={`mr-1 size-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
      Advanced Configuration
    </Button>
  </CollapsibleTrigger>
  <CollapsibleContent className="pt-2">
    {renderProviderConfig()}
  </CollapsibleContent>
</Collapsible>
```

### 3.2 Provider Configuration Card

**Enhanced provider configuration** with:
- Title and protocol badge
- Grid layout for responsive design
- API key with show/hide toggle
- Model suggestions
- Test connection functionality
- Delete provider option

**Implementation**:
```tsx
const renderProviderConfig = () => (
  <div className="space-y-4 rounded-xl border p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="space-y-1">
        <div className="text-base font-semibold">Provider Configuration</div>
        <div className="text-muted-foreground text-sm">OpenAI-compatible API</div>
      </div>
      <Badge variant="secondary" className="rounded-full border px-2.5 py-1 text-xs font-medium">
        OpenAI Compatible
      </Badge>
    </div>

    <div className="grid gap-3 md:grid-cols-2">
      {/* API Key with show/hide */}
      <div className="space-y-1.5">
        <div className="text-sm font-medium">API Key</div>
        <div className="relative">
          <Input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="$OPENAI_API_KEY"
            type={showApiKey ? "text" : "password"}
            className="pr-10"
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="absolute top-1/2 right-1 -translate-y-1/2"
            onClick={() => setShowApiKey(!showApiKey)}
          >
            {showApiKey ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </Button>
        </div>
      </div>

      {/* API Base */}
      <div className="space-y-1.5">
        <div className="text-sm font-medium">API Base</div>
        <Input
          value={apiBase}
          onChange={(e) => setApiBase(e.target.value)}
          placeholder="https://api.openai.com/v1"
        />
      </div>

      {/* Model */}
      <div className="space-y-1.5">
        <div className="text-sm font-medium">Model</div>
        <Input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="text-embedding-3-small"
        />
      </div>

      {/* Dimension */}
      <div className="space-y-1.5">
        <div className="text-sm font-medium">Dimension</div>
        <Input
          type="number"
          value={dimension}
          onChange={(e) => setDimension(e.target.value)}
          placeholder="1536"
        />
      </div>
    </div>

    {/* Action buttons */}
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={handleTestConnection}>
        {testing ? <Loader2Icon className="mr-1 size-4 animate-spin" /> : null}
        Test Connection
      </Button>
      <Button size="sm" variant="outline" onClick={() => setShowModels(!showModels)}>
        Model Suggestions
      </Button>
      <Button size="sm" variant="ghost" className="text-rose-600 hover:text-rose-600" onClick={handleDeleteProvider}>
        <Trash2Icon className="mr-1 size-4" />
        Delete Provider
      </Button>
      <Button size="sm" variant={enabled ? "default" : "outline"} onClick={() => setEnabled(!enabled)}>
        {enabled ? "Enabled" : "Enable"}
      </Button>
    </div>

    {/* Model suggestions */}
    {showModels && (
      <div className="bg-muted/40 space-y-2 rounded-md border p-3">
        <div className="text-xs font-medium">Suggested Models</div>
        <div className="flex flex-wrap gap-2">
          {["text-embedding-3-small", "text-embedding-3-large", "bge-m3", "jina-embeddings-v3"].map(suggestion => (
            <Button key={suggestion} size="sm" variant="outline" onClick={() => setModel(suggestion)}>
              {suggestion}
            </Button>
          ))}
        </div>
      </div>
    )}
  </div>
);
```

## Phase 4: Testing Interface

### 4.1 Testing Tab

**Add dedicated testing tab** with:
- Test query input
- Test documents textarea
- Test embedding button
- Result display in pre-formatted code block

**Implementation**:
```tsx
{activeTab === "testing" && (
  <section className="space-y-3 rounded-lg border p-4">
    <div className="text-sm font-medium">Test Embedding</div>

    <div className="space-y-2">
      <Input
        value={testQuery}
        onChange={(e) => setTestQuery(e.target.value)}
        placeholder="Enter test query..."
      />
      <Textarea
        value={testDocs}
        onChange={(e) => setTestDocs(e.target.value)}
        rows={4}
        placeholder="Enter test documents (one per line)..."
      />
    </div>

    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={testBusy} onClick={handleTestEmbedding}>
        {testBusy && <Loader2Icon className="mr-1 size-4 animate-spin" />}
        Test Embedding
      </Button>
    </div>

    <pre className="bg-muted min-h-24 max-h-80 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
      {testResult || "Test results will appear here..."}
    </pre>
  </section>
)}
```

## Phase 5: State Management & User Experience

### 5.1 Enhanced State Management

**Add comprehensive state variables**:
```tsx
const [activeTab, setActiveTab] = useState<"local" | "openai" | "custom" | "testing">("local");
const [statusLoading, setStatusLoading] = useState(false);
const [statusError, setStatusError] = useState<string | null>(null);
const [activeAction, setActiveAction] = useState("");
const [advancedOpen, setAdvancedOpen] = useState(false);
const [showApiKey, setShowApiKey] = useState(false);
const [showModels, setShowModels] = useState(false);
const [progress, setProgress] = useState<Record<string, string>>({});
const [testQuery, setTestQuery] = useState("Test embedding quality");
const [testDocs, setTestDocs] = useState("Doc A: Sample text\nDoc B: Another sample");
const [testResult, setTestResult] = useState("");
const [testBusy, setTestBusy] = useState(false);
const [pendingDelete, setPendingDelete] = useState<{ modelId: string; displayName: string } | null>(null);
```

### 5.2 Toast Notifications

**Add toast notifications** for all operations:
```tsx
import { toast } from "sonner";

// Success
toast.success("Model enabled successfully");

// Error
toast.error(`Operation failed: ${error.message}`);

// Info
toast.info("Downloading model...");
```

### 5.3 Confirmation Dialogs

**Add confirmation dialogs** for destructive actions:
```tsx
<ConfirmActionDialog
  open={pendingDelete !== null}
  onOpenChange={(open) => !open && setPendingDelete(null)}
  title="Delete Model"
  description={`Are you sure you want to delete ${pendingDelete?.displayName}?`}
  cancelText="Cancel"
  confirmText="Delete"
  onConfirm={handleConfirmDelete}
/>
```

## Phase 6: API Integration

### 6.1 Status Loading

**Load embedding models status**:
```tsx
const loadStatus = async () => {
  setStatusLoading(true);
  setStatusError(null);
  try {
    const response = await loadEmbeddingModelsStatus();
    setStatusResponse(response);
  } catch (err) {
    setStatusError(err instanceof Error ? err.message : String(err));
  } finally {
    setStatusLoading(false);
  }
};

useEffect(() => {
  void loadStatus();
}, []);
```

### 6.2 Test Connection

**Test provider connection**:
```tsx
const handleTestConnection = async () => {
  const saved = await onSave();
  if (!saved) return;

  setTesting(true);
  try {
    const response = await testEmbeddingProviderConnection({
      provider: "openai_compatible",
      model: model.trim() || undefined,
    });
    if (response.status !== "ok") {
      throw new Error(response.error_code ?? "connection_failed");
    }
    toast.success("Connection successful");
    setTestResult(JSON.stringify(response, null, 2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toast.error(`Connection failed: ${message}`);
    setTestResult(`Error: ${message}`);
  } finally {
    setTesting(false);
  }
};
```

## Phase 7: Utility Functions

### 7.1 Helper Functions

**Add utility functions**:
```tsx
// Format file size
function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "--";
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) return `${mb.toFixed(mb > 100 ? 0 : 1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

// Validate credential
function canUseCredential(value: string): boolean {
  const normalized = value.trim();
  return normalized.length > 0 && !normalized.startsWith("$");
}
```

## Implementation Checklist

### Phase 1: Core UI Structure ✓
- [ ] Add status header with refresh button
- [ ] Apply consistent visual design system
- [ ] Update tab structure with "Testing" tab
- [ ] Add section containers with proper styling

### Phase 2: Model Management ✓
- [ ] Create model card component
- [ ] Add status badges
- [ ] Implement action buttons (Download, Enable, Delete)
- [ ] Add desktop bridge integration
- [ ] Implement progress tracking

### Phase 3: Advanced Configuration ✓
- [ ] Add collapsible advanced section
- [ ] Create provider configuration card
- [ ] Add API key show/hide toggle
- [ ] Implement model suggestions
- [ ] Add test connection functionality
- [ ] Add delete provider option

### Phase 4: Testing Interface ✓
- [ ] Create testing tab
- [ ] Add test query input
- [ ] Add test documents textarea
- [ ] Implement test embedding functionality
- [ ] Add result display

### Phase 5: UX Enhancements ✓
- [ ] Add comprehensive state management
- [ ] Implement toast notifications
- [ ] Add confirmation dialogs
- [ ] Add loading states with spinners
- [ ] Implement error handling

### Phase 6: API Integration ✓
- [ ] Implement status loading
- [ ] Add test connection API call
- [ ] Add test embedding API call
- [ ] Handle API errors gracefully

### Phase 7: Polish ✓
- [ ] Add utility functions
- [ ] Test all functionality
- [ ] Verify responsive design
- [ ] Check accessibility
- [ ] Review and refactor

## Key Design Principles

1. **Visual Hierarchy**: Use consistent spacing, borders, and typography
2. **Responsive Design**: Grid layouts that adapt to screen size
3. **Loading States**: Show spinners during async operations
4. **Error Handling**: Display errors clearly with badges and toasts
5. **Confirmation**: Ask before destructive actions
6. **Feedback**: Provide immediate feedback for all user actions
7. **Progressive Disclosure**: Use collapsible sections for advanced features
8. **Accessibility**: Proper ARIA labels and keyboard navigation

## Reference Files

- **Old Project**: `/Users/zhangtiancheng/Documents/项目/新项目/Nion_old/frontend/src/components/workspace/settings/retrieval-settings-page.tsx`
- **Current File**: `frontend/src/components/workspace/settings/embedding-settings-page.tsx`
- **API Module**: `frontend/src/core/embedding-models/api.ts` (to be created/updated)
- **Shared Components**: `frontend/src/components/workspace/settings/`
  - `settings-section.tsx`
  - `config-save-bar.tsx`
  - `confirm-action-dialog.tsx`
  - `config-validation-errors.tsx`

## Next Steps

1. Review current implementation
2. Create API module if needed
3. Implement Phase 1 (Core UI Structure)
4. Implement Phase 2 (Model Management)
5. Implement Phase 3 (Advanced Configuration)
6. Implement Phase 4 (Testing Interface)
7. Implement Phase 5 (UX Enhancements)
8. Implement Phase 6 (API Integration)
9. Implement Phase 7 (Polish)
10. Test and refine
