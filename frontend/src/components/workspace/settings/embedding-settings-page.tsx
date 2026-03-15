"use client";

import { Loader2Icon, RefreshCwIcon, TestTubeIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  loadEmbeddingModelsStatus,
  loadEmbeddingPresets,
  setActiveEmbeddingModel,
  testEmbedding,
  type EmbeddingStatusResult,
  type EmbeddingProvider,
  type PresetModel,
  type SetActiveModelPayload,
} from "@/core/embedding-models/api";

import { SettingsSection } from "./settings-section";

export function EmbeddingSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const [provider, setProvider] = useState<EmbeddingProvider>("local");
  const [localModel, setLocalModel] = useState("all-MiniLM-L6-v2");
  const [localDevice, setLocalDevice] = useState("cpu");
  const [openaiModel, setOpenaiModel] = useState("text-embedding-3-small");
  const [openaiApiKey, setOpenaiApiKey] = useState("$OPENAI_API_KEY");
  const [openaiDimension, setOpenaiDimension] = useState(1536);
  const [customModel, setCustomModel] = useState("");
  const [customApiBase, setCustomApiBase] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [customDimension, setCustomDimension] = useState(1536);

  const [localPresets, setLocalPresets] = useState<PresetModel[]>([]);
  const [openaiPresets, setOpenaiPresets] = useState<PresetModel[]>([]);
  const [currentStatus, setCurrentStatus] = useState<EmbeddingStatusResult | null>(null);

  useEffect(() => {
    loadStatus();
    loadPresets();
  }, []);

  const loadStatus = async () => {
    try {
      const response = await loadEmbeddingModelsStatus();
      if (response.result) {
        setCurrentStatus(response.result);
        if (response.result.provider) {
          setProvider(response.result.provider);
        }
        if (response.result.model) {
          if (response.result.provider === "local") {
            setLocalModel(response.result.model);
          } else if (response.result.provider === "openai") {
            setOpenaiModel(response.result.model);
          } else if (response.result.provider === "custom") {
            setCustomModel(response.result.model);
          }
        }
        if (response.result.device) {
          setLocalDevice(response.result.device);
        }
        if (typeof response.result.dimension === "number") {
          if (response.result.provider === "openai") {
            setOpenaiDimension(response.result.dimension);
          } else if (response.result.provider === "custom") {
            setCustomDimension(response.result.dimension);
          }
        }
        if (response.result.api_base) {
          setCustomApiBase(response.result.api_base);
        }
      }
    } catch (error) {
      console.error("Failed to load status:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadPresets = async () => {
    try {
      const response = await loadEmbeddingPresets();
      if (response.result) {
        setLocalPresets(response.result.local || []);
        setOpenaiPresets(response.result.openai || []);
      }
    } catch (error) {
      console.error("Failed to load presets:", error);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const response = await testEmbedding("测试向量嵌入功能");
      if (response.status === "ok" && response.result) {
        toast.success("测试成功", {
          description: `模型: ${response.result.model}, 维度: ${response.result.dimension}`,
        });
      } else {
        toast.error("测试失败", {
          description: response.result?.message || "未知错误",
        });
      }
    } catch (error: any) {
      toast.error("测试失败", {
        description: error.message || "未知错误",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: SetActiveModelPayload = {
        provider,
        model: provider === "local" ? localModel : provider === "openai" ? openaiModel : customModel,
      };

      if (provider === "local") {
        payload.device = localDevice;
      } else if (provider === "openai") {
        payload.api_key = openaiApiKey;
        payload.dimension = openaiDimension;
      } else if (provider === "custom") {
        payload.api_base = customApiBase;
        payload.api_key = customApiKey;
        payload.dimension = customDimension;
      }

      const response = await setActiveEmbeddingModel(payload);
      if (response.status === "ok") {
        toast.success("保存成功", {
          description: response.result?.message || "配置已更新",
        });
        await loadStatus();
      } else {
        toast.error("保存失败", {
          description: response.result?.message || "未知错误",
        });
      }
    } catch (error: any) {
      toast.error("保存失败", {
        description: error.message || "未知错误",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2Icon className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="向量模型配置"
        description="配置用于记忆系统的向量嵌入模型"
      >
        <div className="space-y-4">
          {/* Current Status */}
          {currentStatus && (
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">当前状态</span>
                <Badge variant={currentStatus.enabled ? "default" : "secondary"}>
                  {currentStatus.enabled ? "已启用" : "已禁用"}
                </Badge>
              </div>
              {currentStatus.enabled && (
                <>
                  <div className="text-sm text-muted-foreground">
                    提供者: {currentStatus.provider}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    模型: {currentStatus.model}
                  </div>
                  {currentStatus.dimension && (
                    <div className="text-sm text-muted-foreground">
                      维度: {currentStatus.dimension}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Provider Selection */}
          <div className="space-y-2">
            <Label>选择提供者</Label>
            <RadioGroup value={provider} onValueChange={(v) => setProvider(v as EmbeddingProvider)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="local" id="local" />
                <Label htmlFor="local" className="font-normal cursor-pointer">
                  本地模型 (sentence-transformers)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="openai" id="openai" />
                <Label htmlFor="openai" className="font-normal cursor-pointer">
                  OpenAI API
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="custom" id="custom" />
                <Label htmlFor="custom" className="font-normal cursor-pointer">
                  自定义 API (OpenAI 兼容)
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Provider-specific Configuration */}
          <Tabs value={provider} className="w-full">
            <TabsList className="hidden" />

            <TabsContent value="local" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="local-model">模型</Label>
                <Select value={localModel} onValueChange={setLocalModel}>
                  <SelectTrigger id="local-model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {localPresets.map((preset) => (
                      <SelectItem key={preset.id} value={preset.name}>
                        <div className="flex flex-col">
                          <span>{preset.display_name}</span>
                          <span className="text-xs text-muted-foreground">
                            {preset.dimension}维 · {preset.size_mb}MB · {preset.languages?.join(", ")}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  首次使用会自动下载模型（约 {localPresets.find(p => p.name === localModel)?.size_mb || 80}MB）
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="local-device">设备</Label>
                <Select value={localDevice} onValueChange={setLocalDevice}>
                  <SelectTrigger id="local-device">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cpu">CPU</SelectItem>
                    <SelectItem value="cuda">CUDA (NVIDIA GPU)</SelectItem>
                    <SelectItem value="mps">MPS (Apple Silicon)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-lg bg-muted p-3 text-sm">
                <p className="font-medium mb-1">安装说明</p>
                <p className="text-muted-foreground">
                  需要安装 sentence-transformers:
                </p>
                <code className="block mt-2 p-2 bg-background rounded">
                  pip install sentence-transformers
                </code>
              </div>
            </TabsContent>

            <TabsContent value="openai" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="openai-model">模型</Label>
                <Select value={openaiModel} onValueChange={setOpenaiModel}>
                  <SelectTrigger id="openai-model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {openaiPresets.map((preset) => (
                      <SelectItem key={preset.id} value={preset.name}>
                        <div className="flex flex-col">
                          <span>{preset.display_name}</span>
                          <span className="text-xs text-muted-foreground">
                            {preset.dimension}维 · {preset.description}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="openai-api-key">API Key</Label>
                <Input
                  id="openai-api-key"
                  type="password"
                  value={openaiApiKey}
                  onChange={(e) => setOpenaiApiKey(e.target.value)}
                  placeholder="sk-... 或 $OPENAI_API_KEY"
                />
                <p className="text-xs text-muted-foreground">
                  使用 $ENV_VAR 格式引用环境变量
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="openai-dimension">维度</Label>
                <Input
                  id="openai-dimension"
                  type="number"
                  value={openaiDimension}
                  onChange={(e) => setOpenaiDimension(parseInt(e.target.value))}
                  min={64}
                  max={3072}
                />
              </div>
            </TabsContent>

            <TabsContent value="custom" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="custom-api-base">API Base URL</Label>
                <Input
                  id="custom-api-base"
                  value={customApiBase}
                  onChange={(e) => setCustomApiBase(e.target.value)}
                  placeholder="https://api.example.com/v1"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="custom-model">模型名称</Label>
                <Input
                  id="custom-model"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  placeholder="text-embedding-model"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="custom-api-key">API Key (可选)</Label>
                <Input
                  id="custom-api-key"
                  type="password"
                  value={customApiKey}
                  onChange={(e) => setCustomApiKey(e.target.value)}
                  placeholder="留空如果不需要"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="custom-dimension">维度</Label>
                <Input
                  id="custom-dimension"
                  type="number"
                  value={customDimension}
                  onChange={(e) => setCustomDimension(parseInt(e.target.value))}
                  min={64}
                  max={16384}
                />
              </div>
            </TabsContent>
          </Tabs>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-4">
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
              保存配置
            </Button>
            <Button variant="outline" onClick={handleTest} disabled={testing}>
              {testing ? (
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <TestTubeIcon className="mr-2 h-4 w-4" />
              )}
              测试
            </Button>
            <Button variant="ghost" onClick={loadStatus}>
              <RefreshCwIcon className="mr-2 h-4 w-4" />
              刷新状态
            </Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="关于向量模型"
        description="向量模型用于将文本转换为数值向量，用于语义搜索和记忆检索"
      >
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong>本地模型</strong>: 在本地运行，无需 API 调用，离线可用。首次使用会自动下载模型文件。
          </p>
          <p>
            <strong>OpenAI API</strong>: 使用 OpenAI 的嵌入服务，质量高但需要 API 调用费用。
          </p>
          <p>
            <strong>自定义 API</strong>: 使用兼容 OpenAI 格式的第三方服务或自建服务。
          </p>
        </div>
      </SettingsSection>
    </div>
  );
}
