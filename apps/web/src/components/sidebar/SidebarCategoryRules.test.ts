import { describe, expect, it } from "vite-plus/test";
import { classifyThread, UNCATEGORIZED } from "./SidebarCategoryRules";

describe("sidebar thread classification", () => {
  it.each([
    ["小红书小岛经济学流量异常", "xiaodao"],
    ["公众号日更和爆火策略", "wechat"],
    ["小红书短视频", "xiaohongshu"],
    ["橙镜抖音主号的素材", "douyin-real"],
    ["一根 AI 的配乐筛选", "douyin-ai"],
    ["T3 工作台 X 文章：自媒体实战", "x"],
    ["Claude 视频抖音发布", "douyin-other"],
    ["用 Suno 制作样片", "video"],
    ["核心股错杀提醒｜港股盘中", "invest"],
    ["评估劳动合同风险", "company"],
    ["客户海报验收", "client"],
    ["淘宝运营", "product"],
    ["自媒体选题", "content-other"],
    ["电脑 VPN 与 T3 Code 升级", "t3"],
    ["Claude 在 MacBook 上的代理", "devices"],
    ["排查 Claude 额度骤耗", "models"],
    ["Obsidian 定时同步", "automation"],
    ["Hologram phase optimization", "optics"],
    ["Optical imaging system design", "optics"],
    ["超表面衍射模型", "optics"],
    ["CUDA_FDTD convergence benchmark", "numerical-simulation"],
    ["Electromagnetic simulation convergence", "numerical-simulation"],
    ["GitHub pull request review", "software-development"],
    ["重构前端路由", "software-development"],
    ["修复子代理的回归测试", "software-development"],
    ["配置 HTTP 代理", "devices"],
    ["配置代理", "devices"],
    ["T3 Code 的子代理管理", "t3"],
  ])("classifies %s before trying the project name", (title, category) => {
    expect(classifyThread({ title, projectName: "AI 工作台" })).toBe(category);
  });

  it.each([
    ["小岛经济学", "content-other"],
    ["交易与电商", "invest"],
    ["公司管理", "company"],
    ["电商客户", "client"],
    ["AI 工作台", "tools-other"],
    ["hologram-phase-retrieval", "optics"],
    ["cuda-fdtd-unitcell", "numerical-simulation"],
    ["TypeScript SDK", "software-development"],
    ["t3code-feature-branch", "t3"],
    ["No project", UNCATEGORIZED],
    ["项目管理", UNCATEGORIZED],
    [undefined, UNCATEGORIZED],
  ])("falls back to the category of project %s", (projectName, category) => {
    expect(classifyThread({ title: "聊聊最近的状态", projectName })).toBe(category);
  });

  it.each([
    ["GitHub pull request review", "hologram-phase-retrieval", "software-development"],
    ["Hologram 误差分析", "cuda-fdtd-unitcell", "optics"],
    ["优化全息 FDTD 仿真", "hologram-phase-retrieval", "numerical-simulation"],
    ["整理模型结果", "hologram-phase-retrieval", "optics"],
    ["代理商沟通", "No project", UNCATEGORIZED],
    ["整理模型结果", "No project", UNCATEGORIZED],
    ["解释 token ring 的历史", "No project", UNCATEGORIZED],
    ["Checkout the hologrammatic art", "No project", UNCATEGORIZED],
    ["Estimate electron density", "No project", UNCATEGORIZED],
  ])("classifies %s in %s from explicit signals only", (title, projectName, category) => {
    expect(classifyThread({ title, projectName })).toBe(category);
  });

  it.each([
    "  ",
    "  <image name=公众号 />",
    "[external unsupported 公众号]",
    "Call your built-in image generation tool for 公众号",
  ])("leaves generated prompts and image dumps uncategorized: %s", (title) => {
    expect(classifyThread({ title, projectName: "自媒体" })).toBe(UNCATEGORIZED);
  });
});
