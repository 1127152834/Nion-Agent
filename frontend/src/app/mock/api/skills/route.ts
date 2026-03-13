export function GET() {
  return Response.json({
    skills: [
      {
        name: "deep-research",
        description:
          '{"en":"Use before any content generation task that needs online research. Provides a systematic, multi-angle methodology to gather comprehensive information.","zh-CN":"在需要联网调研的内容生成任务前使用。提供系统化、多角度的方法来收集完整信息。"}',
        license: null,
        category: "public",
        enabled: true,
      },
      {
        name: "frontend-design",
        description:
          '{"en":"Create distinctive, production-grade frontend UI. Use for building pages/components/apps or beautifying Web UI, with strong design quality and non-generic aesthetics.","zh-CN":"用于生成高质量、可上线的前端界面与组件。适用于构建页面/组件/应用或美化 Web UI，强调审美与可用性，避免模板化“AI 风格”。"}',
        license: "Complete terms in LICENSE.txt",
        category: "public",
        enabled: true,
      },
      {
        name: "github-deep-research",
        description:
          '{"en":"Multi-round deep research on GitHub repos. Use for comprehensive analysis, timeline reconstruction, competitive analysis, or investigations. Outputs structured markdown reports with metrics and diagrams.","zh-CN":"对 GitHub 仓库做多轮深度调研。适用于全面分析、时间线还原、竞品分析与深度调查，输出含指标与图表的结构化 Markdown 报告。"}',
        license: null,
        category: "public",
        enabled: true,
      },
      {
        name: "image-generation",
        description:
          '{"en":"Use when the user wants to generate or visualize images (characters, scenes, products, etc). Supports structured prompts and reference images.","zh-CN":"当用户需要生成或可视化图片（角色、场景、产品等）时使用。支持结构化提示词与参考图引导生成。"}',
        license: null,
        category: "public",
        enabled: true,
      },
      {
        name: "podcast-generation",
        description:
          '{"en":"Use when the user wants to generate podcasts from text. Converts written content into a natural two-host conversational audio script.","zh-CN":"当用户希望从文本生成播客时使用。会把文字内容转换为双主播自然对话的播客脚本/音频结构。"}',
        license: null,
        category: "public",
        enabled: true,
      },
      {
        name: "ppt-generation",
        description:
          '{"en":"Use when the user wants to generate presentations (PPT/PPTX). Creates visually rich slides by generating images per slide and composing a PowerPoint file.","zh-CN":"当用户希望生成演示文稿（PPT/PPTX）时使用。会为每页生成配图并合成为可下载的 PowerPoint 文件。"}',
        license: null,
        category: "public",
        enabled: true,
      },
      {
        name: "skill-creator",
        description:
          '{"en":"Guide for creating effective skills. Use when users want to create or update a skill that extends agent capabilities with specific workflows/tools.","zh-CN":"技能创建指南。用于用户想新建或更新技能，以特定工作流/工具集成来扩展智能体能力的场景。"}',
        license: "Complete terms in LICENSE.txt",
        category: "public",
        enabled: true,
      },
      {
        name: "vercel-deploy",
        description:
          '{"en":"Deploy apps/websites to Vercel. Use for preview/prod deploy and returning a preview URL plus a claimable deployment link. No auth required.","zh-CN":"将应用/网站部署到 Vercel。适用于预览/生产部署并返回预览 URL 与可认领部署链接；无需登录。"}',
        license: null,
        category: "public",
        enabled: true,
      },
      {
        name: "video-generation",
        description:
          '{"en":"Use when the user wants to generate or imagine videos. Supports structured prompts and reference images for guided generation.","zh-CN":"当用户需要生成或想象视频内容时使用。支持结构化提示词与参考图引导生成。"}',
        license: null,
        category: "public",
        enabled: true,
      },
      {
        name: "web-design-guidelines",
        description:
          '{"en":"Review UI code for Web Interface Guidelines compliance. Use for UI/UX review, accessibility checks, design audits, and best-practice validation.","zh-CN":"用于检查 UI 代码是否符合 Web 界面规范。适用于 UI/UX 评审、无障碍检查、设计审计与最佳实践对照。"}',
        license: null,
        category: "public",
        enabled: true,
      },
    ],
  });
}
