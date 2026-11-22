export const UNCATEGORIZED = "uncategorized";

export const SIDEBAR_CATEGORY_PRESETS = [
  "general",
  "developer",
  "creator",
  "project",
  "legacy",
] as const;
export type SidebarCategoryPreset = (typeof SIDEBAR_CATEGORY_PRESETS)[number];

const PRESET_KEYWORDS = {
  general: {
    development: "代码|接口|开发|数据库|代码库|code|api|bug|refactor|database|test",
    content: "文章|博客|文案|写作|article|blog|copywriting|readme",
    research: "分析|对比|调研|研究|analyze|compare|research",
    work: "周报|会议|邮件|报销|report|meeting|email|invoice",
    systems: "磁盘|模型|设置|系统|disk|model|settings|network",
  },
  developer: {
    fixes: "修复|报错|故障|bug|fix|error|debug",
    features: "功能|接口|新增|feature|api|implement",
    review: "评审|审查|review",
    docs: "文档|说明|docs|readme",
    deploy: "部署|运维|监控|deploy|ops|infra",
  },
  creator: {
    scripts: "选题|脚本|分镜|idea|script|storyboard",
    writing: "文章|文案|博客|article|writing|blog",
    media: "视频|动画|音频|video|audio|animation",
    publishing: "发布|运营|推广|publish|campaign|marketing",
  },
};

export const SIDEBAR_PRESET_RULES = {
  general: Object.entries(PRESET_KEYWORDS.general).map(
    ([id, words]) => [id, words.split("|")] as const,
  ),
  developer: Object.entries(PRESET_KEYWORDS.developer).map(
    ([id, words]) => [id, words.split("|")] as const,
  ),
  creator: Object.entries(PRESET_KEYWORDS.creator).map(
    ([id, words]) => [id, words.split("|")] as const,
  ),
};
export const SIDEBAR_PRESET_CATEGORY_IDS = Object.values(SIDEBAR_PRESET_RULES).flatMap((rules) =>
  rules.map(([id]) => id),
);

export function isClassifiableSidebarTitle(title: string) {
  const trimmed = title.trim();
  return trimmed.length > 0 && !/^(<image|\[external unsupported|Call your built-in)/.test(trimmed);
}

export function resolveSidebarCategory(input: {
  readonly title: string;
  readonly projectName?: string | undefined;
  readonly preset: SidebarCategoryPreset;
  readonly automatic: boolean;
}) {
  if (!input.automatic || input.preset === "project" || !isClassifiableSidebarTitle(input.title)) {
    return UNCATEGORIZED;
  }
  if (input.preset === "legacy")
    return classifyThread({ title: input.title, projectName: input.projectName });
  const title = input.title.normalize("NFKC").toLowerCase();
  const tokens = new Set(title.split(/[^a-z0-9]+/));
  for (const [id, keywords] of SIDEBAR_PRESET_RULES[input.preset]) {
    if (
      keywords.some((keyword) =>
        /^[a-z0-9]+$/.test(keyword) ? tokens.has(keyword) : title.includes(keyword),
      )
    ) {
      return id;
    }
  }
  return UNCATEGORIZED;
}

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
  "optics",
  "numerical-simulation",
  "software-development",
  "t3",
  "models",
  "automation",
  "devices",
  "tools-other",
] as const;

type BuiltInCategoryId = (typeof BUILT_IN_CATEGORY_IDS)[number];

const T3_NAME = /(?<![a-z0-9])T3(?:[ _-]?Code)?(?![a-z0-9])/i;
const OPTICS =
  /光学|全息|超表面|衍射|光栅|波前|光路|波导|(?<![a-z0-9])(?:optics|photonics?|holograms?|holography|holographic|metalens(?:es)?|metasurfaces?|diffraction|wavefronts?|waveguides?|optical[ _-]+(?:design|imaging|systems?))(?![a-z0-9])/i;
const NUMERICAL_SIMULATION =
  /数值(?:模拟|仿真|求解)|(?:光学|电磁|流体)仿真|有限(?:差分|元)|(?<![a-z0-9])(?:FDTD|RCWA|FEM|Lumerical|COMSOL|(?:numerical|electromagnetic|optical)[ _-]+simulations?)(?![a-z0-9])/i;
const SOFTWARE_DEVELOPMENT =
  /软件开发|代码(?:审查|重构)|前端|后端|单元测试|回归测试|持续集成|数据库迁移|子代理|(?<![a-z0-9])(?:git|github|gitlab|typescript|javascript|python|websockets?|docker|frontend|backend|sub[ _-]?agents?|pull[ _-]+requests?|worktrees?)(?![a-z0-9])/i;

// Match creator accounts first, then specific work signals before broad tooling terms.
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
  ["t3", T3_NAME],
  ["numerical-simulation", NUMERICAL_SIMULATION],
  ["optics", OPTICS],
  ["software-development", SOFTWARE_DEVELOPMENT],
  ["t3", /侧栏|工作台/],
  [
    "devices",
    /磁盘|硬盘|网盘|VPN|WiFi|电脑|服务器|VPS|MacBook|网速|弹窗|手机卡顿|(?:网络|系统|全局|反向|HTTP(?:S)?|SOCKS5?)\s*代理|代理端口|(?:开启|关闭|配置)代理(?!商|人)/i,
  ],
  [
    "models",
    /Claude|Codex|Gemini|GPT|OpenAI|DeepSeek|Grok|(?:大语言|语言|大|AI\s*)模型|模型(?:选择|切换|列表|配置|供应商|提供商|额度|价格)|(?:选择|切换|配置)模型|token\s*(?:预算|消耗|计费|用量)|额度|账号停用|LibTV|发布会/i,
  ],
  ["automation", /Obsidian|\b(?:Skills?|Agents?)\b|自动化|知识|定时|复盘|回顾|语音灵感/i],
];
const PROJECT_FALLBACK: ReadonlyArray<readonly [BuiltInCategoryId, RegExp]> = [
  ["content-other", /自媒体|公众号|小岛/],
  ["invest", /交易|生财/],
  ["company", /公司/],
  ["client", /电商/],
  ["t3", T3_NAME],
  ["numerical-simulation", NUMERICAL_SIMULATION],
  ["optics", OPTICS],
  ["software-development", SOFTWARE_DEVELOPMENT],
  ["tools-other", /AI\s*工作台|模型|Codex|Claude/i],
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
    if (pattern.test(title)) return id;
  }
  const project = input.projectName ?? "";
  for (const [id, pattern] of PROJECT_FALLBACK) {
    if (pattern.test(project)) return id;
  }
  return UNCATEGORIZED;
}
