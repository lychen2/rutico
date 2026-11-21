export const UNCATEGORIZED = "uncategorized";

export const BUILT_IN_CATEGORY_IDS = [
  "wechat",
  "douyin-real",
  "douyin-ai",
  "douyin-other",
  "xiaohongshu",
  "x",
  "xiaodao",
  "video",
  "content-other",
  "company",
  "client",
  "product",
  "invest",
  "t3",
  "models",
  "automation",
  "devices",
  "tools-other",
] as const;

type BuiltInCategoryId = (typeof BUILT_IN_CATEGORY_IDS)[number];

// Stardust v1.0.7: account and platform matches precede generic topics.
const TITLE_RULES: ReadonlyArray<readonly [BuiltInCategoryId, RegExp]> = [
  ["xiaodao", /小岛/],
  ["wechat", /公众号/],
  ["xiaohongshu", /小红书/],
  ["douyin-real", /真人主号|橙镜/],
  ["douyin-ai", /一根\s*AI|AI\s*时代普通人的机会/i],
  ["x", /(?:^|[^A-Za-z])X\s*(?:账号|帖子|长推|文章|主页)/],
  ["douyin-other", /抖音/],
  [
    "video",
    /动画|样片|分镜|剧本|配乐|声线|歌词|副歌|说唱|试听|视频脚本|短视频|伤感女声|音频|Suno/i,
  ],
  ["invest", /长桥|美股|港股|核心股|投资|TradePilot|Exness|黄金行情|交易研究/i],
  ["company", /公司|飞书|劳动合同|租金|办公室|绩效|报销|发票|组织调整/],
  ["client", /客户|报价|海报|游戏美术|主图|电商视觉|角色材质|交付边界/],
  ["product", /网站|试衣|产品方向|创意产品|淘宝|闲鱼|批量生图/],
  ["content-other", /专栏|爆火|选题|自媒体/],
  ["t3", /\bT3\b|t3\s|^t3|侧栏|工作台/i],
  ["devices", /磁盘|硬盘|网盘|VPN|WiFi|代理|电脑|服务器|VPS|MacBook|网速|弹窗|手机卡顿/i],
  ["models", /Claude|Codex|Gemini|GPT|OpenAI|DeepSeek|Grok|模型|token|额度|账号停用|LibTV|发布会/i],
  ["automation", /Obsidian|Skill|自动化|Agent|知识|定时|复盘|回顾|语音灵感/i],
];
const PROJECT_FALLBACK: ReadonlyArray<readonly [RegExp, BuiltInCategoryId]> = [
  [/自媒体|公众号|小岛/, "content-other"],
  [/交易|生财/, "invest"],
  [/公司/, "company"],
  [/电商/, "client"],
  [/AI\s*工作台|模型|Codex|Claude/i, "tools-other"],
];

export function classifyThread(input: {
  readonly title: string;
  readonly projectName: string | null | undefined;
}) {
  const title = input.title.trim();
  if (
    title === "" ||
    title.startsWith("<image") ||
    title.startsWith("[external unsupported") ||
    title.startsWith("Call your built-in")
  ) {
    return UNCATEGORIZED;
  }
  for (const [id, pattern] of TITLE_RULES) {
    if (pattern.test(input.title)) return id;
  }
  const project = input.projectName ?? "";
  for (const [pattern, id] of PROJECT_FALLBACK) {
    if (pattern.test(project)) return id;
  }
  return UNCATEGORIZED;
}
