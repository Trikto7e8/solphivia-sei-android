/**
 * 261017 (issue #46): the ChatGPT-plan adapter for the main-process LLM layer
 * (chat, voice one-shots, folds, compactions, chess, Draw!, backseat,
 * persona expansion). Speaks the Responses API through the wire module the
 * bot shares (src/bot/brain/llm/responsesWire.js), so both layers send the
 * exact request contract the plan route enforces.
 *
 * Per call:
 *   1. the session's latches first (usage limit / not eligible): fail fast,
 *      no request (no retry storm);
 *   2. a fresh access token from main's session (refresh is single-flight
 *      there);
 *   3. one streamed POST /v1/responses; a pre-stream 401 forces one refresh
 *      and ONE retry, never more;
 *   4. a terminal plan answer is reported to the session, which latches it
 *      and pushes the status the renderer turns into the usage-limit dialog.
 *
 * Fields the route rejects are never sent, so `maxTokens` (max_output_tokens)
 * and `stopSequences` are not on the wire: stop sequences are applied to the
 * finished text instead, and length is left to the model and the prompt.
 *
 * Timeout: an idle timer armed at `timeoutMs` and re-armed on every received
 * chunk (the Responses stream opens with response.created at once, so this is
 * a first-byte + stall timeout, not a cap on a healthy long answer).
 */
import type Anthropic from '@anthropic-ai/sdk';
import { CHATGPT_RESPONSES_URL } from '../../shared/chatgptPlan';
import type { VisionVerdict } from '../../shared/llmCatalog';
// The shared wire format (plain JS, imported like other bot helpers).
import { buildResponsesBody, streamResponses } from '../../bot/brain/llm/responsesWire.js';
import type { ChatgptSession } from '../chatgptPlan/session';
import { parseToolJsonFallback, synthesizeContent } from './messageMappers';
import { requestDeadline, timeoutOr } from './timeout';
import type { LlmCallParams, LlmProvider, LlmResult, LlmToolUse } from './types';

const DEFAULT_TIMEOUT_MS = 45_000;

/** Cut text at the first stop sequence (the route has no `stop` field). */
export function applyStopSequences(text: string, stops: readonly string[] | undefined): { text: string; stopped: boolean } {
  if (!stops?.length) return { text, stopped: false };
  let cut = -1;
  for (const s of stops) {
    if (!s) continue;
    const i = text.indexOf(s);
    if (i >= 0 && (cut < 0 || i < cut)) cut = i;
  }
  return cut < 0 ? { text, stopped: false } : { text: text.slice(0, cut), stopped: true };
}

export function createChatgptProvider(opts: {
  model: string;
  reasoningEffort?: string | null;
  vision: VisionVerdict;
  session: ChatgptSession;
  fetchImpl?: typeof fetch;
  url?: string;
}): LlmProvider {
  const { model, session } = opts;
  const fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  const url = opts.url ?? CHATGPT_RESPONSES_URL;

  async function once(p: LlmCallParams, token: string, signal: AbortSignal, onChunk: () => void): Promise<LlmResult> {
    const body = buildResponsesBody({
      model,
      system: p.system,
      messages: p.messages,
      tools: p.tools,
      toolChoice: p.toolChoice,
      reasoningEffort: opts.reasoningEffort ?? null,
    });
    const r = (await streamResponses({
      fetchImpl,
      url,
      token,
      body,
      signal,
      onChunk,
      onTextDelta: p.onTextDelta ? (d: string) => p.onTextDelta!(d) : undefined,
    })) as { text: string; toolUses: LlmToolUse[]; usage: LlmResult['usage']; stopReason: string | null };

    let text = r.text;
    let toolUses = r.toolUses;
    let stopReason = r.stopReason;
    const stopped = applyStopSequences(text, p.stopSequences);
    if (stopped.stopped) {
      text = stopped.text.trim();
      stopReason = 'stop_sequence';
    }
    if (p.toolChoice && toolUses.length === 0 && text) {
      const input = parseToolJsonFallback(text);
      if (input) {
        toolUses = [{ id: `toolu_fallback_${Date.now()}`, name: p.toolChoice.name, input }];
        text = '';
        stopReason = 'tool_use';
      }
    }
    const content = synthesizeContent(text, toolUses);
    if (p.onContentBlock) {
      for (const blk of content) {
        try { p.onContentBlock(blk as Anthropic.Messages.ContentBlock); } catch { /* sink errors never break a call */ }
      }
    }
    return { content, toolUses, text, usage: r.usage, stopReason };
  }

  async function call(p: LlmCallParams): Promise<LlmResult> {
    session.assertUsable();
    const timeoutMs = p.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const onParentAbort = (): void => controller.abort();
    if (p.signal) {
      if (p.signal.aborted) controller.abort();
      else p.signal.addEventListener('abort', onParentAbort, { once: true });
    }
    const deadline = requestDeadline(controller, timeoutMs);
    const rearm = (): void => deadline.rearm();
    try {
      let tok = await session.getAccessToken();
      try {
        return await once(p, tok.token, controller.signal, rearm);
      } catch (err) {
        if ((err as { code?: string })?.code !== 'CHATGPT_AUTH') throw err;
        // One forced refresh + one retry. A second 401 surfaces as is.
        tok = await session.getAccessToken({ force: true });
        deadline.rearm();
        return await once(p, tok.token, controller.signal, rearm);
      }
    } catch (err) {
      session.reportError(err);
      throw timeoutOr(err, deadline, p.signal, 'ChatGPT', timeoutMs);
    } finally {
      deadline.clear();
      if (p.signal) p.signal.removeEventListener('abort', onParentAbort);
    }
  }

  return {
    call,
    backend: 'local',
    kind: 'chatgpt',
    model,
    vision: opts.vision,
    streaming: true,
  };
}
