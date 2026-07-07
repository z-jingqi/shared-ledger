import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchImportJobs, type ImportJobStatus } from "./status";

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly listeners = new Map<string, Array<(event: { data: string }) => void>>();
  onerror: (() => void) | null = null;
  closed = false;

  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {
    MockEventSource.instances.push(this);
  }

  addEventListener(event: string, listener: (event: { data: string }) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  emit(event: string, data: unknown) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener({ data: JSON.stringify(data) });
    }
  }

  close() {
    this.closed = true;
  }
}

describe("watchImportJobs", () => {
  const originalEventSource = globalThis.EventSource;

  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.instances = [];
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  });

  afterEach(() => {
    globalThis.EventSource = originalEventSource;
    vi.useRealTimers();
  });

  it("deduplicates unchanged job snapshots", () => {
    const onJob = vi.fn();
    const stop = watchImportJobs(["import_1"], onJob);
    const source = MockEventSource.instances[0];
    const job: ImportJobStatus = {
      id: "import_1",
      fileName: "receipt.jpg",
      status: "ai_processing",
      progress: 100,
      progressText: "提取明细 2/2",
      stage: "ai_items",
      updatedAt: "2026-07-07T15:01:22.607Z",
    };

    source.emit("job", job);
    source.emit("job", job);
    source.emit("job", { ...job, updatedAt: "2026-07-07T15:01:23.607Z" });
    stop();

    expect(onJob).toHaveBeenCalledTimes(2);
  });

  it("uses stream-idle retryAfterMs before reconnecting", () => {
    const stop = watchImportJobs(["import_1"], vi.fn());
    const source = MockEventSource.instances[0];

    source.emit("stream-idle", { reason: "local_processing", retryAfterMs: 75 });
    expect(source.closed).toBe(true);
    vi.advanceTimersByTime(74);
    expect(MockEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(MockEventSource.instances).toHaveLength(2);
    stop();
  });

  it("does not reconnect when stream-idle retryAfterMs is zero", () => {
    const stop = watchImportJobs(["import_1"], vi.fn());
    const source = MockEventSource.instances[0];

    source.emit("stream-idle", { reason: "local_processing", retryAfterMs: 0 });
    expect(source.closed).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(MockEventSource.instances).toHaveLength(1);
    stop();
  });
});
