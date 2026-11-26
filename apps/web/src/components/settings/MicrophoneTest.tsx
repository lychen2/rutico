import { errorDisplayMessage } from "@t3tools/client-runtime/errors";
import { m } from "~/i18n/messages";
import { MICROPHONE_PERMISSION_ERROR } from "@t3tools/client-runtime/voice-input";
import { MicIcon, PauseIcon, PlayIcon, RotateCcwIcon, SquareIcon, XIcon } from "lucide-react";
import { T, useGT, useMessages } from "gt-react";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { requestMicrophone } from "../../speech/requestMicrophone";
import workletUrl from "../../speech/pcmWorklet.ts?worker&url";
import { VoiceWaveform } from "../chat/VoiceInputPill";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

const LOOPBACK_SECONDS = 10;
const WAVEFORM_BAR_COUNT = 36;
const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

interface WaveformBar {
  readonly id: string;
  readonly position: number;
  readonly amplitude: number;
}

function resampleWaveform(
  samples: ReadonlyArray<number>,
  barCount = WAVEFORM_BAR_COUNT,
): ReadonlyArray<WaveformBar> {
  if (samples.length === 0) {
    return Array.from({ length: barCount }, (_, index) => ({
      id: `wf-${index}`,
      position: (index + 0.5) / barCount,
      amplitude: 0.16,
    }));
  }
  const buckets = Array.from({ length: barCount }, (_, index) => {
    const start = Math.floor((index * samples.length) / barCount);
    const end = Math.max(start + 1, Math.floor(((index + 1) * samples.length) / barCount));
    let peak = 0;
    for (let cursor = start; cursor < end && cursor < samples.length; cursor += 1) {
      const value = samples[cursor] ?? 0;
      if (value > peak) peak = value;
    }
    return peak;
  });
  const maxPeak = Math.max(0.12, ...buckets);
  return buckets.map((value, index) => ({
    id: `wf-${index}`,
    position: (index + 0.5) / barCount,
    amplitude: Math.max(0.14, Math.min(1, value / maxPeak)),
  }));
}

type Capture = {
  stream?: MediaStream;
  recorder?: MediaRecorder;
  context?: AudioContext;
  worklet?: AudioWorkletNode;
  timer?: ReturnType<typeof setTimeout>;
  elapsedTimer?: ReturnType<typeof setInterval>;
  startedAt?: number;
  levelSamples: number[];
};

/**
 * Records a few seconds and plays them back in the browser. The audio never leaves this
 * device: no environment, transcriber, or provider is involved, so a silent result points
 * at the microphone rather than at transcription.
 */
export function MicrophoneTest({
  microphoneId,
  onMicrophoneAccess,
}: {
  microphoneId: string;
  /** Labels and device ids become readable once the browser grants access. */
  onMicrophoneAccess: () => void;
}) {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const messages = useMessages();
  const [phase, setPhase] = useState<"idle" | "starting" | "recording" | "ready">("idle");
  const [recording, setRecording] = useState<{
    url: string;
    duration: number;
    waveform: ReadonlyArray<WaveformBar>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const capture = useRef<Capture | null>(null);
  const recordingUrl = useRef<string | null>(null);

  const releaseCapture = useStableCallback(() => {
    const current = capture.current;
    if (!current) return;
    capture.current = null;
    clearTimeout(current.timer);
    clearInterval(current.elapsedTimer);
    current.worklet?.disconnect();
    current.worklet?.port.close();
    if (current.recorder && current.recorder.state !== "inactive") current.recorder.stop();
    current.stream?.getTracks().forEach((track) => track.stop());
    void current.context?.close().catch(() => undefined);
  });
  const discard = () => {
    if (recordingUrl.current) URL.revokeObjectURL(recordingUrl.current);
    recordingUrl.current = null;
    setRecording(null);
    setPhase("idle");
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases the microphone and the recording's object URL on unmount
  useEffect(
    () => () => {
      releaseCapture();
      if (recordingUrl.current) URL.revokeObjectURL(recordingUrl.current);
    },
    [releaseCapture],
  );

  const start = async () => {
    releaseCapture();
    discard();
    setError(null);
    setLevel(0);
    setElapsed(0);
    setPhase("starting");
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined" ||
      typeof AudioWorkletNode === "undefined"
    ) {
      setError(
        gt("Microphone testing is unavailable in this browser. Use HTTPS or the desktop app."),
      );
      setPhase("idle");
      return;
    }
    const current: Capture = { levelSamples: [] };
    capture.current = current;
    try {
      const stream = await requestMicrophone(microphoneId);
      if (capture.current !== current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      current.stream = stream;
      onMicrophoneAccess();
      const recorder = new MediaRecorder(stream);
      current.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.addEventListener("dataavailable", ({ data }) => {
        if (capture.current === current && data.size) chunks.push(data);
      });
      recorder.addEventListener("stop", () => {
        if (capture.current !== current) return;
        const blob = new Blob(chunks, { type: recorder.mimeType });
        const duration =
          current.startedAt === undefined ? 0 : (performance.now() - current.startedAt) / 1_000;
        releaseCapture();
        setLevel(0);
        if (!blob.size) {
          setError(gt("No audio was recorded. Try again."));
          setPhase("idle");
          return;
        }
        const waveform = resampleWaveform(current.levelSamples);
        recordingUrl.current = URL.createObjectURL(blob);
        setRecording({ url: recordingUrl.current, duration, waveform });
        setPhase("ready");
      });
      const onRecordingError = () => {
        if (capture.current !== current) return;
        releaseCapture();
        setLevel(0);
        setError(gt("Could not record microphone audio. Try again."));
        setPhase("idle");
      };
      recorder.addEventListener("error", onRecordingError);
      for (const track of stream.getAudioTracks()) {
        track.addEventListener(
          "ended",
          () => {
            if (capture.current !== current) return;
            setError(gt("The microphone disconnected."));
            if (recorder.state !== "inactive") recorder.stop();
          },
          { once: true },
        );
      }
      const context = new AudioContext();
      current.context = context;
      await context.audioWorklet.addModule(workletUrl);
      if (capture.current !== current) return;
      const worklet = new AudioWorkletNode(context, "t3-pcm-capture", {
        channelCount: 1,
        processorOptions: { meterOnly: true },
      });
      current.worklet = worklet;
      worklet.port.onmessage = ({ data }: MessageEvent<number | "stopped">) => {
        if (capture.current === current && typeof data === "number") {
          current.levelSamples.push(data);
          setLevel(data);
        }
      };
      worklet.onprocessorerror = onRecordingError;
      context.createMediaStreamSource(stream).connect(worklet);
      worklet.connect(context.destination);
      await context.resume();
      if (capture.current !== current) return;
      const startedAt = performance.now();
      current.startedAt = startedAt;
      current.elapsedTimer = setInterval(() => {
        setElapsed(Math.min(LOOPBACK_SECONDS, Math.floor((performance.now() - startedAt) / 1_000)));
      }, 100);
      recorder.start();
      worklet.port.postMessage("start", []);
      setPhase("recording");
      current.timer = setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, LOOPBACK_SECONDS * 1_000);
    } catch (cause) {
      if (capture.current !== current) return;
      releaseCapture();
      setPhase("idle");
      const name = typeof cause === "object" && cause !== null && "name" in cause && cause.name;
      setError(
        name === "NotAllowedError"
          ? messages(MICROPHONE_PERMISSION_ERROR)
          : name === "NotFoundError"
            ? gt("No microphone found.")
            : cause instanceof Error
              ? (errorDisplayMessage(cause, m) ?? cause.message)
              : gt("Could not access the microphone."),
      );
    }
  };
  const cancel = () => {
    releaseCapture();
    discard();
    setError(null);
  };

  const control =
    phase === "recording" || phase === "starting" ? (
      <Button
        size="sm"
        variant="outline"
        aria-label={gt("Stop recording")}
        disabled={phase !== "recording"}
        onClick={() => {
          const recorder = capture.current?.recorder;
          if (recorder && recorder.state !== "inactive") recorder.stop();
        }}
      >
        <SquareIcon />
        <T>Stop</T>
      </Button>
    ) : (
      <Button size="sm" variant="outline" onClick={() => void start()}>
        {phase === "ready" ? <RotateCcwIcon /> : <MicIcon />}
        {phase === "ready" ? gt("Record again") : gt("Record")}
      </Button>
    );
  const panel = error ? (
    <p role="alert" className="min-w-0 flex-1 text-xs text-destructive">
      {error}
    </p>
  ) : phase === "starting" ? (
    <span role="status" className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
      <T>Opening microphone…</T>
    </span>
  ) : phase === "recording" ? (
    <>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-destructive" />
      <div className="flex w-24 min-w-0">
        <VoiceWaveform level={level} />
      </div>
      <span
        className="ms-auto shrink-0 text-xs tabular-nums text-muted-foreground"
        aria-label={gt("Recording time")}
      >
        {formatTime(elapsed)} / {formatTime(LOOPBACK_SECONDS)}
      </span>
      <meter
        aria-label={gt("Microphone input level")}
        min={0}
        max={1}
        value={level}
        className="sr-only"
      />
    </>
  ) : phase === "ready" && recording ? (
    <MicrophonePlayback
      key={recording.url}
      src={recording.url}
      duration={recording.duration}
      waveform={recording.waveform}
    />
  ) : null;

  return (
    <SettingsRow
      {...searchableSetting("microphone-test")}
      title={gt("Test microphone")}
      description={gt("Record ten seconds and play it back. The audio stays on this device.")}
      control={control}
    >
      {panel ? (
        <div
          className={cn(
            "mt-3 mb-2 flex min-h-10 items-center gap-3 rounded-lg border border-border/60 bg-muted/30 py-1 pe-1",
            phase === "ready" && !error ? "ps-1" : "ps-3",
          )}
        >
          {panel}
          <Button
            size="icon-sm"
            variant="ghost-muted"
            aria-label={phase === "ready" ? gt("Discard recording") : gt("Cancel microphone test")}
            onClick={cancel}
          >
            <XIcon />
          </Button>
        </div>
      ) : null}
    </SettingsRow>
  );
}

function MicrophonePlayback({
  src,
  duration,
  waveform,
}: {
  src: string;
  duration: number;
  waveform: ReadonlyArray<WaveformBar>;
}) {
  const gt = useGT();
  const audio = useRef<HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const rangeInputRef = useRef<HTMLInputElement>(null);
  const timeReadoutRef = useRef<HTMLSpanElement>(null);
  const draggingPointerRef = useRef<number | null>(null);
  const scrubPositionRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [failed, setFailed] = useState(false);
  const ratio = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;

  // Imperatively paint bar fill, range value, and readout during active pointer scrubbing
  // so dragging incurs zero React re-renders per pointermove frame.
  const paintScrubDom = (nextTime: number) => {
    const nextRatio = duration > 0 ? Math.max(0, Math.min(1, nextTime / duration)) : 0;
    const track = trackRef.current;
    if (track) {
      const bars = track.querySelectorAll<HTMLElement>('[data-slot="mic-waveform-bar"]');
      for (let i = 0; i < bars.length; i += 1) {
        const bar = bars[i];
        const barPos = waveform[i]?.position ?? 1;
        if (!bar) continue;
        if (nextRatio > 0 && barPos <= nextRatio) {
          bar.dataset.passed = "true";
        } else {
          delete bar.dataset.passed;
        }
      }
    }
    if (rangeInputRef.current) {
      rangeInputRef.current.value = String(Math.min(nextTime, duration));
    }
    if (timeReadoutRef.current) {
      timeReadoutRef.current.textContent = `${formatTime(nextTime)} / ${formatTime(duration)}`;
    }
  };

  const seekToClientX = (clientX: number) => {
    const track = trackRef.current;
    if (!track || duration <= 0) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const next = fraction * duration;
    scrubPositionRef.current = next;
    if (audio.current) audio.current.currentTime = next;
    paintScrubDom(next);
  };

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || duration <= 0) return;
    draggingPointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekToClientX(event.clientX);
  };

  const handleTrackPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingPointerRef.current !== event.pointerId) return;
    seekToClientX(event.clientX);
  };

  const endTrackDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingPointerRef.current !== event.pointerId) return;
    draggingPointerRef.current = null;
    setPosition(scrubPositionRef.current);
  };

  const togglePlayback = async () => {
    const player = audio.current;
    if (!player) return;
    if (!player.paused) {
      player.pause();
      return;
    }
    setFailed(false);
    if (player.ended) player.currentTime = 0;
    try {
      await player.play();
    } catch {
      setFailed(true);
    }
  };

  return (
    <>
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => {
          if (draggingPointerRef.current !== null) return;
          setPosition(audio.current?.currentTime ?? 0);
        }}
        onError={() => setFailed(true)}
      />
      <Button
        size="icon-sm-pill"
        variant="outline"
        aria-label={playing ? gt("Pause recording") : gt("Play recording")}
        onClick={() => void togglePlayback()}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </Button>
      {failed ? (
        <p role="alert" className="min-w-0 flex-1 text-xs text-destructive">
          <T>Could not play this recording. Try recording again.</T>
        </p>
      ) : (
        <div
          ref={trackRef}
          data-slot="mic-waveform"
          onPointerDown={handleTrackPointerDown}
          onPointerMove={handleTrackPointerMove}
          onPointerUp={endTrackDrag}
          onPointerCancel={endTrackDrag}
          className="relative flex h-7 min-w-0 flex-1 cursor-pointer touch-none items-center gap-0.5 rounded-md px-1 select-none"
        >
          {waveform.map((bar) => {
            const passed = ratio > 0 && bar.position <= ratio;
            return (
              <span
                key={bar.id}
                aria-hidden
                data-slot="mic-waveform-bar"
                data-passed={passed ? "true" : undefined}
                className="min-w-0.5 flex-1 rounded-full bg-muted-foreground/30"
                style={{ height: `${Math.round(bar.amplitude * 100)}%` }}
              />
            );
          })}
          <input
            ref={rangeInputRef}
            type="range"
            aria-label={gt("Recording playback position")}
            min={0}
            max={duration}
            step={0.01}
            value={Math.min(position, duration)}
            disabled={duration <= 0}
            onChange={(event) => {
              const next = Number(event.target.value);
              scrubPositionRef.current = next;
              if (audio.current) audio.current.currentTime = next;
              setPosition(next);
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          />
        </div>
      )}
      <span ref={timeReadoutRef} className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatTime(position)} / {formatTime(duration)}
      </span>
    </>
  );
}
