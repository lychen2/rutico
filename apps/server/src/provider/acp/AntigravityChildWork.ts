// @effect-diagnostics nodeBuiltinImport:off -- fs/promises reads session JSON logs and subagent records.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeURL from "node:url";

import type {
  OrchestrationV2NativeChildStep,
  OrchestrationV2NativeChildWork,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { antigravityManagedPath, antigravityProfileRoot } from "./AntigravityProfilePaths.ts";

// One open reads at most this much; past any bound the batch view stays as it was.
const MAX_STEP_BYTES = 1024 * 1024;
const TRANSCRIPT_BYTE_CAP = 256 * 1024;
const BATCH_TRANSCRIPT_BYTES = 512 * 1024;
const STEP_TEXT_CAP = 4_000;
const TOOL_INPUT_CAP = 1_000;
const MAX_MESSAGE_FILES = 256;
const MAX_DETACHED_CHILDREN = 64;

/** T3's title for a batch whose launch text it never saw. */
export const ANTIGRAVITY_SUBAGENT_BATCH_TITLE = "Antigravity subagent batch";

interface AntigravityChildLaunch {
  readonly role: string;
  readonly prompt: string;
}

const LaunchInput = Schema.Struct({ Role: Schema.String, Prompt: Schema.String });
const SwarmAddInput = Schema.Struct({
  action: Schema.String,
  name: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
  brief: Schema.optional(Schema.String),
  n: Schema.optional(Schema.Number),
  tasks: Schema.optional(Schema.Array(Schema.String)),
});
// agy 1.5 launches one child per call with a flat input; earlier releases send a batch.
const decodeLaunchInput = Schema.decodeUnknownOption(
  Schema.Union([Schema.Struct({ Subagents: Schema.NonEmptyArray(LaunchInput) }), LaunchInput]),
);
const decodeSwarmAddInput = Schema.decodeUnknownOption(SwarmAddInput);

// The tool input is untrusted; a huge `n` must not allocate a launch per requested worker.
const MAX_SWARM_ADD_LAUNCHES = 64;

function swarmAddLaunches(input: unknown): ReadonlyArray<AntigravityChildLaunch> | undefined {
  const decoded = Option.getOrUndefined(decodeSwarmAddInput(input));
  if (decoded === undefined || decoded.action.trim().toLowerCase() !== "add") return undefined;
  const baseName = decoded.name?.trim().replace(/^@/, "") ?? "";
  const brief = decoded.brief?.trim() ?? "";
  const tasks = decoded.tasks ?? [];
  const requestedCount =
    decoded.n !== undefined && Number.isFinite(decoded.n) ? Math.trunc(decoded.n) : 0;
  const count = Math.min(Math.max(tasks.length, requestedCount, 1), MAX_SWARM_ADD_LAUNCHES);
  const roleSuffix =
    decoded.role !== undefined && decoded.role.trim().length > 0 && decoded.role !== "worker"
      ? ` (${decoded.role.trim()})`
      : "";

  if (count === 1) {
    const task = tasks[0]?.trim() ?? "";
    const prompt = brief.length > 0 && task.length > 0 ? `${brief}\n\n${task}` : brief || task;
    return [
      {
        role: baseName.length > 0 ? `@${baseName}${roleSuffix}` : `Swarm worker${roleSuffix}`,
        prompt,
      },
    ];
  }

  return Array.from({ length: count }, (_, index) => {
    const task = tasks[index]?.trim() ?? "";
    const prompt = brief.length > 0 && task.length > 0 ? `${brief}\n\n${task}` : task || brief;
    const role =
      baseName.length > 0
        ? `@${baseName}-${index + 1}${roleSuffix}`
        : `Swarm worker ${index + 1}${roleSuffix}`;
    return { role, prompt };
  });
}

/** `invoke_subagent` or native `swarm` (`action: "add"`) arguments. */
export function antigravitySubagentLaunches(
  input: unknown,
): ReadonlyArray<AntigravityChildLaunch> | undefined {
  const classic = Option.getOrUndefined(
    Option.map(decodeLaunchInput(input), (decoded) =>
      ("Subagents" in decoded ? decoded.Subagents : [decoded]).map((entry) => ({
        role: entry.Role,
        prompt: entry.Prompt,
      })),
    ),
  );
  return classic ?? swarmAddLaunches(input);
}

/** Batch title and prompt; reads match permission-prompt tool call ids against this exact text. */
export function describeAntigravitySubagentLaunches(
  launches: ReadonlyArray<AntigravityChildLaunch>,
) {
  const [only] = launches;
  return launches.length === 1 && only !== undefined
    ? { title: only.role, prompt: only.prompt }
    : {
        title: launches.map((launch) => launch.role).join(", "),
        prompt: launches.map((launch) => `${launch.role}\n${launch.prompt}`).join("\n\n"),
      };
}

interface InvokeRecord {
  readonly toolCallId: string | undefined;
  readonly launches: ReadonlyArray<AntigravityChildLaunch>;
  readonly children: ReadonlyArray<{
    readonly conversationId: string;
    readonly logUri?: string | undefined;
  }>;
}

const NATIVE_ID = /^[A-Za-z0-9-]{1,64}$/;

interface BatchLaunch {
  readonly title: string | null;
  readonly prompt: string;
}

const TranscriptLine = Schema.Struct({
  step_index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  type: Schema.String,
  status: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  tool_calls: Schema.optional(
    Schema.Array(Schema.Struct({ name: Schema.String, args: Schema.optional(Schema.Unknown) })),
  ),
});
const decodeTranscriptLine = Schema.decodeUnknownOption(Schema.fromJsonString(TranscriptLine));

// The runtime records each tool argument value as JSON text.
const decodeArgument = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const toolArguments = (args: unknown) =>
  Predicate.isObject(args)
    ? Object.fromEntries(
        Object.entries(args).map(([key, value]) => [
          key,
          typeof value === "string" ? Option.getOrElse(decodeArgument(value), () => value) : value,
        ]),
      )
    : (args ?? {});

const capText = (value: string, limit: number) =>
  value.length <= limit ? value : `${value.slice(0, limit)}…`;

/** Skips the runtime's opening envelope around the launch prompt the view already shows. */
function transcriptSteps(
  contents: string,
  prompt: string,
): ReadonlyArray<OrchestrationV2NativeChildStep> {
  const launchPrompt = prompt.trim();
  return contents.split("\n").flatMap((line) =>
    Option.match(decodeTranscriptLine(line), {
      onNone: () => [],
      onSome: (step) =>
        step.step_index === 0 &&
        step.type === "SYSTEM_MESSAGE" &&
        launchPrompt !== "" &&
        step.content?.includes(launchPrompt) === true
          ? []
          : [
              {
                index: step.step_index,
                type: step.type,
                status: step.status ?? null,
                text:
                  step.content !== undefined || step.error !== undefined
                    ? capText(step.content ?? step.error ?? "", STEP_TEXT_CAP)
                    : null,
                toolCalls: (step.tool_calls ?? []).map((call) => ({
                  name: call.name,
                  input: capText(JSON.stringify(toolArguments(call.args)), TOOL_INPUT_CAP),
                })),
              },
            ],
    }),
  );
}

const ANTIGRAVITY_APP_DATA_DIRS = ["antigravity-cli", "antigravity-acp"] as const;

async function resolveAntigravityAppDataPath(
  profileRoot: string,
  segments: ReadonlyArray<string>,
  kind: "file" | "directory",
) {
  for (const appDataDir of ANTIGRAVITY_APP_DATA_DIRS) {
    const resolved = await antigravityManagedPath(profileRoot, [appDataDir, ...segments], kind);
    if (resolved !== undefined) {
      return { appDataDir, ...resolved };
    }
  }
  return undefined;
}

/** Reads the tail of the transcript at the named child's own unlinked profile path. */
async function readChildTranscript(
  profileRoot: string,
  child: InvokeRecord["children"][number],
  prompt: string,
  byteCap: number,
) {
  const expected = (
    await resolveAntigravityAppDataPath(
      profileRoot,
      ["brain", child.conversationId, ".system_generated", "logs", "transcript.jsonl"],
      "file",
    )
  )?.path;
  if (expected === undefined) return undefined;
  if (child.logUri !== undefined) {
    let named: string;
    try {
      named = NodeURL.fileURLToPath(child.logUri);
    } catch {
      return undefined;
    }
    if ((await NodeFSP.realpath(named).catch(() => undefined)) !== expected) return undefined;
  }
  const handle = await NodeFSP.open(
    expected,
    NodeFS.constants.O_RDONLY | (NodeFS.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return undefined;
    const tailStart = Math.max(0, stat.size - byteCap);
    // One extra byte tells whether the retained tail starts on a line boundary.
    const readStart = Math.max(0, tailStart - 1);
    const buffer = Buffer.alloc(stat.size - readStart);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, readStart);
    const bytes = buffer.subarray(0, bytesRead);
    let lineStart = 0;
    if (tailStart > 0) {
      const newline = bytes.indexOf(0x0a);
      if (newline === -1) return { steps: [], truncated: true };
      lineStart = newline + 1;
    }
    const contents = bytes.toString("utf8", lineStart);
    return { steps: transcriptSteps(contents, prompt), truncated: tailStart > 0 };
  } finally {
    await handle.close();
  }
}

class AntigravityChildWorkReadError extends Schema.TaggedError<AntigravityChildWorkReadError>()(
  "AntigravityChildWorkReadError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read Antigravity subagent records.";
  }
}

/** Children a subagent tool call launched, proven by the parent's own session record. */
export const readAntigravityChildWork = Effect.fn("readAntigravityChildWork")(function* (input: {
  readonly profileDirectory: string;
  readonly rootSessionId: string;
  readonly nativeTaskId: string;
  readonly launch: BatchLaunch;
  /** The thread's other Antigravity batches from this instance. */
  readonly siblings: ReadonlyArray<BatchLaunch & { readonly nativeTaskId: string }>;
}) {
  if (!NATIVE_ID.test(input.rootSessionId)) return [];
  return yield* Effect.tryPromise({
    try: async (): Promise<ReadonlyArray<OrchestrationV2NativeChildWork>> => {
      const profileRoot = await antigravityProfileRoot(input.profileDirectory);
      if (profileRoot === undefined) return [];
      const record = await findDetachedInvokeRecord(
        profileRoot,
        input.rootSessionId,
        input.nativeTaskId,
      );
      if (record === undefined) return [];
      const { launches, children } = record;
      // One budget for the whole batch, so the response stays small however many children ran.
      const byteCap = Math.min(
        TRANSCRIPT_BYTE_CAP,
        Math.floor(BATCH_TRANSCRIPT_BYTES / Math.max(1, children.length)),
      );
      return Promise.all(
        children.map(async (child, index) => {
          const transcript = await readChildTranscript(
            profileRoot,
            child,
            launches[index]?.prompt ?? "",
            byteCap,
          ).catch(() => undefined);
          return {
            conversationId: child.conversationId,
            role: launches[index]?.role ?? "",
            prompt: launches[index]?.prompt ?? "",
            steps: transcript?.steps ?? null,
            truncated: transcript?.truncated ?? false,
          };
        }),
      );
    },
    catch: (cause) => new AntigravityChildWorkReadError({ cause }),
  });
});

const decodeChildMessage = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      sender: Schema.String,
      content: Schema.optional(Schema.String),
      sourceMetadata: Schema.optional(
        Schema.Struct({
          tool: Schema.optional(
            Schema.Struct({
              conversationId: Schema.optional(Schema.String),
              toolCall: Schema.optional(
                Schema.Struct({
                  id: Schema.String,
                  name: Schema.String,
                  argumentsJson: Schema.optional(Schema.String),
                }),
              ),
            }),
          ),
        }),
      ),
    }),
  ),
);

const decodeDetachedSubagent = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      conversationId: Schema.optional(Schema.String),
      state: Schema.optional(Schema.String),
      subagentDescriptor: Schema.optional(
        Schema.Struct({
          role: Schema.optional(Schema.String),
        }),
      ),
    }),
  ),
);

/** A conversation's inbox. Throws past a bound or on a file it cannot read, so nothing is proven. */
async function readInbox(profileRoot: string, conversationId: string) {
  const inbox = await resolveAntigravityAppDataPath(
    profileRoot,
    ["brain", conversationId, ".system_generated", "messages"],
    "directory",
  );
  if (inbox === undefined) return [];
  const directory = [inbox.appDataDir, "brain", conversationId, ".system_generated", "messages"];
  // `read.json` is the runtime's read receipts, not a message.
  const names = (await NodeFSP.readdir(inbox.path)).filter(
    (name) => name.endsWith(".json") && name !== "read.json",
  );
  if (names.length > MAX_MESSAGE_FILES) throw new Error("Too many messages");
  return Promise.all(
    names.map(async (name) => {
      const file = await antigravityManagedPath(profileRoot, [...directory, name], "file");
      if (file === undefined || file.info.size > MAX_STEP_BYTES) throw new Error("Unreadable");
      return Option.getOrThrow(decodeChildMessage(await NodeFSP.readFile(file.path, "utf8")));
    }),
  );
}

type ChildMessage = Awaited<ReturnType<typeof readInbox>>[number];

async function listDetachedChildIds(
  profileRoot: string,
  rootSessionId: string,
): Promise<ReadonlyArray<string> | undefined> {
  const children = await resolveAntigravityAppDataPath(
    profileRoot,
    ["brain", rootSessionId, ".system_generated", "subagents"],
    "directory",
  );
  if (children === undefined) return undefined;
  const entries = await NodeFSP.readdir(children.path).catch(() => undefined);
  if (entries === undefined) return undefined;
  const childIds = entries.flatMap((name) =>
    name.endsWith(".json") && NATIVE_ID.test(name.slice(0, -5)) ? [name.slice(0, -5)] : [],
  );
  return childIds.length > MAX_DETACHED_CHILDREN ? undefined : childIds;
}

function detachedLaunchCall(message: ChildMessage, rootSessionId: string) {
  const tool = message.sourceMetadata?.tool;
  const call = tool?.toolCall;
  return message.sender === rootSessionId &&
    (tool?.conversationId === undefined || tool.conversationId === rootSessionId) &&
    (call?.name === "invoke_subagent" || call?.name === "swarm")
    ? call
    : undefined;
}

function swarmRoleLabel(descriptorRole: string | undefined): string | undefined {
  const trimmed = descriptorRole?.trim() ?? "";
  const match = /^Swarm Worker \((.+)\)$/.exec(trimmed);
  return match?.[1] !== undefined ? `@${match[1].trim()}` : undefined;
}

const decodeSwarmRoster = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      members: Schema.optional(
        Schema.Record(
          Schema.String,
          Schema.Struct({
            conversation_id: Schema.optional(Schema.String),
            role: Schema.optional(Schema.String),
            desired_state: Schema.optional(Schema.String),
            phase: Schema.optional(Schema.String),
            wake_mode: Schema.optional(Schema.String),
          }),
        ),
      ),
    }),
  ),
);

interface DiskSwarmMember {
  readonly name: string;
  readonly role: string;
  readonly killed: boolean;
  readonly parked: boolean;
}

async function readDiskSwarmMembersByConversationId(
  profileRoot: string,
  rootSessionId: string,
): Promise<ReadonlyMap<string, DiskSwarmMember>> {
  const file = await antigravityManagedPath(
    profileRoot,
    ["antigravity-acp", "brain", rootSessionId, ".system_generated", "swarm", "members.json"],
    "file",
  );
  if (file === undefined || file.info.size > MAX_STEP_BYTES) return new Map();
  const raw = await NodeFSP.readFile(file.path, "utf8").catch(() => undefined);
  if (raw === undefined) return new Map();
  const decoded = Option.getOrUndefined(decodeSwarmRoster(raw));
  const members = decoded?.members;
  if (members === undefined) return new Map();
  const byConversation = new Map<string, DiskSwarmMember>();
  for (const [name, member] of Object.entries(members)) {
    const convId = member.conversation_id;
    if (convId === undefined || !NATIVE_ID.test(convId)) continue;
    const role = member.role ?? "worker";
    if (role === "coordinator") continue;
    const killed = member.desired_state === "KILLED" || member.phase === "KILLED";
    const parked = member.wake_mode === "mentions" || member.wake_mode === "anything";
    byConversation.set(convId, { name, role, killed, parked });
  }
  return byConversation;
}

async function readDetachedSubagent(profileRoot: string, rootSessionId: string, childId: string) {
  const file = await resolveAntigravityAppDataPath(
    profileRoot,
    ["brain", rootSessionId, ".system_generated", "subagents", `${childId}.json`],
    "file",
  );
  if (file === undefined || file.info.size > MAX_STEP_BYTES) return undefined;
  const contents = await NodeFSP.readFile(file.path, "utf8").catch(() => undefined);
  if (contents === undefined) return undefined;
  const record = Option.getOrUndefined(decodeDetachedSubagent(contents));
  return record !== undefined &&
    (record.conversationId === undefined || record.conversationId === childId)
    ? record
    : undefined;
}

/**
 * agy 1.5 records detached children under `subagents/` instead of a SQLite `INVOKE_SUBAGENT` step;
 * the child's own inbox carries the parent's launching `invoke_subagent` tool call id.
 */
async function findDetachedInvokeRecord(
  profileRoot: string,
  rootSessionId: string,
  nativeTaskId: string,
): Promise<InvokeRecord | undefined> {
  const childIds = await listDetachedChildIds(profileRoot, rootSessionId);
  if (childIds === undefined || childIds.length === 0) return undefined;
  const matches: Array<InvokeRecord & { readonly isSwarm: boolean }> = [];
  for (const childId of childIds) {
    const messages = await readInbox(profileRoot, childId).catch(() => undefined);
    // An unreadable or oversized sibling inbox could also claim this id, so uniqueness is unproven.
    if (messages === undefined) return undefined;
    const launchMessage = messages.find(
      (message) => detachedLaunchCall(message, rootSessionId)?.id === nativeTaskId,
    );
    if (launchMessage === undefined) continue;
    const subagent = await readDetachedSubagent(profileRoot, rootSessionId, childId);
    if (subagent === undefined) return undefined;
    const call = launchMessage.sourceMetadata?.tool?.toolCall;
    const isSwarm = call?.name === "swarm";
    const argumentsJson = call?.argumentsJson;
    const parsedArgs =
      argumentsJson === undefined
        ? undefined
        : Option.getOrUndefined(decodeArgument(argumentsJson));
    const argLaunches = antigravitySubagentLaunches(parsedArgs);
    const descriptorLabel = swarmRoleLabel(subagent.subagentDescriptor?.role);
    const matchedLaunch =
      isSwarm && descriptorLabel !== undefined
        ? (argLaunches?.find((entry) => entry.role.startsWith(descriptorLabel)) ?? {
            role: descriptorLabel,
            prompt: launchMessage.content ?? argLaunches?.[0]?.prompt ?? "",
          })
        : argLaunches?.[0];
    matches.push({
      isSwarm,
      toolCallId: nativeTaskId,
      launches: [
        matchedLaunch ?? {
          role: descriptorLabel ?? subagent.subagentDescriptor?.role ?? "",
          prompt: launchMessage.content ?? "",
        },
      ],
      children: [{ conversationId: childId }],
    });
  }
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1 && matches.every((entry) => entry.isSwarm)) {
    const ordered = [...matches].sort((left, right) =>
      (left.launches[0]?.role ?? "").localeCompare(right.launches[0]?.role ?? "", undefined, {
        numeric: true,
      }),
    );
    return {
      toolCallId: nativeTaskId,
      launches: ordered.flatMap((entry) => entry.launches),
      children: ordered.flatMap((entry) => entry.children),
    };
  }
  return undefined;
}

const PENDING_REPLY_TAIL_BYTES = 64 * 1024;
const HIGH_PRIORITY_MESSAGE = "MESSAGE_PRIORITY_HIGH";
const LOW_PRIORITY_MESSAGE = "MESSAGE_PRIORITY_LOW";

const decodeReadReceipts = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Boolean)),
);

const decodeInboxPriorityMessage = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      id: Schema.optional(Schema.String),
      priority: Schema.optional(Schema.String),
    }),
  ),
);

async function hasUnreadWakingInboxMessage(
  profileRoot: string,
  sessionId: string,
): Promise<boolean> {
  const inbox = await resolveAntigravityAppDataPath(
    profileRoot,
    ["brain", sessionId, ".system_generated", "messages"],
    "directory",
  );
  if (inbox === undefined) return false;
  const directory = [inbox.appDataDir, "brain", sessionId, ".system_generated", "messages"];
  const entries = await NodeFSP.readdir(inbox.path).catch(() => undefined);
  if (entries === undefined) return false;
  const messageNames = entries.filter((name) => name.endsWith(".json") && name !== "read.json");
  if (messageNames.length === 0 || messageNames.length > MAX_MESSAGE_FILES) return false;
  let readReceipts: Readonly<Record<string, boolean>> = {};
  if (entries.includes("read.json")) {
    const receiptFile = await antigravityManagedPath(
      profileRoot,
      [...directory, "read.json"],
      "file",
    );
    if (receiptFile === undefined || receiptFile.info.size > MAX_STEP_BYTES) return false;
    const rawReceipts = await NodeFSP.readFile(receiptFile.path, "utf8").catch(() => undefined);
    if (rawReceipts === undefined) return false;
    const decodedReceipts = decodeReadReceipts(rawReceipts);
    if (Option.isNone(decodedReceipts)) return false;
    readReceipts = decodedReceipts.value;
  }
  for (const name of messageNames) {
    const fileId = name.slice(0, -5);
    if (readReceipts[fileId] === true) continue;
    const file = await antigravityManagedPath(profileRoot, [...directory, name], "file");
    if (file === undefined || file.info.size > MAX_STEP_BYTES) continue;
    const raw = await NodeFSP.readFile(file.path, "utf8").catch(() => undefined);
    if (raw === undefined) continue;
    const decoded = decodeInboxPriorityMessage(raw);
    if (Option.isNone(decoded)) continue;
    if (decoded.value.id !== undefined && readReceipts[decoded.value.id] === true) continue;
    if (decoded.value.priority === HIGH_PRIORITY_MESSAGE) return true;
  }
  return false;
}

async function readLastTranscriptLine(
  profileRoot: string,
  sessionId: string,
): Promise<Schema.Schema.Type<typeof TranscriptLine> | undefined> {
  const transcript = await resolveAntigravityAppDataPath(
    profileRoot,
    ["brain", sessionId, ".system_generated", "logs", "transcript.jsonl"],
    "file",
  );
  if (transcript === undefined) return undefined;
  const handle = await NodeFSP.open(
    transcript.path,
    NodeFS.constants.O_RDONLY | (NodeFS.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size === 0) return undefined;
    for (const byteCap of [PENDING_REPLY_TAIL_BYTES, TRANSCRIPT_BYTE_CAP]) {
      const start = Math.max(0, stat.size - byteCap);
      const buffer = Buffer.alloc(stat.size - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      let end = bytesRead;
      while (end > 0 && (buffer[end - 1] === 0x0a || buffer[end - 1] === 0x0d)) {
        end -= 1;
      }
      if (end === 0) {
        if (start === 0) return undefined;
        continue;
      }
      const trimmed = buffer.subarray(0, end);
      const lastNewline = trimmed.lastIndexOf(0x0a);
      if (lastNewline === -1 && start > 0) continue;
      const line = trimmed.toString("utf8", lastNewline + 1);
      return Option.getOrUndefined(decodeTranscriptLine(line));
    }
    return undefined;
  } finally {
    await handle.close();
  }
}

/**
 * True when `agy` has a high-priority wake queued in the session's inbox or already dequeued as
 * the trailing `SYSTEM_MESSAGE` step in `transcript.jsonl` with no `PLANNER_RESPONSE` yet.
 * Fails closed when records are missing, linked, or unreadable.
 */
export const readAntigravityPendingReply = Effect.fn("readAntigravityPendingReply")(
  function* (input: { readonly profileDirectory: string; readonly sessionId: string }) {
    if (!NATIVE_ID.test(input.sessionId)) return false;
    const read = async (): Promise<boolean> => {
      const profileRoot = await antigravityProfileRoot(input.profileDirectory);
      if (profileRoot === undefined) return false;
      if (await hasUnreadWakingInboxMessage(profileRoot, input.sessionId)) return true;
      const lastStep = await readLastTranscriptLine(profileRoot, input.sessionId);
      if (lastStep === undefined || lastStep.type !== "SYSTEM_MESSAGE") return false;
      return (
        lastStep.content === undefined ||
        lastStep.content.includes(`priority=${HIGH_PRIORITY_MESSAGE}`) ||
        !lastStep.content.includes(`priority=${LOW_PRIORITY_MESSAGE}`)
      );
    };
    return yield* Effect.tryPromise({
      try: read,
      catch: (cause) => new AntigravityChildWorkReadError({ cause }),
    }).pipe(Effect.orElseSucceed(() => false));
  },
);

/**
 * agy 1.5 children outlive their `invoke_subagent` call and the agent reports no end for them:
 * a child is done, or waits for guidance, once its message is in the parent's inbox or its record
 * says it was killed. Returns the launching tool call ids of children with neither; none when the
 * records prove nothing.
 */
export const readAntigravityChildrenAtWork = Effect.fn("readAntigravityChildrenAtWork")(
  function* (input: {
    readonly profileDirectory: string;
    readonly rootSessionId: string;
    readonly toolCallIds: ReadonlyArray<string>;
  }) {
    if (!NATIVE_ID.test(input.rootSessionId)) return [];
    const read = async (): Promise<ReadonlyArray<string>> => {
      const profileRoot = await antigravityProfileRoot(input.profileDirectory);
      const childIds =
        profileRoot === undefined
          ? undefined
          : await listDetachedChildIds(profileRoot, input.rootSessionId);
      if (profileRoot === undefined || childIds === undefined) return [];
      const reported = new Set(
        (await readInbox(profileRoot, input.rootSessionId)).map((message) => message.sender),
      );
      const swarmMembers = await readDiskSwarmMembersByConversationId(
        profileRoot,
        input.rootSessionId,
      );
      const atWork = new Set<string>();
      for (const childId of childIds) {
        if (reported.has(childId)) continue;
        const swarmMember = swarmMembers.get(childId);
        if (swarmMember?.killed === true || swarmMember?.parked === true) continue;
        // `manage_subagents` kill only marks the record; a killed child never reports.
        const subagent = await readDetachedSubagent(profileRoot, input.rootSessionId, childId);
        if (subagent?.state === "SUBAGENT_STATE_KILLED") continue;
        const directTaskId = `swarm:${childId}`;
        if (input.toolCallIds.includes(directTaskId)) {
          atWork.add(directTaskId);
        }
        for (const message of await readInbox(profileRoot, childId)) {
          const launch = detachedLaunchCall(message, input.rootSessionId);
          if (launch !== undefined && input.toolCallIds.includes(launch.id)) {
            atWork.add(launch.id);
          }
        }
      }
      return [...atWork];
    };
    return yield* Effect.tryPromise({
      try: read,
      catch: (cause) => new AntigravityChildWorkReadError({ cause }),
    }).pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
  },
);
