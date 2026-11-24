import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  antigravitySubagentLaunches,
  describeAntigravitySubagentLaunches,
  readAntigravityChildrenAtWork,
  readAntigravityChildWork,
  readAntigravityPendingReply,
} from "./AntigravityChildWork.ts";

const ROOT = "0a591388-d9d9-439d-a2a0-90932fd25b37";
const CHILD = "0a591388-d9d9-439d-a2a0-90932fd25b38";
const LAUNCH = { role: "Readme Explorer", prompt: "Read README.md and summarize it." };

const read = (
  profileDirectory: string,
  nativeTaskId: string,
  launch: { readonly title: string | null; readonly prompt: string } = {
    title: null,
    prompt: "Readme check",
  },
) =>
  readAntigravityChildWork({
    profileDirectory,
    rootSessionId: ROOT,
    nativeTaskId,
    launch,
    siblings: [],
  });

it.layer(NodeServices.layer)("AntigravityChildWork", (it) => {
  it.effect("parses flat and batched invoke_subagent launch inputs", () =>
    Effect.sync(() => {
      const single = antigravitySubagentLaunches({ Role: LAUNCH.role, Prompt: LAUNCH.prompt });
      expect(single).toEqual([LAUNCH]);
      expect(describeAntigravitySubagentLaunches(single!)).toEqual({
        title: LAUNCH.role,
        prompt: LAUNCH.prompt,
      });

      const batch = antigravitySubagentLaunches({
        Subagents: [
          { Role: LAUNCH.role, Prompt: LAUNCH.prompt },
          { Role: "Line Counter", Prompt: "Count lines in README.md" },
        ],
      });
      expect(describeAntigravitySubagentLaunches(batch!)).toEqual({
        title: "Readme Explorer, Line Counter",
        prompt: `${LAUNCH.role}\n${LAUNCH.prompt}\n\nLine Counter\nCount lines in README.md`,
      });
    }),
  );

  it.effect("reads detached agy 1.5 JSON subagent records without touching SQLite databases", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const profile = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agy-detached-" });
      const sibling = "0a591388-d9d9-439d-a2a0-90932fd25b39";
      const writeJson = (segments: ReadonlyArray<string>, value: unknown) => {
        const file = path.join(profile, "antigravity-acp", "brain", ...segments);
        return fs
          .makeDirectory(path.dirname(file), { recursive: true })
          .pipe(Effect.andThen(fs.writeFileString(file, JSON.stringify(value))));
      };
      const writeTranscript = (conversationId: string, lines: ReadonlyArray<unknown>) => {
        const file = path.join(
          profile,
          "antigravity-acp",
          "brain",
          conversationId,
          ".system_generated",
          "logs",
          "transcript.jsonl",
        );
        return fs
          .makeDirectory(path.dirname(file), { recursive: true })
          .pipe(
            Effect.andThen(
              fs.writeFileString(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`),
            ),
          );
      };

      yield* writeJson([ROOT, ".system_generated", "subagents", `${CHILD}.json`], {
        conversationId: CHILD,
        subagentDescriptor: { typeName: "research", role: LAUNCH.role },
      });
      yield* writeJson([CHILD, ".system_generated", "messages", "launch.json"], {
        sender: ROOT,
        content: LAUNCH.prompt,
        sourceMetadata: {
          tool: {
            conversationId: ROOT,
            toolCall: {
              id: "call_11340266277043349041",
              name: "invoke_subagent",
              argumentsJson: JSON.stringify({
                TypeName: "research",
                Role: LAUNCH.role,
                Prompt: LAUNCH.prompt,
              }),
            },
          },
        },
      });
      yield* writeJson([CHILD, ".system_generated", "messages", "read.json"], { launch: true });
      yield* writeTranscript(CHILD, [
        {
          step_index: 0,
          type: "SYSTEM_MESSAGE",
          status: "DONE",
          content: `<SYSTEM_MESSAGE>\n[Message] sender=${ROOT} content=${LAUNCH.prompt}\n</SYSTEM_MESSAGE>`,
        },
        {
          step_index: 1,
          type: "PLANNER_RESPONSE",
          status: "DONE",
          tool_calls: [{ name: "read_file", args: { Path: '"/project/README.md"' } }],
        },
        {
          step_index: 2,
          type: "GENERIC",
          status: "DONE",
          content: "2: MAGIC_TOKEN=probe-38478-ok",
        },
      ]);

      yield* writeJson([ROOT, ".system_generated", "subagents", `${sibling}.json`], {
        conversationId: sibling,
        subagentDescriptor: { typeName: "research", role: "Line Counter" },
      });
      yield* writeJson([sibling, ".system_generated", "messages", "launch.json"], {
        sender: ROOT,
        content: "Count lines in README.md",
        sourceMetadata: {
          tool: {
            toolCall: { id: "call_22340266277043349042", name: "invoke_subagent" },
          },
        },
      });
      yield* writeJson([sibling, ".system_generated", "messages", "followup.json"], {
        sender: ROOT,
        content: "Also check LICENSE",
        sourceMetadata: {
          tool: {
            toolCall: { id: "call_followup", name: "send_message" },
          },
        },
      });

      const [first, ...firstRest] = yield* read(profile, "call_11340266277043349041", {
        title: LAUNCH.role,
        prompt: LAUNCH.prompt,
      });
      expect(firstRest).toEqual([]);
      expect(first).toMatchObject({
        conversationId: CHILD,
        role: LAUNCH.role,
        prompt: LAUNCH.prompt,
        truncated: false,
      });
      expect(first?.steps?.map((step) => step.text ?? step.toolCalls[0]?.name)).toEqual([
        "read_file",
        "2: MAGIC_TOKEN=probe-38478-ok",
      ]);
      expect(first?.steps?.[0]?.toolCalls[0]?.input).toBe('{"Path":"/project/README.md"}');

      const [second] = yield* read(profile, "call_22340266277043349042", {
        title: "Line Counter",
        prompt: "Count lines in README.md",
      });
      expect(second).toEqual({
        conversationId: sibling,
        role: "Line Counter",
        prompt: "Count lines in README.md",
        steps: null,
        truncated: false,
      });

      expect(yield* read(profile, "call_unknown")).toEqual([]);
      expect(yield* read(profile, "call_followup")).toEqual([]);

      yield* writeJson([sibling, ".system_generated", "messages", "dup.json"], {
        sender: ROOT,
        content: LAUNCH.prompt,
        sourceMetadata: {
          tool: {
            toolCall: { id: "call_11340266277043349041", name: "invoke_subagent" },
          },
        },
      });
      expect(yield* read(profile, "call_11340266277043349041")).toEqual([]);
    }),
  );

  it.effect("counts a detached child killed before it reported as no longer at work", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const profile = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agy-killed-" });
      const killed = "0a591388-d9d9-439d-a2a0-90932fd25b39";
      const writeJson = (segments: ReadonlyArray<string>, value: unknown) => {
        const file = path.join(profile, "antigravity-acp", "brain", ...segments);
        return fs
          .makeDirectory(path.dirname(file), { recursive: true })
          .pipe(Effect.andThen(fs.writeFileString(file, JSON.stringify(value))));
      };
      const child = (conversationId: string, state: string, callId: string) =>
        Effect.all([
          writeJson([ROOT, ".system_generated", "subagents", `${conversationId}.json`], {
            conversationId,
            subagentDescriptor: { typeName: "research", role: LAUNCH.role },
            state,
          }),
          writeJson([conversationId, ".system_generated", "messages", "launch.json"], {
            sender: ROOT,
            content: LAUNCH.prompt,
            sourceMetadata: {
              tool: { conversationId: ROOT, toolCall: { id: callId, name: "invoke_subagent" } },
            },
          }),
        ]);

      yield* child(CHILD, "SUBAGENT_STATE_ALIVE", "call_alive");
      yield* child(killed, "SUBAGENT_STATE_KILLED", "call_killed");

      expect(
        yield* readAntigravityChildrenAtWork({
          profileDirectory: profile,
          rootSessionId: ROOT,
          toolCallIds: ["call_alive", "call_killed"],
        }),
      ).toEqual(["call_alive"]);
    }),
  );

  it.effect(
    "detects unread high-priority inbox wakes and trailing waking SYSTEM_MESSAGE steps",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const profile = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agy-pending-reply-" });
        const write = (segments: ReadonlyArray<string>, body: string) => {
          const file = path.join(
            profile,
            "antigravity-acp",
            "brain",
            ROOT,
            ".system_generated",
            ...segments,
          );
          return fs
            .makeDirectory(path.dirname(file), { recursive: true })
            .pipe(Effect.andThen(fs.writeFileString(file, body)));
        };
        const pending = () =>
          readAntigravityPendingReply({ profileDirectory: profile, sessionId: ROOT });

        expect(yield* pending()).toBe(false);
        expect(
          yield* readAntigravityPendingReply({ profileDirectory: profile, sessionId: "../escape" }),
        ).toBe(false);

        yield* write(
          ["messages", "low-1.json"],
          JSON.stringify({ id: "low-1", priority: "MESSAGE_PRIORITY_LOW", sender: "system" }),
        );
        expect(yield* pending()).toBe(false);

        yield* write(
          ["messages", "high-1.json"],
          JSON.stringify({
            id: "high-1",
            priority: "MESSAGE_PRIORITY_HIGH",
            sender: `${ROOT}/task-1`,
          }),
        );
        expect(yield* pending()).toBe(true);

        yield* write(["messages", "read.json"], JSON.stringify({ "high-1": true }));
        yield* write(
          ["logs", "transcript.jsonl"],
          `${JSON.stringify({ step_index: 1, type: "PLANNER_RESPONSE", status: "DONE", content: "Done." })}\n`,
        );
        expect(yield* pending()).toBe(false);

        const filler = JSON.stringify({
          step_index: 0,
          type: "GENERIC",
          status: "DONE",
          content: "x".repeat(8_000),
        });
        yield* write(
          ["logs", "transcript.jsonl"],
          `${Array.from({ length: 12 }, () => filler).join("\n")}\n${JSON.stringify({
            step_index: 2,
            type: "SYSTEM_MESSAGE",
            status: "DONE",
            content: "priority=MESSAGE_PRIORITY_HIGH task-2 finished",
          })}\n`,
        );
        expect(yield* pending()).toBe(true);

        yield* write(
          ["logs", "transcript.jsonl"],
          `${JSON.stringify({
            step_index: 3,
            type: "SYSTEM_MESSAGE",
            status: "DONE",
            content: "priority=MESSAGE_PRIORITY_LOW server restart notice",
          })}\n`,
        );
        expect(yield* pending()).toBe(false);

        yield* write(["messages", "read.json"], "{not json");
        expect(yield* pending()).toBe(false);

        const outside = yield* fs.makeTempDirectoryScoped({ prefix: "t3-agy-pending-outside-" });
        const external = path.join(outside, "transcript.jsonl");
        yield* fs.writeFileString(
          external,
          `${JSON.stringify({ step_index: 4, type: "SYSTEM_MESSAGE", status: "DONE", content: "priority=MESSAGE_PRIORITY_HIGH" })}\n`,
        );
        const transcriptPath = path.join(
          profile,
          "antigravity-acp",
          "brain",
          ROOT,
          ".system_generated",
          "logs",
          "transcript.jsonl",
        );
        yield* fs.remove(transcriptPath);
        yield* fs.symlink(external, transcriptPath);
        expect(yield* pending()).toBe(false);
      }),
  );
});
