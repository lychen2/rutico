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
  ])("classifies %s before trying the project name", (title, category) => {
    expect(classifyThread({ title, projectName: "AI 工作台" })).toBe(category);
  });

  it.each([
    ["小岛经济学", "content-other"],
    ["交易与电商", "invest"],
    ["公司管理", "company"],
    ["电商客户", "client"],
    ["AI 工作台", "tools-other"],
    ["项目管理", UNCATEGORIZED],
    [undefined, UNCATEGORIZED],
  ])("falls back to the category of project %s", (projectName, category) => {
    expect(classifyThread({ title: "聊聊最近的状态", projectName })).toBe(category);
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
